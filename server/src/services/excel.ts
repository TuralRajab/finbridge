import ExcelJS from 'exceljs';
import type { Response } from 'express';
import {
  EXPORT_HEADERS, MONTH_SHORT, fieldFromHeader, monthFromHeader, roundMoney,
  type ImportField, type ImportIssue, type ImportReport, type Lang,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { badRequest } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { logEvent, MONTH_COLS, type BudgetRow } from './budgets';

/* ------------------------------------------------------------------ writing */

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  money?: boolean;
  percent?: boolean;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

const BRAND = 'FF2350D0';
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinBridge';
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = spec.columns.map((c) => ({
      header: c.header, key: c.key, width: c.width ?? (c.money ? 14 : 22),
      style: c.money ? { numFmt: MONEY_FMT } : c.percent ? { numFmt: '0.0"%"' } : {},
    }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    head.alignment = { vertical: 'middle' };
    head.height = 20;
    spec.rows.forEach((r) => ws.addRow(r));
    if (spec.totals) {
      const t = ws.addRow(spec.totals);
      t.font = { bold: true };
      t.border = { top: { style: 'thin' } };
    }
    if (spec.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export function sendWorkbook(res: Response, filename: string, buffer: Buffer): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

export function headers(lang: Lang): Record<string, string> {
  return EXPORT_HEADERS[lang];
}

export function monthColumns(lang: Lang): SheetColumn[] {
  return MONTH_SHORT[lang].map((m, i) => ({ header: m, key: `m${i + 1}`, money: true, width: 12 }));
}

/* ------------------------------------------------------------------ reading */

function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as { result: ExcelJS.CellValue }).result);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('').trim() || null;
    if ('text' in v) return String((v as { text: string }).text).trim() || null;
  }
  return String(v);
}

export function toNumber(v: string | number | null): number | null {
  if (v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface ParsedSheet {
  fields: Partial<Record<ImportField, number>>;
  months: Map<number, number>; // month -> column index
  rows: { row: number; values: (string | number | null)[] }[];
}

/** Reads the first worksheet and auto-detects the header row (first row with ≥2 recognised columns). */
export async function parseSheet(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw badRequest('IMPORT_FAILED', 'The file is not a valid .xlsx workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('IMPORT_FAILED', 'The workbook has no sheets');

  let headerRow = 0;
  const fields: Partial<Record<ImportField, number>> = {};
  const months = new Map<number, number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const row = ws.getRow(r);
    const f: Partial<Record<ImportField, number>> = {};
    const m = new Map<number, number>();
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const v = cellValue(cell.value);
      const month = monthFromHeader(v);
      if (month) { if (!m.has(month)) m.set(month, col); return; }
      const field = fieldFromHeader(v);
      if (field && f[field] === undefined) f[field] = col;
    });
    if (Object.keys(f).length + m.size >= 2) {
      headerRow = r;
      Object.assign(fields, f);
      m.forEach((col, month) => months.set(month, col));
    }
  }
  if (!headerRow) throw badRequest('IMPORT_FAILED', 'Could not find a header row with known column names');

  const rows: ParsedSheet['rows'] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: (string | number | null)[] = [];
    let any = false;
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = cellValue(row.getCell(c).value);
      values[c] = v;
      if (v !== null) any = true;
    }
    if (any) rows.push({ row: r, values });
  }
  return { fields, months, rows };
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v).trim());

/* ------------------------------------------------------------------ budget import */

export interface BudgetImportOptions {
  dryRun: boolean;
  mode: 'replace' | 'append';
  createMissing: boolean;
}

