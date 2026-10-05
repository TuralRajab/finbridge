import ExcelJS from 'exceljs';
import type { Response } from 'express';
import {
  EXPORT_HEADERS, MONTH_SHORT, fieldFromHeader, monthFromHeader, roundMoney,
  type ImportColumn, type ImportField, type ImportIssue, type ImportReport, type Lang,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { AccountIndex } from './accounts';
import { ensureSections, loadVersion, MONTH_COLS, type BudgetRow } from './budgets';
import { OrgIndex } from './org';
import { companyRow } from './settings';

/* ------------------------------------------------------------------ writing */

export interface SheetColumn { header: string; key: string; width?: number; money?: boolean; percent?: boolean }
export interface SheetSpec { name: string; columns: SheetColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> }

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinBridge';
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = spec.columns.map((c) => ({
      header: c.header, key: c.key, width: c.width ?? (c.money ? 14 : 22),
      style: c.money ? { numFmt: MONEY_FMT } : c.percent ? { numFmt: '0.0"%"' } : {},
    }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2350D0' } };
    head.height = 20;
    spec.rows.forEach((r) => ws.addRow(r));
    if (spec.totals) {
      const t = ws.addRow(spec.totals);
      t.font = { bold: true };
      t.border = { top: { style: 'thin' } };
    }
    if (spec.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export function sendWorkbook(res: Response, filename: string, buffer: Buffer): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

export const headers = (lang: Lang) => EXPORT_HEADERS[lang];
export const monthColumns = (lang: Lang): SheetColumn[] => MONTH_SHORT[lang].map((m, i) => ({ header: m, key: `m${i + 1}`, money: true, width: 12 }));

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

export function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Column index → field ("costCenterCode", "m3", …) or "" to ignore. Supplied by the user to override auto-mapping. */
export type ColumnMapping = Record<string, string>;

export interface ParsedSheet {
  columns: ImportColumn[];
  fields: Partial<Record<ImportField, number>>;
  months: Map<number, number>;
  rows: { row: number; values: (string | number | null)[] }[];
}

/** Reads the first worksheet; auto-detects the header row and columns, then applies the user's mapping overrides. */
export async function parseSheet(buffer: Buffer, mapping?: ColumnMapping): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw badRequest('IMPORT_FAILED', 'The file is not a valid .xlsx workbook'); }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('IMPORT_FAILED', 'The workbook has no sheets');
  let headerRow = 0;
  let detected: ImportColumn[] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const cols: ImportColumn[] = [];
    let known = 0;
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const v = cellValue(cell.value);
      const month = monthFromHeader(v);
      const field = month ? `m${month}` : fieldFromHeader(v);
      if (field) known++;
      cols.push({ index: col, header: String(v ?? ''), field });
    });
    if (known >= 2) { headerRow = r; detected = cols; }
  }
  if (!headerRow) {
    // Unknown headers: fall back to the first non-empty row so the user can map the columns by hand.
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
      const cols: ImportColumn[] = [];
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => { cols.push({ index: col, header: String(cellValue(cell.value) ?? ''), field: null }); });
      if (cols.length >= 2) { headerRow = r; detected = cols; }
    }
    if (!headerRow || !mapping) {
      throw badRequest('IMPORT_FAILED', 'Could not find a header row with known column names', headerRow ? { columns: detected, needsMapping: true } : undefined);
    }
  }
  const columns = detected.map((c) => (mapping && String(c.index) in mapping ? { ...c, field: mapping[String(c.index)] || null } : c));
  const fields: Partial<Record<ImportField, number>> = {};
  const months = new Map<number, number>();
  for (const c of columns) {
    if (!c.field) continue;
    const m = /^m(\d{1,2})$/.exec(c.field);
    if (m) { if (!months.has(Number(m[1]))) months.set(Number(m[1]), c.index); }
    else if (fields[c.field as ImportField] === undefined) fields[c.field as ImportField] = c.index;
  }
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
  return { columns, fields, months, rows };
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v).trim());

