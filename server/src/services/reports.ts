import {
  computeVariance, emptyMonths, forecastFullYear, roundMoney, sumMonths,
  type BudgetStatus, type DashboardDto, type DeptStatus, type ForecastMethod, type MonthlyPoint, type PlanVsActualDto, type PlanVsActualGroupBy, type PlanVsActualRow,
} from '@finbridge/shared';
import { all, get } from '../db/database';
import { costCenterFilter, type Scope } from '../lib/scope';
import { findBudgetByYear, MONTH_COLS, toBudgetDto } from './budgets';

interface Cell {
  ccId: number; ccCode: string; ccName: string;
  deptId: number; deptCode: string; deptName: string;
  accId: number; accCode: string; accName: string;
  budget: number[]; actual: number[];
}

/** Loads budget and actual amounts per (cost center × account) for a year, restricted to the user's scope. */
function loadCells(companyId: number, scope: Scope, year: number, departmentId?: number): { cells: Cell[]; lastActualMonth: number } {
  const budget = findBudgetByYear(companyId, year);
  const cells = new Map<string, Cell>();
  const f = costCenterFilter(scope, 'c.id');
  const deptSql = departmentId ? ' AND c.department_id = ?' : '';
  const deptParams = departmentId ? [departmentId] : [];

  const cell = (r: { cc_id: number; cc_code: string; cc_name: string; dept_id: number; dept_code: string; dept_name: string; acc_id: number; acc_code: string; acc_name: string }): Cell => {
    const key = `${r.cc_id}:${r.acc_id}`;
    let c = cells.get(key);
    if (!c) {
      c = {
        ccId: r.cc_id, ccCode: r.cc_code, ccName: r.cc_name, deptId: r.dept_id, deptCode: r.dept_code, deptName: r.dept_name,
        accId: r.acc_id, accCode: r.acc_code, accName: r.acc_name, budget: emptyMonths(), actual: emptyMonths(),
      };
      cells.set(key, c);
    }
    return c;
  };
  const joins = `JOIN cost_centers c ON c.id = x.cost_center_id JOIN departments d ON d.id = c.department_id JOIN accounts a ON a.id = x.account_id`;
  const cols = 'c.id AS cc_id, c.code AS cc_code, c.name AS cc_name, d.id AS dept_id, d.code AS dept_code, d.name AS dept_name, a.id AS acc_id, a.code AS acc_code, a.name AS acc_name';

  if (budget) {
    const lines = all<Record<string, number> & Parameters<typeof cell>[0]>(
      `SELECT ${cols}, ${MONTH_COLS.map((m) => `SUM(x.${m}) AS ${m}`).join(', ')}
         FROM budget_lines x ${joins}
        WHERE x.budget_id = ?${f.sql}${deptSql}
        GROUP BY c.id, a.id`,
      budget.id, ...f.params, ...deptParams,
    );
    for (const l of lines) {
      const c = cell(l);
      MONTH_COLS.forEach((m, i) => { c.budget[i] += l[m] ?? 0; });
    }
  }
  const actuals = all<Parameters<typeof cell>[0] & { month: number; amount: number }>(
    `SELECT ${cols}, x.month, SUM(x.amount) AS amount
       FROM actuals x ${joins}
      WHERE x.company_id = ? AND x.year = ?${f.sql}${deptSql}
      GROUP BY c.id, a.id, x.month`,
    companyId, year, ...f.params, ...deptParams,
  );
  for (const a of actuals) cell(a).actual[a.month - 1] += a.amount;

  const last = get<{ m: number | null }>('SELECT MAX(month) AS m FROM actuals WHERE company_id = ? AND year = ?', companyId, year);
  return { cells: [...cells.values()], lastActualMonth: last?.m ?? 0 };
}

export function latestActualMonth(companyId: number, year: number): number {
  return get<{ m: number | null }>('SELECT MAX(month) AS m FROM actuals WHERE company_id = ? AND year = ?', companyId, year)?.m ?? 0;
}

function toRow(
  key: string, id: number, code: string, name: string, parentName: string | null,
  budget: number[], actual: number[], through: number, method: ForecastMethod,
): PlanVsActualRow {
  const budgetYtd = sumMonths(budget, through);
  const actualYtd = sumMonths(actual, through);
  const { variance, variancePct } = computeVariance(budgetYtd, actualYtd);
  return {
    key, id, code, name, parentName,
    annualBudget: sumMonths(budget),
    budgetYtd, actualYtd, variance, variancePct,
    forecast: forecastFullYear(actualYtd, budget, through, method),
  };
}