export async function importBudget(user: UserRow, budget: BudgetRow, buffer: Buffer, opts: BudgetImportOptions): Promise<ImportReport> {
  const companyId = budget.company_id;
  const sheet = await parseSheet(buffer);
  const col = (f: ImportField) => sheet.fields[f];
  const errors: ImportIssue[] = [];
  if (col('costCenterCode') === undefined) errors.push({ row: 1, message: 'Missing column: cost center code' });
  if (col('accountCode') === undefined) errors.push({ row: 1, message: 'Missing column: account code' });
  if (sheet.months.size === 0) errors.push({ row: 1, message: 'Missing month columns (Jan … Dec / Yan … Dek)' });
  if (errors.length) return emptyReport(opts.dryRun, sheet.rows.length, errors);

  const depts = new Map(all<{ id: number; code: string }>('SELECT id, code FROM departments WHERE company_id = ?', companyId).map((d) => [d.code.toUpperCase(), d.id]));
  const ccs = new Map(all<{ id: number; code: string; department_id: number }>('SELECT id, code, department_id FROM cost_centers WHERE company_id = ?', companyId).map((c) => [c.code.toUpperCase(), c]));
  const accs = new Map(all<{ id: number; code: string }>('SELECT id, code FROM accounts WHERE company_id = ?', companyId).map((a) => [a.code.toUpperCase(), a.id]));

  const newDepts = new Map<string, string>(); // code -> name
  const newCcs = new Map<string, { name: string; deptCode: string }>();
  const newAccs = new Map<string, { name: string; type: 'OPEX' | 'CAPEX' }>();
  const valid: { ccCode: string; accCode: string; description: string; months: number[] }[] = [];
  let total = 0;

  for (const { row, values } of sheet.rows) {
    const v = (f: ImportField) => (col(f) === undefined ? '' : str(values[col(f)!]));
    const ccCode = v('costCenterCode').toUpperCase();
    const accCode = v('accountCode').toUpperCase();
    const deptCode = v('departmentCode').toUpperCase();
    if (!ccCode && !accCode) continue; // subtotal / notes row
    const rowErrors: string[] = [];
    if (!ccCode) rowErrors.push('cost center code is empty');
    if (!accCode) rowErrors.push('account code is empty');

    const existingCc = ccs.get(ccCode);
    if (ccCode && !existingCc && !newCcs.has(ccCode)) {
      if (!opts.createMissing) rowErrors.push(`unknown cost center ${ccCode}`);
      else if (!deptCode) rowErrors.push(`cost center ${ccCode} is new — department code is required to create it`);
      else {
        if (!depts.has(deptCode) && !newDepts.has(deptCode)) newDepts.set(deptCode, v('departmentName') || deptCode);
        newCcs.set(ccCode, { name: v('costCenterName') || ccCode, deptCode });
      }
    } else if (existingCc && deptCode && depts.get(deptCode) !== undefined && depts.get(deptCode) !== existingCc.department_id) {
      rowErrors.push(`cost center ${ccCode} does not belong to department ${deptCode}`);
    }
    if (accCode && !accs.has(accCode) && !newAccs.has(accCode)) {
      if (!opts.createMissing) rowErrors.push(`unknown account ${accCode}`);
      else newAccs.set(accCode, { name: v('accountName') || accCode, type: v('accountType').toUpperCase() === 'CAPEX' ? 'CAPEX' : 'OPEX' });
    }
    const months = Array.from({ length: 12 }, () => 0);
    for (const [m, c] of sheet.months) {
      const n = toNumber(values[c] ?? null);
      if (n === null) rowErrors.push(`month ${m}: "${values[c]}" is not a number`);
      else months[m - 1] = roundMoney(n);
    }
    if (rowErrors.length) {
      errors.push({ row, message: rowErrors.join('; ') });
      continue;
    }
    total += months.reduce((s, x) => s + x, 0);
    valid.push({ ccCode, accCode, description: v('description'), months });
  }

  const report: ImportReport = {
    dryRun: opts.dryRun,
    rowsRead: sheet.rows.length,
    rowsValid: valid.length,
    total: roundMoney(total),
    created: { departments: [...newDepts.keys()], costCenters: [...newCcs.keys()], accounts: [...newAccs.keys()] },
    errors,
    applied: false,
  };
  if (opts.dryRun || errors.length || !valid.length) return report;

  tx(() => {
    for (const [code, name] of newDepts) {
      depts.set(code, run('INSERT INTO departments (company_id, code, name) VALUES (?, ?, ?)', companyId, code, name).lastInsertRowid);
      if (budget.status === 'COLLECTING') {
        run('INSERT OR IGNORE INTO budget_departments (budget_id, department_id) VALUES (?, ?)', budget.id, depts.get(code)!);
      }
    }
    for (const [code, c] of newCcs) {
      const deptId = depts.get(c.deptCode)!;
      const id = run('INSERT INTO cost_centers (company_id, department_id, code, name) VALUES (?, ?, ?, ?)', companyId, deptId, code, c.name).lastInsertRowid;
      ccs.set(code, { id, code, department_id: deptId });
    }
    for (const [code, a] of newAccs) {
      accs.set(code, run('INSERT INTO accounts (company_id, code, name, type) VALUES (?, ?, ?, ?)', companyId, code, a.name, a.type).lastInsertRowid);
    }
    if (opts.mode === 'replace') run('DELETE FROM budget_lines WHERE budget_id = ?', budget.id);
    const insert = `INSERT INTO budget_lines (budget_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, updated_by)
                    VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?)`;
    for (const l of valid) {
      run(insert, budget.id, ccs.get(l.ccCode)!.id, accs.get(l.accCode)!, l.description, ...l.months, user.id);
    }
    logEvent({ budgetId: budget.id, userId: user.id, action: 'imported', comment: `${valid.length} lines (${opts.mode})` });
  });
  return { ...report, applied: true };
}