function logJob(companyId: number, userId: number, kind: 'BUDGET' | 'ACTUALS', targetId: number | null, fileName: string, mode: string | null,
  report: ImportReport, mapping: ColumnMapping | undefined): number {
  return run(
    `INSERT INTO import_jobs (company_id, kind, target_id, file_name, mode, status, rows_read, rows_valid, total, errors, mapping, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, kind, targetId, fileName, mode, report.applied ? 'APPLIED' : report.errors.length ? 'FAILED' : 'VALIDATED',
    report.rowsRead, report.rowsValid, report.total, JSON.stringify([...report.errors, ...report.warnings].slice(0, 500)),
    mapping ? JSON.stringify(mapping) : null, userId, nowIso(),
  ).lastInsertRowid;
}

function emptyReport(dryRun: boolean, columns: ImportColumn[], rowsRead: number, errors: ImportIssue[]): ImportReport {
  return { dryRun, rowsRead, rowsValid: 0, total: 0, columns, created: { units: [], costCenters: [], accounts: [] }, errors, warnings: [], applied: false, jobId: null };
}

/* ------------------------------------------------------------------ budget import */

export interface BudgetImportOptions { dryRun: boolean; mode: 'replace' | 'append'; createMissing: boolean; mapping?: ColumnMapping; fileName: string }

/**
 * Validates everything before writing anything: unknown codes, group / non-budgetable accounts,
 * cost-center account restrictions, non-numeric amounts and duplicate cost center × account rows.
 */
export async function importBudget(user: UserRow, budget: BudgetRow, buffer: Buffer, opts: BudgetImportOptions): Promise<ImportReport> {
  const companyId = budget.company_id;
  const version = loadVersion(budget);
  const sheet = await parseSheet(buffer, opts.mapping);
  const col = (f: ImportField) => sheet.fields[f];
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  if (version.status !== 'DRAFT') errors.push({ row: 0, message: 'The current budget version is not a draft' });
  if (col('costCenterCode') === undefined) errors.push({ row: 1, message: 'Missing column: cost center code' });
  if (col('accountCode') === undefined) errors.push({ row: 1, message: 'Missing column: account code' });
  if (sheet.months.size === 0) errors.push({ row: 1, message: 'Missing month columns (Jan … Dec / Yan … Dek)' });
  if (errors.length) {
    const r = emptyReport(opts.dryRun, sheet.columns, sheet.rows.length, errors);
    r.jobId = logJob(companyId, user.id, 'BUDGET', budget.id, opts.fileName, opts.mode, r, opts.mapping);
    return r;
  }
  const org = OrgIndex.load(companyId);
  const accs = AccountIndex.load(companyId);
  const unitsByCode = new Map([...org.units.values()].map((u) => [u.code.toUpperCase(), u]));
  const ccByCode = new Map([...org.costCenters.values()].map((c) => [c.code.toUpperCase(), c]));
  const newUnits = new Map<string, string>();
  const newCcs = new Map<string, { name: string; unitCode: string }>();
  const newAccs = new Map<string, { name: string; cls: 'OPEX' | 'CAPEX' }>();
  const seen = new Map<string, number>();
  const existing = new Set(opts.mode === 'append'
    ? all<{ k: string }>("SELECT cost_center_id || ':' || account_id AS k FROM budget_lines WHERE version_id = ?", version.id).map((r) => r.k) : []);
  const valid: { ccCode: string; accCode: string; description: string; months: number[] }[] = [];
  let total = 0;

  for (const { row, values } of sheet.rows) {
    const v = (f: ImportField) => (col(f) === undefined ? '' : str(values[col(f)!]));
    const ccCode = v('costCenterCode').toUpperCase();
    const accCode = v('accountCode').toUpperCase();
    const unitCode = v('departmentCode').toUpperCase();
    if (!ccCode && !accCode) continue;
    const rowErrors: string[] = [];
    if (!ccCode) rowErrors.push('cost center code is empty');
    if (!accCode) rowErrors.push('account code is empty');
    const cc = ccByCode.get(ccCode);
    if (ccCode && !cc && !newCcs.has(ccCode)) {
      if (!opts.createMissing) rowErrors.push(`unknown cost center ${ccCode}`);
      else if (!unitCode) rowErrors.push(`cost center ${ccCode} is new — an org unit (department) code is required to create it`);
      else {
        if (!unitsByCode.has(unitCode) && !newUnits.has(unitCode)) newUnits.set(unitCode, v('departmentName') || unitCode);
        newCcs.set(ccCode, { name: v('costCenterName') || ccCode, unitCode });
      }
    } else if (cc && unitCode && unitsByCode.has(unitCode)) {
      const unit = unitsByCode.get(unitCode)!;
      if (!org.subtree(unit.id).has(cc.orgUnitId)) rowErrors.push(`cost center ${ccCode} does not belong to ${unitCode}`);
    }
    const acc = accs.byCode.get(accCode);
    if (accCode && !acc && !newAccs.has(accCode)) {
      if (!opts.createMissing) rowErrors.push(`unknown account ${accCode}`);
      else newAccs.set(accCode, { name: v('accountName') || accCode, cls: v('accountType').toUpperCase() === 'CAPEX' ? 'CAPEX' : 'OPEX' });
    } else if (acc) {
      if (acc.isGroup) rowErrors.push(`account ${accCode} is a group account`);
      else if (!acc.allowBudgeting || !acc.isActive) rowErrors.push(`account ${accCode} is not open for budgeting`);
      else if (cc) {
        const restr = accs.ccRestrictions.get(cc.id);
        if (restr && restr.size && !restr.has(acc.id)) rowErrors.push(`account ${accCode} is not allowed on ${ccCode}`);
      }
    }
    const months = Array.from({ length: 12 }, () => 0);
    for (const [m, c] of sheet.months) {
      const n = toNumber(values[c] ?? null);
      if (n === null) rowErrors.push(`month ${m}: "${values[c]}" is not a number`);
      else months[m - 1] = roundMoney(n);
    }
    const key = `${ccCode}:${accCode}`;
    if (seen.has(key)) rowErrors.push(`duplicate of row ${seen.get(key)} (same cost center and account)`);
    if (rowErrors.length) { errors.push({ row, message: rowErrors.join('; '), level: 'error' }); continue; }
    seen.set(key, row);
    if (cc && acc && existing.has(`${cc.id}:${acc.id}`)) warnings.push({ row, message: `${ccCode} / ${accCode} already has a line — a second line will be added`, level: 'warning' });
    total += months.reduce((s, x) => s + x, 0);
    valid.push({ ccCode, accCode, description: v('description'), months });
  }

  const report: ImportReport = {
    dryRun: opts.dryRun, rowsRead: sheet.rows.length, rowsValid: valid.length, total: roundMoney(total), columns: sheet.columns,
    created: { units: [...newUnits.keys()], costCenters: [...newCcs.keys()], accounts: [...newAccs.keys()] }, errors, warnings, applied: false, jobId: null,
  };
  if (opts.dryRun || errors.length || !valid.length) {
    report.jobId = logJob(companyId, user.id, 'BUDGET', budget.id, opts.fileName, opts.mode, report, opts.mapping);
    return report;
  }
  tx(() => {
    const ts = nowIso();
    const deptType = get<{ id: number }>("SELECT id FROM org_unit_types WHERE company_id = ? AND code = 'DEPARTMENT'", companyId)!.id;
    const unitIds = new Map([...unitsByCode.entries()].map(([k, u]) => [k, u.id]));
    for (const [code, name] of newUnits) {
      unitIds.set(code, run('INSERT INTO org_units (company_id, type_id, parent_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        companyId, deptType, org.root().id, code, name, ts, ts).lastInsertRowid);
    }
    const ccIds = new Map([...ccByCode.entries()].map(([k, c]) => [k, c.id]));
    const currency = companyRow(companyId).base_currency;
    for (const [code, c] of newCcs) {
      ccIds.set(code, run('INSERT INTO cost_centers (company_id, org_unit_id, code, name, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        companyId, unitIds.get(c.unitCode)!, code, c.name, currency, ts, ts).lastInsertRowid);
    }
    const accIds = new Map([...accs.byCode.entries()].map(([k, a]) => [k, a.id]));
    if (newAccs.size) {
      const parent = get<{ id: number }>("SELECT id FROM accounts WHERE company_id = ? AND parent_id IS NULL AND account_type = 'EXPENSE' ORDER BY sort_order LIMIT 1", companyId);
      for (const [code, a] of newAccs) {
        accIds.set(code, run(`INSERT INTO accounts (company_id, parent_id, code, name, account_type, expense_class, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId, parent?.id ?? null, code, a.name, a.cls === 'CAPEX' ? 'CAPEX' : 'EXPENSE', parent ? null : a.cls, ts, ts).lastInsertRowid);
      }
    }
    if (opts.mode === 'replace') run('DELETE FROM budget_lines WHERE version_id = ?', version.id);
    for (const l of valid) {
      run(`INSERT INTO budget_lines (version_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?, ?, ?)`,
        version.id, ccIds.get(l.ccCode)!, accIds.get(l.accCode)!, l.description, ...l.months, ts, user.id, ts);
    }
    const idx = OrgIndex.load(companyId);
    ensureSections(companyId, version.id, idx);
    for (const unitId of new Set(valid.map((l) => idx.sectionOfCostCenter(ccIds.get(l.ccCode)!).id))) {
      run("UPDATE budget_sections SET status = 'IN_PROGRESS' WHERE version_id = ? AND org_unit_id = ? AND status = 'NOT_STARTED'", version.id, unitId);
    }
    report.applied = true;
    report.jobId = logJob(companyId, user.id, 'BUDGET', budget.id, opts.fileName, opts.mode, report, opts.mapping);
    audit(companyId, user.id, 'BUDGET_VERSION', version.id, 'IMPORTED', { file: opts.fileName, lines: valid.length, mode: opts.mode, total: report.total });
  });
  return report;
}

