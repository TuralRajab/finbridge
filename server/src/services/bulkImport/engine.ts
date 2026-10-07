/**
 * Bulk import engine for master data.
 *
 * - Each entity is described once (columns, reference lists, prefill rows, apply logic) in `entities.ts`;
 *   the same description drives the Excel template, the column help in the UI and the import itself.
 * - Columns are matched by header text (Azerbaijani or English, case / spaces / "*" ignored), so the
 *   template may be filled in either language and columns may be reordered.
 * - The import always runs the real create / update logic inside one transaction. A check run
 *   (dryRun) or any error rolls the transaction back, so a check run reports exactly what an import
 *   would do and a failed file never leaves half-written data.
 * - Records are matched by their natural key (code, e-mail, currency + date). Existing records are
 *   updated; an empty cell keeps the current value, "-" clears an optional value.
 */
import ExcelJS from 'exceljs';
import type { BulkImportColumnDto, BulkImportKind, BulkImportReport, BulkRowAction, ImportColumn, ImportIssue, Lang, Permission } from '@finbridge/shared';
import { get, run, tx } from '../../db/database';
import { audit } from '../../lib/audit';
import { nowIso } from '../../lib/clock';
import { HttpError } from '../../lib/errors';
import type { UserRow } from '../../lib/mappers';

/* ------------------------------------------------------------------ definitions */

export type CellType = BulkImportColumnDto['type'];

/** Explicit "clear this value" marker ("-" in the cell). */
export const CLEAR = Symbol('clear');
export type Value = string | number | boolean | string[] | typeof CLEAR | undefined;
export type Row = { row: number; v: Record<string, Value> };

export interface Col {
  key: string;
  az: string;
  en: string;
  type: CellType;
  required?: boolean | 'create';
  /** Allowed values for enum / bool columns (codes). Evaluated per company. */
  options?: (companyId: number) => string[];
  hintAz: string;
  hintEn: string;
  exampleAz?: string;
  exampleEn?: string;
  width?: number;
}

export interface RefSheet { nameAz: string; nameEn: string; headersAz: string[]; headersEn: string[]; rows: (string | number | null)[][] }

export interface ImportOptions { dryRun: boolean; mode: 'upsert' | 'create'; fileName: string; lang: Lang; initialPassword?: string | null }

export interface Ctx {
  companyId: number;
  user: UserRow;
  opts: ImportOptions;
  /** Localised message. */
  m: (az: string, en: string) => string;
  error: (row: number, msg: string) => void;
  warn: (row: number, msg: string) => void;
  result: (row: number, key: string, action: BulkRowAction, changes?: string[]) => void;
  audit: (entity: string, id: number | bigint, action: string, changes: Record<string, unknown> | null) => void;
  /** Runs one row; turns thrown API errors into row errors so the other rows are still checked. */
  guard: (row: number, key: string, fn: () => void) => void;
}

export interface EntityDef {
  kind: BulkImportKind;
  permission: Permission;
  titleAz: string;
  titleEn: string;
  descriptionAz: string;
  descriptionEn: string;
  matchByAz: string;
  matchByEn: string;
  sheetAz: string;
  sheetEn: string;
  columns: Col[];
  needsPassword?: boolean;
  count: (companyId: number) => number;
  /** Current data in template column order, for the "with current data" template. */
  prefill: (companyId: number) => Record<string, string | number | null>[];
  reference: (companyId: number, lang: Lang) => RefSheet[];
  apply: (ctx: Ctx, rows: Row[]) => void;
}

/* ------------------------------------------------------------------ parsing */

const norm = (s: string) => s.toLocaleLowerCase('az').replace(/[*\s_.\-()/]+/g, '');

function rawValue(v: ExcelJS.CellValue): string | number | Date | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('result' in v) return rawValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text); // e-mails become hyperlinks in Excel
    if ('error' in v) return null;
  }
  return String(v);
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const TRUE = new Set(['bəli', 'beli', 'yes', 'y', 'true', '1', 'hə', 'he', 'aktiv', 'active', 'x', '✓', '+']);
const FALSE = new Set(['xeyr', 'no', 'n', 'false', '0', 'yox', 'deaktiv', 'inactive', 'passiv']);