/* ------------------------------------------------------------------ actuals import */

export async function importActuals(user: UserRow, companyId: number, year: number, buffer: Buffer, dryRun: boolean): Promise<ImportReport> {
  const sheet = await parseSheet(buffer);
  const col = (f: ImportField) => sheet.fields[f];
  const errors: ImportIssue[] = [];
  const wide = sheet.months.size > 0;
  if (col('costCenterCode') === undefined) errors.push({ row: 1, message: 'Missing column: cost center code' });
  if (col('accountCode') === undefined) errors.push({ row: 1, message: 'Missing column: account code' });
  if (!wide && (col('month') === undefined || col('amount') === undefined)) {
    errors.push({ row: 1, message: 'Use either month columns (Jan … Dec) or "Month" + "Amount" columns' });
  }
  if (errors.length) return emptyReport(dryRun, sheet.rows.length, errors);

  const ccs = new Map(all<{ id: number; code: string }>('SELECT id, code FROM cost_centers WHERE company_id = ?', companyId).map((c) => [c.code.toUpperCase(), c.id]));
  const accs = new Map(all<{ id: number; code: string }>('SELECT id, code FROM accounts WHERE company_id = ?', companyId).map((a) => [a.code.toUpperCase(), a.id]));
  const entries = new Map<string, { cc: number; acc: number; month: number; amount: number }>();
  let rowsValid = 0;

  for (const { row, values } of sheet.rows) {
    const v = (f: ImportField) => (col(f) === undefined ? '' : str(values[col(f)!]));
    const ccCode = v('costCenterCode').toUpperCase();
    const accCode = v('accountCode').toUpperCase();
    if (!ccCode && !accCode) continue;
    const rowErrors: string[] = [];
    const cc = ccs.get(ccCode);
    const acc = accs.get(accCode);
    if (!cc) rowErrors.push(`unknown cost center ${ccCode || '(empty)'}`);
    if (!acc) rowErrors.push(`unknown account ${accCode || '(empty)'}`);
    const amounts: { month: number; amount: number }[] = [];
    if (wide) {
      for (const [m, c] of sheet.months) {
        if (values[c] === null || values[c] === undefined) continue;
        const n = toNumber(values[c]);
        if (n === null) rowErrors.push(`month ${m}: "${values[c]}" is not a number`);
        else amounts.push({ month: m, amount: roundMoney(n) });
      }
    } else {
      const month = Number(toNumber(values[col('month')!] ?? null));
      const n = toNumber(values[col('amount')!] ?? null);
      if (!Number.isInteger(month) || month < 1 || month > 12) rowErrors.push('month must be 1–12');
      if (n === null) rowErrors.push('amount is not a number');
      if (Number.isInteger(month) && n !== null) amounts.push({ month, amount: roundMoney(n) });
    }
    if (rowErrors.length) { errors.push({ row, message: rowErrors.join('; ') }); continue; }
    rowsValid++;
    for (const a of amounts) {
      const key = `${cc}:${acc}:${a.month}`;
      const prev = entries.get(key);
      entries.set(key, { cc: cc!, acc: acc!, month: a.month, amount: roundMoney((prev?.amount ?? 0) + a.amount) });
    }
  }
  const total = roundMoney([...entries.values()].reduce((s, e) => s + e.amount, 0));
  const report: ImportReport = {
    dryRun, rowsRead: sheet.rows.length, rowsValid, total,
    created: { departments: [], costCenters: [], accounts: [] }, errors, applied: false,
  };
  if (dryRun || errors.length || !entries.size) return report;
  tx(() => {
    for (const e of entries.values()) upsertActual(companyId, year, e.month, e.cc, e.acc, e.amount, 'excel', user.id);
  });
  return { ...report, applied: true };
}