/* ------------------------------------------------------------------ actuals import */

export async function importActuals(user: UserRow, companyId: number, year: number, buffer: Buffer, opts: { dryRun: boolean; mapping?: ColumnMapping; fileName: string }): Promise<ImportReport> {
  const sheet = await parseSheet(buffer, opts.mapping);
  const col = (f: ImportField) => sheet.fields[f];
  const errors: ImportIssue[] = [];
  const wide = sheet.months.size > 0;
  if (col('costCenterCode') === undefined) errors.push({ row: 1, message: 'Missing column: cost center code' });
  if (col('accountCode') === undefined) errors.push({ row: 1, message: 'Missing column: account code' });
  if (!wide && (col('month') === undefined || col('amount') === undefined)) errors.push({ row: 1, message: 'Use either month columns (Jan … Dec) or "Month" + "Amount" columns' });
  if (errors.length) {
    const r = emptyReport(opts.dryRun, sheet.columns, sheet.rows.length, errors);
    r.jobId = logJob(companyId, user.id, 'ACTUALS', year, opts.fileName, null, r, opts.mapping);
    return r;
  }
  const org = OrgIndex.load(companyId);
  const accs = AccountIndex.load(companyId);
  const ccByCode = new Map([...org.costCenters.values()].map((c) => [c.code.toUpperCase(), c.id]));
  const entries = new Map<string, { cc: number; acc: number; month: number; amount: number; row: number }>();
  const warnings: ImportIssue[] = [];
  let rowsValid = 0;
  for (const { row, values } of sheet.rows) {
    const v = (f: ImportField) => (col(f) === undefined ? '' : str(values[col(f)!]));
    const ccCode = v('costCenterCode').toUpperCase();
    const accCode = v('accountCode').toUpperCase();
    if (!ccCode && !accCode) continue;
    const rowErrors: string[] = [];
    const cc = ccByCode.get(ccCode);
    const acc = accs.byCode.get(accCode);
    if (!cc) rowErrors.push(`unknown cost center ${ccCode || '(empty)'}`);
    if (!acc) rowErrors.push(`unknown account ${accCode || '(empty)'}`);
    else if (acc.isGroup) rowErrors.push(`account ${accCode} is a group account`);
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
    if (rowErrors.length) { errors.push({ row, message: rowErrors.join('; '), level: 'error' }); continue; }
    rowsValid++;
    for (const a of amounts) {
      const key = `${cc}:${acc!.id}:${a.month}`;
      const prev = entries.get(key);
      if (prev) warnings.push({ row, message: `duplicate of row ${prev.row} for month ${a.month} — amounts are added up`, level: 'warning' });
      entries.set(key, { cc: cc!, acc: acc!.id, month: a.month, amount: roundMoney((prev?.amount ?? 0) + a.amount), row });
    }
  }
  const report: ImportReport = {
    dryRun: opts.dryRun, rowsRead: sheet.rows.length, rowsValid, total: roundMoney([...entries.values()].reduce((s, e) => s + e.amount, 0)),
    columns: sheet.columns, created: { units: [], costCenters: [], accounts: [] }, errors, warnings, applied: false, jobId: null,
  };
  if (opts.dryRun || errors.length || !entries.size) {
    report.jobId = logJob(companyId, user.id, 'ACTUALS', year, opts.fileName, null, report, opts.mapping);
    return report;
  }
  tx(() => {
    for (const e of entries.values()) upsertActualCell(companyId, year, e.month, e.cc, e.acc, e.amount, 'EXCEL', user.id);
    report.applied = true;
    report.jobId = logJob(companyId, user.id, 'ACTUALS', year, opts.fileName, null, report, opts.mapping);
    audit(companyId, user.id, 'ACTUALS', year, 'IMPORTED', { file: opts.fileName, cells: entries.size, total: report.total });
  });
  return report;
}