export const CODE_RE = /^[\p{L}\p{N}_\-.]{1,30}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function convert(col: Col, raw: string | number | Date | boolean | null, options: string[] | null, m: Ctx['m']): { value?: Value; error?: string } {
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) return { value: undefined };
  if (typeof raw === 'string' && raw.trim() === '-') return { value: CLEAR };
  const text = raw instanceof Date ? isoDate(raw) : String(raw).trim();
  switch (col.type) {
    case 'number': {
      if (typeof raw === 'number') return { value: raw };
      const t = text.replace(/[\s ]/g, '');
      const n = Number(/,\d{1,6}$/.test(t) && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, ''));
      return Number.isFinite(n) ? { value: n } : { error: m(`"${text}" rəqəm deyil`, `"${text}" is not a number`) };
    }
    case 'date': {
      if (raw instanceof Date) return { value: isoDate(raw) };
      if (typeof raw === 'number' && raw > 20000 && raw < 80000) return { value: isoDate(new Date(Date.UTC(1899, 11, 30) + raw * 86400000)) };
      let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      if (r) return { value: `${r[1]}-${pad(+r[2])}-${pad(+r[3])}` };
      r = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
      if (r) return { value: `${r[3]}-${pad(+r[2])}-${pad(+r[1])}` };
      return { error: m(`"${text}" tarix deyil (İİİİ-AA-GG və ya GG.AA.İİİİ)`, `"${text}" is not a date (YYYY-MM-DD or DD.MM.YYYY)`) };
    }
    case 'bool': {
      const t = text.toLocaleLowerCase('az');
      if (TRUE.has(t)) return { value: true };
      if (FALSE.has(t)) return { value: false };
      return { error: m(`"${text}" — Bəli və ya Xeyr yazın`, `"${text}" — write Yes or No`) };
    }
    case 'enum': {
      const hit = options?.find((o) => o.toUpperCase() === text.toUpperCase());
      return hit ? { value: hit } : { error: m(`"${text}" icazəli dəyər deyil (${options?.join(', ')})`, `"${text}" is not an allowed value (${options?.join(', ')})`) };
    }
    case 'list':
      return { value: text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean) };
    case 'email':
      return EMAIL_RE.test(text) ? { value: text.toLowerCase() } : { error: m(`"${text}" düzgün e-poçt deyil`, `"${text}" is not a valid e-mail`) };
    case 'code':
      return CODE_RE.test(text) ? { value: text } : { error: m(`"${text}" — kodda yalnız hərf, rəqəm, - _ . ola bilər (ən çox 30)`, `"${text}" — codes may only contain letters, digits, - _ . (max 30)`) };
    default:
      return { value: text };
  }
}

interface Parsed { columns: ImportColumn[]; rows: Row[]; errors: ImportIssue[]; warnings: ImportIssue[] }

