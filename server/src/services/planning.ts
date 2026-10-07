import {
  emptyMonths, forecastFullYear, roundMoney,
  type PlanningComparisonDto, type PlanningCrumb, type PlanningDelta, type PlanningForecastMethod, type PlanningGroupBy,
  type PlanningMonthlyDto, type PlanningRow, type PlanningYearInfo, type PlanningYearValues, type VersionStatus,
} from '@finbridge/shared';
import { all, get } from '../db/database';
import type { UserRow } from '../lib/mappers';
import { forbidden } from '../lib/errors';
import { costCenterFilter, getScope, inScopeCostCenter, inScopeUnit } from '../lib/scope';
import { AccountIndex } from './accounts';
import { findBudgetByYear, loadVersion, MONTH_COLS, type BudgetRow } from './budgets';
import { lastActualMonth, loadCells } from './consumption';
import { OrgIndex } from './org';

/**
 * Planning comparison for the budget of fiscal year Y: for every prior year (Y-1, Y-2, …) the original approved
 * budget, the final budget (current version, after change requests) and the actuals — next to the plan of the
 * selected version of Y. Prior-year budgets are matched by fiscal year within the company. Object scope applies:
 * department heads and cost-center owners only see their own cost centers.
 */
export interface PlanningQuery {
  versionId?: number;
  groupBy: PlanningGroupBy;
  unitId?: number;
  costCenterId?: number;
  accountId?: number;
  years: number;
  forecast: PlanningForecastMethod;
}

interface YearVec { orig: number[]; fin: number[]; act: number[] }
interface PCell { cc: number; acc: number; plan: number[]; years: YearVec[] }

const sum = (v: number[]) => roundMoney(v.reduce((s, x) => s + x, 0));
const pctOf = (abs: number, base: number) => (base === 0 ? null : Math.round((abs / base) * 1000) / 10);
const delta = (plan: number, base: number): PlanningDelta => {
  const abs = roundMoney(plan - base);
  return { abs, pct: pctOf(abs, base) };
};

interface Ctx {
  org: OrgIndex;
  accs: AccountIndex;
  version: { id: number; version_no: number; status: VersionStatus };
  infos: PlanningYearInfo[];
  cells: PCell[];
  path: PlanningCrumb[];
  companyWide: boolean;
}

function yearInfo(companyId: number, year: number): PlanningYearInfo {
  const b = findBudgetByYear(companyId, year);
  const v = b?.current_version_id ? get<{ id: number; version_no: number; status: VersionStatus }>('SELECT id, version_no, status FROM budget_versions WHERE id = ?', b.current_version_id) : undefined;
  const months = lastActualMonth(companyId, year);
  return {
    year, budgetId: b?.id ?? null, versionId: v?.id ?? null, versionNo: v?.version_no ?? null, versionStatus: v?.status ?? null,
    approvedVersionId: b?.approved_version_id ?? null, monthsWithActuals: months, complete: months >= 12,
  };
}