export function planVsActual(
  companyId: number, scope: Scope, year: number,
  opts: { through?: number; groupBy?: PlanVsActualGroupBy; departmentId?: number; method?: ForecastMethod } = {},
): PlanVsActualDto {
  const groupBy = opts.groupBy ?? 'department';
  const method = opts.method ?? 'budget';
  const { cells, lastActualMonth } = loadCells(companyId, scope, year, opts.departmentId);
  const through = Math.min(12, Math.max(0, opts.through ?? lastActualMonth));
  const groups = new Map<string, { id: number; code: string; name: string; parent: string | null; budget: number[]; actual: number[] }>();
  for (const c of cells) {
    const g = groupBy === 'department'
      ? { key: `d${c.deptId}`, id: c.deptId, code: c.deptCode, name: c.deptName, parent: null }
      : groupBy === 'costCenter'
        ? { key: `c${c.ccId}`, id: c.ccId, code: c.ccCode, name: c.ccName, parent: c.deptName }
        : { key: `a${c.accId}`, id: c.accId, code: c.accCode, name: c.accName, parent: null };
    let agg = groups.get(g.key);
    if (!agg) {
      agg = { id: g.id, code: g.code, name: g.name, parent: g.parent, budget: emptyMonths(), actual: emptyMonths() };
      groups.set(g.key, agg);
    }
    for (let i = 0; i < 12; i++) { agg.budget[i] += c.budget[i]; agg.actual[i] += c.actual[i]; }
  }
  const rows = [...groups.entries()]
    .map(([key, g]) => toRow(key, g.id, g.code, g.name, g.parent, g.budget, g.actual, through, method))
    .sort((a, b) => a.code.localeCompare(b.code));

  const tb = emptyMonths();
  const ta = emptyMonths();
  for (const c of cells) for (let i = 0; i < 12; i++) { tb[i] += c.budget[i]; ta[i] += c.actual[i]; }
  const t = toRow('total', 0, '', '', null, tb, ta, through, method);
  const budget = findBudgetByYear(companyId, year);
  return {
    year, throughMonth: through, groupBy, budgetId: budget?.id ?? null, budgetStatus: budget?.status ?? null, rows,
    totals: {
      annualBudget: t.annualBudget, budgetYtd: t.budgetYtd, actualYtd: t.actualYtd,
      variance: t.variance, variancePct: t.variancePct, forecast: t.forecast,
    },
  };
}

export function monthlySeries(companyId: number, scope: Scope, year: number): MonthlyPoint[] {
  const { cells, lastActualMonth } = loadCells(companyId, scope, year);
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    budget: roundMoney(cells.reduce((s, c) => s + c.budget[i], 0)),
    actual: i < lastActualMonth ? roundMoney(cells.reduce((s, c) => s + c.actual[i], 0)) : null,
  }));
}

export function dashboard(companyId: number, scope: Scope, year: number): DashboardDto {
  const byDept = planVsActual(companyId, scope, year, { groupBy: 'department' });
  const byCc = planVsActual(companyId, scope, year, { groupBy: 'costCenter', through: byDept.throughMonth });
  const budget = findBudgetByYear(companyId, year);
  const { totals } = byDept;

  // Approval progress of the budget currently being planned (usually next year).
  const planning = all<{ id: number; year: number; status: BudgetStatus }>(
    "SELECT id, year, status FROM budgets WHERE company_id = ? AND status IN ('DRAFT', 'COLLECTING', 'CFO_REVIEW') ORDER BY year DESC LIMIT 1",
    companyId,
  )[0];
  const approval = planning
    ? {
        status: planning.status,
        year: planning.year,
        budgetId: planning.id,
        departments: all<{ id: number; name: string; status: DeptStatus }>(
          `SELECT d.id, d.name, bd.status FROM budget_departments bd JOIN departments d ON d.id = bd.department_id
            WHERE bd.budget_id = ? ORDER BY d.code`,
          planning.id,
        ).filter((d) => scope.all || scope.departmentIds.has(d.id)).map((d) => ({ name: d.name, status: d.status })),
      }
    : null;

  return {
    year,
    throughMonth: byDept.throughMonth,
    budget: budget ? toBudgetDto(budget, scope) : null,
    kpis: {
      annualBudget: totals.annualBudget,
      budgetYtd: totals.budgetYtd,
      actualYtd: totals.actualYtd,
      variance: totals.variance,
      variancePct: totals.variancePct,
      forecast: totals.forecast,
      forecastVsBudgetPct: computeVariance(totals.annualBudget, totals.forecast).variancePct,
    },
    departments: byDept.rows,
    topOverspends: byCc.rows.filter((r) => r.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 5),
    monthly: monthlySeries(companyId, scope, year),
    approval,
  };
}
