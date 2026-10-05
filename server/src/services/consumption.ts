import {
  budgetCheck, computeVariance, emptyMonths, forecastFullYear, roundMoney,
  type BudgetCheckDto, type Measures,
} from '@finbridge/shared';
import { all, get } from '../db/database';
import { costCenterFilter, type Scope } from '../lib/scope';
import { findBudgetByYear, MONTH_COLS } from './budgets';
import { companyRow, getSettings } from './settings';

/**
 * The single source of truth for budget monitoring. Every report, dashboard figure and funds check is
 * computed from these cells: current budget version lines, original approved version lines,
 * purchase/expense requests (pending / committed) and actuals — per cost center × account × month.
 */
export interface Cell {
  ccId: number;
  accId: number;
  budget: number[];
  original: number[];
  actual: number[];
  committed: number[];
  pending: number[];
}

export interface CellQuery {
  scope?: Scope;
  costCenterIds?: number[];
  accountIds?: number[];
  excludeRequestId?: number;
}

function inList(column: string, ids?: number[]): { sql: string; params: number[] } {
  if (!ids) return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

export function loadCells(companyId: number, year: number, q: CellQuery = {}): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const cell = (cc: number, acc: number): Cell => {
    const k = `${cc}:${acc}`;
    let c = cells.get(k);
    if (!c) {
      c = { ccId: cc, accId: acc, budget: emptyMonths(), original: emptyMonths(), actual: emptyMonths(), committed: emptyMonths(), pending: emptyMonths() };
      cells.set(k, c);
    }
    return c;
  };
  const filters = (ccCol: string, accCol: string) => {
    const s = q.scope ? costCenterFilter(q.scope, ccCol) : { sql: '', params: [] };
    const c = inList(ccCol, q.costCenterIds);
    const a = inList(accCol, q.accountIds);
    return { sql: s.sql + c.sql + a.sql, params: [...s.params, ...c.params, ...a.params] };
  };
  const budget = findBudgetByYear(companyId, year);
  const versionLines = (versionId: number, target: 'budget' | 'original') => {
    const f = filters('cost_center_id', 'account_id');
    for (const l of all<Record<string, number>>(
      `SELECT cost_center_id, account_id, ${MONTH_COLS.map((m) => `SUM(${m}) AS ${m}`).join(', ')} FROM budget_lines WHERE version_id = ?${f.sql} GROUP BY cost_center_id, account_id`,
      versionId, ...f.params,
    )) {
      const c = cell(l.cost_center_id, l.account_id);
      MONTH_COLS.forEach((m, i) => { c[target][i] += l[m] ?? 0; });
    }
  };
  if (budget?.current_version_id) versionLines(budget.current_version_id, 'budget');
  if (budget?.approved_version_id) versionLines(budget.approved_version_id, 'original');
  else for (const c of cells.values()) c.original = [...c.budget];

  const fa = filters('cost_center_id', 'account_id');
  for (const a of all<{ cost_center_id: number; account_id: number; month: number; amount: number }>(
    `SELECT cost_center_id, account_id, month, SUM(amount) AS amount FROM actuals WHERE company_id = ? AND fiscal_year = ?${fa.sql} GROUP BY cost_center_id, account_id, month`,
    companyId, year, ...fa.params,
  )) cell(a.cost_center_id, a.account_id).actual[a.month - 1] += a.amount;

  const fp = filters('p.cost_center_id', 'p.account_id');
  const excl = q.excludeRequestId ? ' AND p.id <> ?' : '';
  for (const p of all<{ cost_center_id: number; account_id: number; month: number; status: string; amount_base: number; actual: number }>(
    `SELECT p.cost_center_id, p.account_id, p.month, p.status, p.amount_base,
            COALESCE((SELECT SUM(x.amount) FROM actuals x WHERE x.purchase_request_id = p.id), 0) AS actual
       FROM purchase_requests p WHERE p.company_id = ? AND p.fiscal_year = ? AND p.status IN ('IN_APPROVAL', 'APPROVED')${fp.sql}${excl}`,
    companyId, year, ...fp.params, ...(q.excludeRequestId ? [q.excludeRequestId] : []),
  )) {
    const c = cell(p.cost_center_id, p.account_id);
    if (p.status === 'IN_APPROVAL') c.pending[p.month - 1] += p.amount_base;
    else c.committed[p.month - 1] += Math.max(0, p.amount_base - p.actual);
  }
  return cells;
}

export function lastActualMonth(companyId: number, year: number): number {
  return get<{ m: number | null }>('SELECT MAX(month) AS m FROM actuals WHERE company_id = ? AND fiscal_year = ?', companyId, year)?.m ?? 0;
}

const sum = (a: number[], through = 12) => a.slice(0, through).reduce((s, v) => s + v, 0);

/** Aggregates cells into the standard measures for months 1..through. */
export function measures(cells: Iterable<Cell>, through: number, lastActual: number, includePending: boolean): Measures {
  const b = emptyMonths();
  const o = emptyMonths();
  const a = emptyMonths();
  const c = emptyMonths();
  const p = emptyMonths();
  for (const x of cells) for (let i = 0; i < 12; i++) { b[i] += x.budget[i]; o[i] += x.original[i]; a[i] += x.actual[i]; c[i] += x.committed[i]; p[i] += x.pending[i]; }
  const budget = roundMoney(sum(b, through));
  const actual = roundMoney(sum(a, through));
  const committed = roundMoney(sum(c, through));
  const pending = roundMoney(sum(p, through));
  const { variance, variancePct } = computeVariance(budget, actual);
  return {
    annualBudget: roundMoney(sum(b)),
    budget,
    originalBudget: roundMoney(sum(o, through)),
    pending,
    committed,
    actual,
    available: roundMoney(budget - actual - committed - (includePending ? pending : 0)),
    variance,
    variancePct,
    consumptionPct: budget === 0 ? null : Math.round(((actual + committed) / budget) * 1000) / 10,
    forecast: forecastFullYear(roundMoney(sum(a, lastActual)), b, lastActual, 'budget'),
  };
}

/** Funds check for a request on cost center × account (excluding the request itself). */
export function checkBudget(companyId: number, ccId: number, accId: number, year: number, month: number, amountBase: number, excludeRequestId?: number): BudgetCheckDto {
  const s = getSettings(companyId);
  const cells = [...loadCells(companyId, year, { costCenterIds: [ccId], accountIds: [accId], excludeRequestId }).values()];
  const through = s.availabilityBasis === 'YTD' ? month : 12;
  const m = measures(cells, through, lastActualMonth(companyId, year), s.includePendingInAvailable);
  const used = m.actual + m.committed + (s.includePendingInAvailable ? m.pending : 0);
  const res = budgetCheck(m.budget, used, amountBase, s.nearLimitPct);
  const budget = findBudgetByYear(companyId, year);
  const vs = budget?.current_version_id ? get<{ status: BudgetCheckDto['budgetVersionStatus'] }>('SELECT status FROM budget_versions WHERE id = ?', budget.current_version_id)?.status ?? null : null;
  return {
    ...res, basis: s.availabilityBasis, actual: m.actual, committed: m.committed, pending: m.pending,
    currency: companyRow(companyId).base_currency, budgetVersionStatus: vs, blockOverBudget: s.blockOverBudget,
  };
}