export async function parseFile(def: EntityDef, companyId: number, buffer: Buffer, m: Ctx['m']): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { columns: [], rows: [], errors: [{ row: 0, message: m('Fayl oxunmadı: düzgün .xlsx faylı deyil', 'The file could not be read: not a valid .xlsx file'), level: 'error' }], warnings: [] };
  }
  const wanted = new Set([norm(def.sheetAz), norm(def.sheetEn)]);
  const ws = wb.worksheets.find((w) => wanted.has(norm(w.name))) ?? wb.worksheets[0];
  if (!ws) return { columns: [], rows: [], errors: [{ row: 0, message: m('Faylda vərəq yoxdur', 'The file has no worksheet'), level: 'error' }], warnings: [] };

  const lookup = new Map<string, Col>();
  for (const c of def.columns) for (const h of [c.az, c.en, c.key]) lookup.set(norm(h), c);

  // header row = the row (within the first 10) that matches the most known headers
  let headerRow = 0;
  let best = 0;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    let n = 0;
    ws.getRow(r).eachCell((cell) => { if (lookup.has(norm(String(rawValue(cell.value) ?? '')))) n++; });
    if (n > best) { best = n; headerRow = r; }
  }
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const columns: ImportColumn[] = [];
  const byIndex = new Map<number, Col>();
  if (headerRow) {
    ws.getRow(headerRow).eachCell((cell, idx) => {
      const header = String(rawValue(cell.value) ?? '').trim();
      if (!header) return;
      const col = lookup.get(norm(header));
      if (col && [...byIndex.values()].includes(col)) {
        warnings.push({ row: headerRow, message: m(`"${header}" sütunu təkrarlanır — yalnız birincisi istifadə olunur`, `Column "${header}" is repeated — only the first is used`), level: 'warning' });
        columns.push({ index: idx, header, field: null });
        return;
      }
      if (col) byIndex.set(idx, col);
      else warnings.push({ row: headerRow, message: m(`"${header}" sütunu tanınmadı və nəzərə alınmır`, `Column "${header}" is not recognised and is ignored`), level: 'warning' });
      columns.push({ index: idx, header, field: col?.key ?? null });
    });
  }
  const present = new Set(byIndex.values());
  const missing = def.columns.filter((c) => c.required === true && !present.has(c));
  if (!headerRow || missing.length) {
    errors.push({
      row: headerRow, level: 'error',
      message: m(`Mütləq sütunlar tapılmadı: ${missing.map((c) => c.az).join(', ')}. Şablonu yükləyib başlıqları dəyişmədən istifadə edin.`,
        `Required columns not found: ${missing.map((c) => c.en).join(', ')}. Download the template and keep its headers.`),
    });
    return { columns, rows: [], errors, warnings };
  }

  const options = new Map(def.columns.filter((c) => c.options).map((c) => [c.key, c.options!(companyId)]));
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const xr = ws.getRow(r);
    const v: Record<string, Value> = {};
    let any = false;
    const rowErrors: string[] = [];
    for (const [idx, col] of byIndex) {
      const raw = rawValue(xr.getCell(idx).value);
      const res = convert(col, raw, options.get(col.key) ?? null, m);
      if (res.error) rowErrors.push(`${m(col.az, col.en)}: ${res.error}`);
      if (res.value !== undefined || res.error) any = true;
      v[col.key] = res.value;
    }
    if (!any) continue;
    for (const e of rowErrors) errors.push({ row: r, message: e, level: 'error' });
    for (const col of def.columns) {
      if (col.required === true && (v[col.key] === undefined || v[col.key] === CLEAR) && !rowErrors.length) {
        errors.push({ row: r, message: m(`"${col.az}" boşdur`, `"${col.en}" is empty`), level: 'error' });
      }
    }
    rows.push({ row: r, v });
  }
  if (!rows.length) errors.push({ row: 0, message: m('Faylda məlumat sətri yoxdur', 'The file has no data rows'), level: 'error' });
  return { columns, rows, errors, warnings };
}

/* ------------------------------------------------------------------ run */

const ROLLBACK = Symbol('rollback');