function load(user: UserRow, budget: BudgetRow, q: PlanningQuery): Ctx {
  const companyId = budget.company_id;
  const org = OrgIndex.load(companyId);
  const accs = AccountIndex.load(companyId);
  const scope = getScope(user, org);
  const version = loadVersion(budget, q.versionId ?? null);
  const priorYears = Array.from({ length: q.years }, (_, i) => budget.fiscal_year - 1 - i);
  const infos = priorYears.map((y) => yearInfo(companyId, y));

  const map = new Map<string, PCell>();
  const cell = (cc: number, acc: number): PCell => {
    const k = `${cc}:${acc}`;
    let c = map.get(k);
    if (!c) {
      c = { cc, acc, plan: emptyMonths(), years: priorYears.map(() => ({ orig: emptyMonths(), fin: emptyMonths(), act: emptyMonths() })) };
      map.set(k, c);
    }
    return c;
  };

  const f = costCenterFilter(scope, 'cost_center_id');
  for (const l of all<Record<string, number>>(
    `SELECT cost_center_id, account_id, ${MONTH_COLS.map((m) => `SUM(${m}) AS ${m}`).join(', ')} FROM budget_lines WHERE version_id = ?${f.sql} GROUP BY cost_center_id, account_id`,
    version.id, ...f.params,
  )) {
    const c = cell(l.cost_center_id, l.account_id);
    MONTH_COLS.forEach((m, i) => { c.plan[i] += l[m] ?? 0; });
  }
  priorYears.forEach((y, yi) => {
    for (const x of loadCells(companyId, y, { scope }).values()) {
      const c = cell(x.ccId, x.accId);
      for (let i = 0; i < 12; i++) {
        c.years[yi].orig[i] += x.original[i];
        c.years[yi].fin[i] += x.budget[i];
        c.years[yi].act[i] += x.actual[i];
      }
    }
  });

  // drill-down filters
  const unit = q.unitId ? org.unit(q.unitId) : null;
  const unitSub = unit && !unit.inBudgeting ? org.subtree(unit.id) : null;
  const accSub = q.accountId ? accs.descendants(q.accountId) : null;
  if (q.accountId) accs.get(q.accountId);
  if (q.costCenterId && !inScopeCostCenter(scope, org.cc(q.costCenterId).id)) throw forbidden();
  if (unit && !inScopeUnit(scope, unit.id)) throw forbidden();
  const cells = [...map.values()].filter((c) => {
    const cc = org.costCenters.get(c.cc);
    if (!cc || !accs.accounts.has(c.acc)) return false;
    if (unit && org.sectionOfCostCenter(cc.id).id !== unit.id && !(unitSub && unitSub.has(cc.orgUnitId))) return false;
    if (q.costCenterId && c.cc !== q.costCenterId) return false;
    if (accSub && !accSub.has(c.acc)) return false;
    return true;
  });

  const path: PlanningCrumb[] = [];
  if (unit) path.push({ level: 'section', id: unit.id, label: unit.name });
  if (q.costCenterId) { const cc = org.cc(q.costCenterId); path.push({ level: 'costCenter', id: cc.id, label: `${cc.code} ${cc.name}` }); }
  if (q.accountId) { const a = accs.get(q.accountId); path.push({ level: 'account', id: a.id, label: `${a.code} ${a.name}` }); }

  return { org, accs, version, infos, cells, path, companyWide: scope.all };
}

/** Aggregated month vectors of a set of cells. */
function aggregate(cells: PCell[], n: number): { plan: number[]; years: YearVec[] } {
  const plan = emptyMonths();
  const years = Array.from({ length: n }, () => ({ orig: emptyMonths(), fin: emptyMonths(), act: emptyMonths() }));
  for (const c of cells) {
    for (let i = 0; i < 12; i++) {
      plan[i] += c.plan[i];
      c.years.forEach((y, yi) => { years[yi].orig[i] += y.orig[i]; years[yi].fin[i] += y.fin[i]; years[yi].act[i] += y.act[i]; });
    }
  }
  return { plan, years };
}

function yearValues(info: PlanningYearInfo, v: YearVec, method: PlanningForecastMethod): PlanningYearValues {
  const actual = sum(v.act);
  const fullYear = info.complete ? actual : forecastFullYear(sum(v.act.slice(0, info.monthsWithActuals)), v.fin, info.monthsWithActuals, method);
  return { year: info.year, originalBudget: sum(v.orig), finalBudget: sum(v.fin), actual, fullYear, isForecast: !info.complete };
}

/** Last year's month series: actuals for the closed months, the forecast basis for the remaining ones. */
function lastYearMonths(info: PlanningYearInfo, v: YearVec, method: PlanningForecastMethod): number[] {
  const last = info.monthsWithActuals;
  const runRate = last > 0 ? v.act.slice(0, last).reduce((s, x) => s + x, 0) / last : 0;
  return v.act.map((a, i) => roundMoney(i < last ? a : method === 'run_rate' && last > 0 ? runRate : v.fin[i]));
}

type RowHead = Pick<PlanningRow, 'key' | 'kind' | 'id' | 'code' | 'name' | 'nameEn' | 'parentName' | 'costCenterId' | 'accountId' | 'sectionUnitId' | 'hasChildren'>;

function buildRow(head: RowHead, cells: PCell[], ctx: Ctx, method: PlanningForecastMethod, withMonths: boolean): PlanningRow {
  const agg = aggregate(cells, ctx.infos.length);
  const years = ctx.infos.map((info, i) => yearValues(info, agg.years[i], method));
  const plan = sum(agg.plan);
  const last = years[0];
  const row: PlanningRow = {
    ...head, years, plan,
    vsLastActual: delta(plan, last?.fullYear ?? 0),
    vsLastBudget: delta(plan, last?.finalBudget ?? 0),
  };
  if (withMonths && ctx.infos.length) {
    row.lastYearMonths = lastYearMonths(ctx.infos[0], agg.years[0], method);
    row.lastBudgetMonths = agg.years[0].fin.map(roundMoney);
  }
  return row;
}