export function upsertActual(companyId: number, year: number, month: number, cc: number, acc: number, amount: number, source: 'manual' | 'excel', userId: number): void {
  run(
    `INSERT INTO actuals (company_id, year, month, cost_center_id, account_id, amount, source, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, year, month, cost_center_id, account_id)
     DO UPDATE SET amount = excluded.amount, source = excluded.source, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    companyId, year, month, cc, acc, amount, source, userId,
  );
}

function emptyReport(dryRun: boolean, rowsRead: number, errors: ImportIssue[]): ImportReport {
  return { dryRun, rowsRead, rowsValid: 0, total: 0, created: { departments: [], costCenters: [], accounts: [] }, errors, applied: false };
}

/* ------------------------------------------------------------------ templates */

export async function budgetTemplate(companyId: number, lang: Lang): Promise<Buffer> {
  const h = headers(lang);
  const ccs = all<{ dept: string; code: string; name: string }>(
    'SELECT d.code AS dept, c.code, c.name FROM cost_centers c JOIN departments d ON d.id = c.department_id WHERE c.company_id = ? AND c.is_active = 1 ORDER BY c.code', companyId,
  );
  const accs = all<{ code: string; name: string; type: string }>('SELECT code, name, type FROM accounts WHERE company_id = ? AND is_active = 1 ORDER BY code', companyId);
  const example = ccs[0] && accs[0]
    ? [{ departmentCode: ccs[0].dept, costCenterCode: ccs[0].code, accountCode: accs[0].code, description: lang === 'az' ? 'Nümunə sətir' : 'Example line', ...Object.fromEntries(MONTH_COLS.map((m) => [m, 1000])) }]
    : [];
  return buildWorkbook([
    {
      name: lang === 'az' ? 'Büdcə' : 'Budget',
      columns: [
        { header: h.departmentCode, key: 'departmentCode', width: 16 },
        { header: h.costCenterCode, key: 'costCenterCode', width: 18 },
        { header: h.accountCode, key: 'accountCode', width: 14 },
        { header: h.description, key: 'description', width: 28 },
        ...monthColumns(lang),
      ],
      rows: example,
    },
    { name: h.costCenterName, columns: [{ header: h.departmentCode, key: 'dept' }, { header: h.code, key: 'code' }, { header: h.name, key: 'name', width: 30 }], rows: ccs },
    { name: h.accountName, columns: [{ header: h.code, key: 'code' }, { header: h.name, key: 'name', width: 30 }, { header: h.accountType, key: 'type' }], rows: accs },
  ]);
}

export async function actualsTemplate(companyId: number, lang: Lang): Promise<Buffer> {
  const h = headers(lang);
  const combos = all<{ cc: string; acc: string }>(
    `SELECT DISTINCT c.code AS cc, a.code AS acc FROM budget_lines bl
       JOIN budgets b ON b.id = bl.budget_id JOIN cost_centers c ON c.id = bl.cost_center_id JOIN accounts a ON a.id = bl.account_id
      WHERE b.company_id = ? ORDER BY c.code, a.code`, companyId,
  );
  return buildWorkbook([{
    name: lang === 'az' ? 'Fakt' : 'Actuals',
    columns: [
      { header: h.costCenterCode, key: 'costCenterCode', width: 18 },
      { header: h.accountCode, key: 'accountCode', width: 14 },
      ...monthColumns(lang),
    ],
    rows: combos.map((c) => ({ costCenterCode: c.cc, accountCode: c.acc })),
  }]);
}

export function assertUploadedFile(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw badRequest('IMPORT_FAILED', 'No file uploaded (field name "file")');
  if (!/\.xlsx$/i.test(file.originalname)) throw badRequest('IMPORT_FAILED', 'Only .xlsx files are supported');
  return file.buffer;
}

export function companyName(companyId: number): string {
  return get<{ name: string }>('SELECT name FROM companies WHERE id = ?', companyId)?.name ?? 'company';
}