/** Manual / Excel actual for a cell (one row per cell; request-linked actuals are separate). */
export function upsertActualCell(companyId: number, year: number, month: number, cc: number, acc: number, amount: number, source: 'MANUAL' | 'EXCEL', userId: number): void {
  const ts = nowIso();
  const existing = get<{ id: number; amount: number }>(
    'SELECT id, amount FROM actuals WHERE company_id = ? AND fiscal_year = ? AND month = ? AND cost_center_id = ? AND account_id = ? AND purchase_request_id IS NULL',
    companyId, year, month, cc, acc,
  );
  if (existing) {
    if (existing.amount === amount) return;
    run('UPDATE actuals SET amount = ?, source = ?, created_by = ?, updated_at = ? WHERE id = ?', amount, source, userId, ts, existing.id);
    audit(companyId, userId, 'ACTUAL', existing.id, 'UPDATED', { amount: [existing.amount, amount], source });
  } else {
    const id = run(`INSERT INTO actuals (company_id, fiscal_year, month, cost_center_id, account_id, amount, source, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, companyId, year, month, cc, acc, amount, source, userId, ts, ts).lastInsertRowid;
    if (source === 'MANUAL') audit(companyId, userId, 'ACTUAL', id, 'CREATED', { amount, month, costCenterId: cc, accountId: acc });
  }
}

/* ------------------------------------------------------------------ templates */

export async function budgetTemplate(companyId: number, lang: Lang): Promise<Buffer> {
  const h = headers(lang);
  const org = OrgIndex.load(companyId);
  const ccs = [...org.costCenters.values()].filter((c) => c.isActive).map((c) => ({ unit: org.sectionOf(c.orgUnitId).code, code: c.code, name: c.name }));
  const accs = all<{ code: string; name: string; type: string }>(
    'SELECT code, name, account_type AS type FROM accounts WHERE company_id = ? AND is_active = 1 AND is_group = 0 AND allow_budgeting = 1 ORDER BY sort_order, code', companyId,
  );
  const example = ccs[0] && accs[0]
    ? [{ departmentCode: ccs[0].unit, costCenterCode: ccs[0].code, accountCode: accs[0].code, description: lang === 'az' ? 'Nümunə sətir' : 'Example line', ...Object.fromEntries(MONTH_COLS.map((m) => [m, 1000])) }]
    : [];
  return buildWorkbook([
    {
      name: lang === 'az' ? 'Büdcə' : 'Budget',
      columns: [
        { header: h.departmentCode, key: 'departmentCode', width: 16 }, { header: h.costCenterCode, key: 'costCenterCode', width: 18 },
        { header: h.accountCode, key: 'accountCode', width: 14 }, { header: h.description, key: 'description', width: 28 }, ...monthColumns(lang),
      ],
      rows: example,
    },
    { name: h.costCenterName, columns: [{ header: h.departmentCode, key: 'unit' }, { header: h.code, key: 'code' }, { header: h.name, key: 'name', width: 30 }], rows: ccs },
    { name: h.accountName, columns: [{ header: h.code, key: 'code' }, { header: h.name, key: 'name', width: 34 }, { header: h.accountType, key: 'type' }], rows: accs },
  ]);
}

export async function actualsTemplate(companyId: number, year: number, lang: Lang): Promise<Buffer> {
  const h = headers(lang);
  const combos = all<{ cc: string; acc: string }>(
    `SELECT DISTINCT c.code AS cc, a.code AS acc FROM budget_lines bl JOIN budgets b ON b.current_version_id = bl.version_id
       JOIN cost_centers c ON c.id = bl.cost_center_id JOIN accounts a ON a.id = bl.account_id
      WHERE b.company_id = ? AND b.fiscal_year = ? ORDER BY c.code, a.code`, companyId, year,
  );
  return buildWorkbook([{
    name: lang === 'az' ? 'Fakt' : 'Actuals',
    columns: [{ header: h.costCenterCode, key: 'costCenterCode', width: 18 }, { header: h.accountCode, key: 'accountCode', width: 14 }, ...monthColumns(lang)],
    rows: combos.map((c) => ({ costCenterCode: c.cc, accountCode: c.acc })),
  }]);
}

export function assertUploadedFile(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw badRequest('IMPORT_FAILED', 'No file uploaded (field name "file")');
  if (!/\.xlsx$/i.test(file.originalname)) throw badRequest('IMPORT_FAILED', 'Only .xlsx files are supported');
  return file.buffer;
}