export async function runImport(def: EntityDef, user: UserRow, buffer: Buffer, opts: ImportOptions): Promise<BulkImportReport> {
  const companyId = user.company_id!;
  const m = (az: string, en: string) => (opts.lang === 'en' ? en : az);
  const parsed = await parseFile(def, companyId, buffer, m);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const results: BulkImportReport['rows'] = [];
  const counts = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, SKIP: 0, ERROR: 0 };
  const errorRows = new Set(errors.filter((e) => e.row > 0).map((e) => e.row));

  const ctx: Ctx = {
    companyId, user, opts, m,
    error: (row, message) => { errors.push({ row, message, level: 'error' }); errorRows.add(row); },
    warn: (row, message) => { warnings.push({ row, message, level: 'warning' }); },
    result: (row, key, action, changes = []) => { counts[action]++; if (results.length < 1000) results.push({ row, key, action, changes }); },
    audit: (entity, id, action, changes) => audit(companyId, user.id, entity, Number(id), action, { ...changes, source: 'EXCEL_BULK' }),
    guard: (row, key, fn) => {
      try { fn(); } catch (e) {
        if (e === ROLLBACK) throw e;
        const msg = e instanceof HttpError ? e.message : (e as Error).message;
        ctx.error(row, msg);
        ctx.result(row, key, 'ERROR');
      }
    },
  };

  const fileLevelError = parsed.rows.length === 0;
  if (!fileLevelError) {
    // rows with conversion errors are reported but not applied
    const good = parsed.rows.filter((r) => !errorRows.has(r.row));
    for (const r of parsed.rows) if (errorRows.has(r.row)) ctx.result(r.row, String(Object.values(r.v).find((x) => typeof x === 'string') ?? ''), 'ERROR');
    try {
      tx(() => {
        def.apply(ctx, good);
        if (opts.dryRun || errors.length) throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }
  results.sort((a, b) => a.row - b.row);
  const applied = !opts.dryRun && !errors.length && !fileLevelError;
  const report: BulkImportReport = {
    kind: def.kind, dryRun: opts.dryRun, applied, rowsRead: parsed.rows.length,
    rowsValid: parsed.rows.filter((r) => !errorRows.has(r.row)).length, created: counts.CREATE, updated: counts.UPDATE, unchanged: counts.UNCHANGED, skipped: counts.SKIP,
    columns: parsed.columns, errors: errors.slice(0, 1000), warnings: warnings.slice(0, 1000), rows: results, jobId: null,
  };
  report.jobId = Number(run(
    `INSERT INTO import_jobs (company_id, kind, target_id, file_name, mode, status, rows_read, rows_valid, total, created_count, updated_count, unchanged_count, errors, mapping, user_id, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?)`,
    companyId, def.kind, opts.fileName, opts.mode, applied ? 'APPLIED' : errors.length ? 'FAILED' : 'VALIDATED', report.rowsRead, report.rowsValid,
    applied ? report.created : 0, applied ? report.updated : 0, applied ? report.unchanged : 0,
    JSON.stringify([...errors, ...warnings].slice(0, 500)), user.id, nowIso(),
  ).lastInsertRowid);
  if (applied) audit(companyId, user.id, 'IMPORT_JOB', report.jobId, 'BULK_IMPORTED', { kind: def.kind, created: report.created, updated: report.updated, unchanged: report.unchanged });
  return report;
}

/* ------------------------------------------------------------------ helpers for entity apply() */

/** Assigns `next` to `target[key]` if it differs and records the change. undefined = keep, CLEAR = null. */
export function setField<T extends Record<string, unknown>>(target: T, key: keyof T & string, next: unknown, changes: string[], label: string): void {
  if (next === undefined) return;
  const value = next === CLEAR ? null : next;
  const cur = target[key];
  const same = Array.isArray(value) && Array.isArray(cur) ? [...value].sort().join(',') === [...cur].sort().join(',') : (cur ?? null) === (value ?? null);
  if (!same) { (target as Record<string, unknown>)[key] = value; changes.push(label); }
}

export const str = (v: Value): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
export const clearable = (v: Value): string | null | undefined => (v === CLEAR ? null : str(v));
export const bool = (v: Value, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export function userIdByEmail(companyId: number, email: Value): number | null | undefined {
  if (email === undefined) return undefined;
  if (email === CLEAR) return null;
  const u = get<{ id: number }>('SELECT id FROM users WHERE company_id = ? AND email = ? COLLATE NOCASE', companyId, String(email));
  return u ? u.id : -1;
}

/**
 * Processes rows whose parent is resolvable first, so children may appear before their parents in the file.
 * `parentOf` returns the parent key of a row (or null for top level); `exists` says whether a key is already in the database.
 */
export function inDependencyOrder(rows: Row[], keyOf: (r: Row) => string | undefined, parentOf: (r: Row) => string | null | undefined,
  exists: (key: string) => boolean, onUnresolved: (r: Row, parent: string) => void, fn: (r: Row) => void): void {
  let pending = [...rows];
  const inFile = new Set(rows.map(keyOf).filter((k): k is string => !!k).map((k) => k.toUpperCase()));
  while (pending.length) {
    const next: Row[] = [];
    let progress = false;
    for (const r of pending) {
      const p = parentOf(r);
      const key = keyOf(r)?.toUpperCase();
      if (p && !exists(p) && inFile.has(p.toUpperCase()) && p.toUpperCase() !== key) { next.push(r); continue; }
      fn(r);
      progress = true;
    }
    if (!progress) { for (const r of next) onUnresolved(r, parentOf(r)!); return; }
    pending = next;
  }
}

/* ------------------------------------------------------------------ template */

const BRAND = 'FF2350D0';

export async function buildTemplate(def: EntityDef, companyId: number, lang: Lang, prefill: boolean): Promise<Buffer> {
  const L = (az: string, en: string) => (lang === 'en' ? en : az);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinBridge';
  wb.created = new Date();

  const ws = wb.addWorksheet(L(def.sheetAz, def.sheetEn), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = def.columns.map((c) => ({ header: `${L(c.az, c.en)}${c.required === true ? ' *' : ''}`, key: c.key, width: c.width ?? Math.max(14, L(c.az, c.en).length + 4) }));
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((cell, i) => {
    const col = def.columns[i - 1];
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required === true ? BRAND : 'FF6D9BE6' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.note = L(col.hintAz, col.hintEn);
  });
  if (prefill) for (const r of def.prefill(companyId)) ws.addRow(r);

  // drop-down lists for enum / bool columns, sourced from a hidden sheet
  const lists = wb.addWorksheet(L('Siyahılar', 'Lists'), { state: 'hidden' });
  let li = 0;
  def.columns.forEach((c, i) => {
    const opts = c.type === 'bool' ? [L('Bəli', 'Yes'), L('Xeyr', 'No')] : c.type === 'enum' && c.options ? c.options(companyId) : null;
    if (!opts?.length) return;
    li++;
    lists.getColumn(li).values = [c.key, ...opts];
    const letter = lists.getColumn(li).letter;
    const colLetter = ws.getColumn(i + 1).letter;
    (ws as unknown as { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add(`${colLetter}2:${colLetter}2000`, {
      type: 'list', allowBlank: true, formulae: [`'${lists.name}'!$${letter}$2:$${letter}$${opts.length + 1}`],
      showErrorMessage: false,
    });
  });
  def.columns.forEach((c, i) => {
    if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    if (c.type === 'number') ws.getColumn(i + 1).numFmt = '#,##0.######';
  });

  // instructions
  const ins = wb.addWorksheet(L('Təlimat', 'Instructions'));
  ins.columns = [{ width: 26 }, { width: 14 }, { width: 30 }, { width: 70 }, { width: 24 }];
  ins.addRow([`FinBridge — ${L(def.titleAz, def.titleEn)}`]).font = { bold: true, size: 14 };
  ins.addRow([L(def.descriptionAz, def.descriptionEn)]);
  ins.addRow([]);
  const rules = lang === 'en'
    ? [
      `Fill in the "${def.sheetEn}" sheet. Keep the header row; column order does not matter. Headers may be in Azerbaijani or English.`,
      `Existing records are matched by ${def.matchByEn} and updated; new ones are created.`,
      'An empty cell keeps the current value of an existing record. Write "-" to clear an optional value.',
      'Columns marked * are required. Yes/No columns accept Yes / No (or 1 / 0). Dates: YYYY-MM-DD or DD.MM.YYYY.',
      'Upload the file in FinBridge → Administration → Bulk import. First press "Check": nothing is written until the file has no errors.',
      'Valid codes are listed on the "Reference" sheet.',
    ]
    : [
      `"${def.sheetAz}" vərəqini doldurun. Başlıq sətrini saxlayın; sütunların ardıcıllığı fərq etmir. Başlıqlar Azərbaycan və ya ingilis dilində ola bilər.`,
      `Mövcud qeydlər ${def.matchByAz} üzrə tapılır və yenilənir; yeniləri yaradılır.`,
      'Boş xana mövcud qeydin cari dəyərini saxlayır. İstəyə bağlı dəyəri silmək üçün "-" yazın.',
      '* ilə işarələnmiş sütunlar mütləqdir. Bəli/Xeyr sütunlarına Bəli / Xeyr (və ya 1 / 0) yazın. Tarix: İİİİ-AA-GG və ya GG.AA.İİİİ.',
      'Faylı FinBridge → İdarəetmə → Toplu idxal bölməsində yükləyin. Əvvəlcə "Yoxla" basın: faylda xəta olduqca heç nə yazılmır.',
      'İcazəli kodlar "Kodlar" vərəqində verilib.',
    ];
  for (const r of rules) ins.addRow([`• ${r}`]);
  ins.addRow([]);
  const th = ins.addRow([L('Sütun', 'Column'), L('Mütləq', 'Required'), L('Format / dəyərlər', 'Format / values'), L('İzah', 'Description'), L('Nümunə', 'Example')]);
  th.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }; });
  const typeLabel: Record<CellType, [string, string]> = {
    text: ['Mətn', 'Text'], code: ['Kod (hərf, rəqəm, - _ .)', 'Code (letters, digits, - _ .)'], email: ['E-poçt', 'E-mail'], number: ['Rəqəm', 'Number'],
    date: ['Tarix', 'Date'], bool: ['Bəli / Xeyr', 'Yes / No'], enum: ['Siyahıdan', 'From list'], list: ['Vergüllə ayrılmış kodlar', 'Comma-separated codes'],
  };
  for (const c of def.columns) {
    const opts = c.type === 'enum' && c.options ? `: ${c.options(companyId).join(', ')}` : '';
    const row = ins.addRow([
      L(c.az, c.en), c.required === true ? L('Bəli', 'Yes') : c.required === 'create' ? L('Yeni qeyd üçün', 'For new records') : L('Xeyr', 'No'),
      `${L(...typeLabel[c.type])}${opts}`, L(c.hintAz, c.hintEn), L(c.exampleAz ?? '', c.exampleEn ?? c.exampleAz ?? ''),
    ]);
    row.alignment = { wrapText: true, vertical: 'top' };
  }

  // reference lists
  const refs = def.reference(companyId, lang);
  if (refs.length) {
    const ref = wb.addWorksheet(L('Kodlar', 'Reference'));
    let first = true;
    for (const r of refs) {
      if (!first) ref.addRow([]);
      first = false;
      ref.addRow([L(r.nameAz, r.nameEn)]).font = { bold: true, size: 12 };
      const h = ref.addRow(lang === 'en' ? r.headersEn : r.headersAz);
      h.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FE' } }; });
      for (const row of r.rows) ref.addRow(row);
    }
    ref.columns.forEach((c) => { c.width = 24; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function columnDtos(def: EntityDef, companyId: number, lang: Lang): BulkImportColumnDto[] {
  const L = (az: string, en: string) => (lang === 'en' ? en : az);
  return def.columns.map((c) => ({
    key: c.key, header: L(c.az, c.en), required: c.required ?? false, type: c.type,
    options: c.type === 'bool' ? [L('Bəli', 'Yes'), L('Xeyr', 'No')] : c.options?.(companyId) ?? [],
    hint: L(c.hintAz, c.hintEn), example: L(c.exampleAz ?? '', c.exampleEn ?? c.exampleAz ?? ''),
  }));
}