function hasData(r: PlanningRow): boolean {
  return r.plan !== 0 || r.years.some((y) => y.originalBudget !== 0 || y.finalBudget !== 0 || y.actual !== 0);
}

export function planningComparison(user: UserRow, budget: BudgetRow, q: PlanningQuery): PlanningComparisonDto {
  const ctx = load(user, budget, q);
  const { org, accs } = ctx;
  const groups = new Map<string, { head: RowHead; cells: PCell[] }>();
  const add = (head: RowHead, c: PCell) => {
    const g = groups.get(head.key);
    if (g) g.cells.push(c); else groups.set(head.key, { head, cells: [c] });
  };
  const parentAccName = (accId: number) => {
    const a = accs.get(accId);
    return a.parentId && accs.accounts.has(a.parentId) ? accs.get(a.parentId).name : null;
  };
  for (const c of ctx.cells) {
    const cc = org.cc(c.cc);
    const section = org.sectionOfCostCenter(cc.id);
    const acc = accs.get(c.acc);
    if (q.groupBy === 'section') {
      add({ key: `section:${section.id}`, kind: 'section', id: section.id, code: section.code, name: section.name, nameEn: section.nameEn, parentName: null,
        costCenterId: null, accountId: null, sectionUnitId: section.id, hasChildren: true }, c);
    } else if (q.groupBy === 'costCenter') {
      add({ key: `costCenter:${cc.id}`, kind: 'costCenter', id: cc.id, code: cc.code, name: cc.name, nameEn: null, parentName: section.name,
        costCenterId: cc.id, accountId: null, sectionUnitId: section.id, hasChildren: true }, c);
    } else if (q.groupBy === 'account') {
      add({ key: `account:${acc.id}`, kind: 'account', id: acc.id, code: acc.code, name: acc.name, nameEn: acc.nameEn, parentName: parentAccName(acc.id),
        costCenterId: q.costCenterId ?? null, accountId: acc.id, sectionUnitId: q.unitId ?? null, hasChildren: false }, c);
    } else {
      add({ key: `line:${cc.id}:${acc.id}`, kind: 'line', id: acc.id, code: `${cc.code} / ${acc.code}`, name: acc.name, nameEn: acc.nameEn, parentName: `${cc.code} ${cc.name}`,
        costCenterId: cc.id, accountId: acc.id, sectionUnitId: section.id, hasChildren: false }, c);
    }
  }
  const rows = [...groups.values()]
    .map((g) => buildRow(g.head, g.cells, ctx, q.forecast, q.groupBy === 'line'))
    .filter(hasData)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const totals = buildRow({ key: 'total', kind: 'total', id: 0, code: '', name: '', nameEn: null, parentName: null, costCenterId: null, accountId: null, sectionUnitId: null, hasChildren: false },
    ctx.cells, ctx, q.forecast, false);
  return {
    budgetId: budget.id, fiscalYear: budget.fiscal_year, versionId: ctx.version.id, versionNo: ctx.version.version_no, versionStatus: ctx.version.status,
    currency: budget.currency, groupBy: q.groupBy, forecastMethod: q.forecast, years: ctx.infos, path: ctx.path, rows, totals, companyWide: ctx.companyWide,
  };
}

export function planningMonthly(user: UserRow, budget: BudgetRow, q: PlanningQuery): PlanningMonthlyDto {
  const ctx = load(user, budget, q);
  const agg = aggregate(ctx.cells, ctx.infos.length);
  return {
    budgetId: budget.id, fiscalYear: budget.fiscal_year, versionId: ctx.version.id, currency: budget.currency, path: ctx.path,
    years: ctx.infos.map((info, i) => ({
      year: info.year, complete: info.complete, monthsWithActuals: info.monthsWithActuals,
      originalBudget: agg.years[i].orig.map(roundMoney),
      budget: agg.years[i].fin.map(roundMoney),
      actual: agg.years[i].act.map((v, m) => (m < info.monthsWithActuals ? roundMoney(v) : null)),
    })),
    plan: agg.plan.map(roundMoney),
  };
}
