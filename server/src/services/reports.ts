import {
  type ChangeReportRowDto, type ConsumptionReportDto, type DashboardDto, type Measures, type MonthlyPoint, type ReportGroupBy,
  type ReportRow, type SectionStatus, type TransactionDto, type VersionStatus, type WorkflowReportDto, type WorkflowType,
} from '@finbridge/shared';
import { all, get } from '../db/database';
import { nowIso } from '../lib/clock';
import type { UserRow } from '../lib/mappers';
import { getScope, type Scope } from '../lib/scope';
import { AccountIndex } from './accounts';
import { findBudgetByYear, toBudgetDto } from './budgets';
import { lastActualMonth, loadCells, measures, type Cell } from './consumption';
import { OrgIndex } from './org';
import { getSettings } from './settings';
import { allPending, inbox } from './workflowEngine';

interface Ctx { org: OrgIndex; accs: AccountIndex; scope: Scope; cells: Cell[]; last: number; includePending: boolean }

function ctx(user: UserRow, year: number): Ctx {
  const companyId = user.company_id!;
  const org = OrgIndex.load(companyId);
  const scope = getScope(user, org);
  return {
    org, scope, accs: AccountIndex.load(companyId), last: lastActualMonth(companyId, year),
    includePending: getSettings(companyId).includePendingInAvailable,
    cells: [...loadCells(companyId, year, { scope }).values()],
  };
}

function hasData(m: Measures): boolean {
  return m.annualBudget !== 0 || m.actual !== 0 || m.committed !== 0 || m.pending !== 0;
}

function row(kind: ReportRow['kind'], id: number, code: string, name: string, parentName: string | null, m: Measures, hasChildren: boolean): ReportRow {
  return { ...m, key: `${kind}:${id}`, kind, id, code, name, parentName, hasChildren };
}

export function consumptionReport(
  user: UserRow,
  q: { year: number; groupBy: ReportGroupBy; parentUnitId?: number; parentAccountId?: number; costCenterId?: number; through?: number },
): ConsumptionReportDto {
  const c = ctx(user, q.year);
  const through = q.through ?? 12;
  const M = (cells: Cell[]) => measures(cells, through, c.last, c.includePending);
  let cells = c.cells;
  if (q.costCenterId) cells = cells.filter((x) => x.ccId === q.costCenterId);
  const ccUnit = (x: Cell) => c.org.costCenters.get(x.ccId)?.orgUnitId ?? -1;
  let rows: ReportRow[] = [];
  let path: { id: number; name: string }[] = [];

  if (q.groupBy === 'unit') {
    const parent = q.parentUnitId ? c.org.unit(q.parentUnitId) : c.org.root();
    path = c.org.ancestors(parent.id).reverse().map((u) => ({ id: u.id, name: u.name }));
    for (const childId of c.org.children.get(parent.id) ?? []) {
      const child = c.org.unit(childId);
      const sub = c.org.subtree(childId);
      const m = M(cells.filter((x) => sub.has(ccUnit(x))));
      if (!hasData(m) && (!child.isActive || !c.scope.all)) continue;
      const hasChildren = (c.org.children.get(childId)?.length ?? 0) > 0 || (c.org.ccByUnit.get(childId)?.length ?? 0) > 0;
      rows.push(row('unit', child.id, child.code, child.name, child.typeName, m, hasChildren));
    }
    for (const ccId of c.org.ccByUnit.get(parent.id) ?? []) {
      const cc = c.org.cc(ccId);
      const m = M(cells.filter((x) => x.ccId === ccId));
      if (!hasData(m) && !c.scope.all) continue;
      rows.push(row('costCenter', cc.id, cc.code, cc.name, parent.name, m, true));
    }
  } else if (q.groupBy === 'section') {
    const groups = new Map<number, Cell[]>();
    for (const x of cells) {
      if (!c.org.costCenters.has(x.ccId)) continue;
      const s = c.org.sectionOfCostCenter(x.ccId).id;
      groups.set(s, [...(groups.get(s) ?? []), x]);
    }
    rows = [...groups.entries()].map(([id, cs]) => {
      const u = c.org.unit(id);
      return row('section', u.id, u.code, u.name, c.org.path(u.id).slice(-2, -1)[0] ?? null, M(cs), true);
    });
  } else if (q.groupBy === 'costCenter') {
    const within = q.parentUnitId ? c.org.subtree(q.parentUnitId) : null;
    const groups = new Map<number, Cell[]>();
    for (const x of cells) {
      if (within && !within.has(ccUnit(x))) continue;
      groups.set(x.ccId, [...(groups.get(x.ccId) ?? []), x]);
    }
    rows = [...groups.entries()].filter(([id]) => c.org.costCenters.has(id)).map(([id, cs]) => {
      const cc = c.org.cc(id);
      return row('costCenter', cc.id, cc.code, cc.name, c.org.sectionOfCostCenter(id).name, M(cs), true);
    });
    if (q.parentUnitId) path = c.org.ancestors(q.parentUnitId).reverse().map((u) => ({ id: u.id, name: u.name }));
  } else {
    const parentId = q.parentAccountId ?? null;
    if (parentId) path = c.accs.ancestors(parentId).reverse().map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }));
    for (const id of c.accs.children.get(parentId) ?? []) {
      const a = c.accs.get(id);
      const sub = c.accs.descendants(id);
      const m = M(cells.filter((x) => sub.has(x.accId)));
      if (!hasData(m)) continue;
      rows.push(row('account', a.id, a.code, a.name, c.accs.expenseClassOf(a.id), m, a.isGroup));
    }
  }
  if (q.costCenterId) {
    const cc = c.org.cc(q.costCenterId);
    path = [...c.org.ancestors(cc.orgUnitId).reverse().map((u) => ({ id: u.id, name: u.name })), { id: -cc.id, name: `${cc.code} ${cc.name}` }];
  }
  rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const budget = findBudgetByYear(user.company_id!, q.year);
  const v = budget?.current_version_id ? get<{ version_no: number; status: ConsumptionReportDto['versionStatus'] }>('SELECT version_no, status FROM budget_versions WHERE id = ?', budget.current_version_id) : undefined;
  return {
    fiscalYear: q.year, throughMonth: through, groupBy: q.groupBy, budgetId: budget?.id ?? null, versionNo: v?.version_no ?? null,
    versionStatus: v?.status ?? null, path, rows, totals: M(cells),
  };
}

export function transactions(user: UserRow, year: number, ccId: number, accId?: number): TransactionDto[] {
  const scope = getScope(user);
  if (!scope.all && !scope.costCenterIds.has(ccId)) return [];
  const accSql = accId ? ' AND account_id = ?' : '';
  const params = [user.company_id!, year, ccId, ...(accId ? [accId] : [])];
  const prs = all<{ id: number; number: string; title: string; month: number; amount_base: number; status: string; created_at: string }>(
    `SELECT id, number, title, month, amount_base, status, created_at FROM purchase_requests WHERE company_id = ? AND fiscal_year = ? AND cost_center_id = ?${accSql} AND status <> 'DRAFT' ORDER BY month, id`,
    ...params,
  );
  const acts = all<{ id: number; month: number; amount: number; source: string; description: string | null; purchase_request_id: number | null; created_at: string }>(
    `SELECT id, month, amount, source, description, purchase_request_id, created_at FROM actuals WHERE company_id = ? AND fiscal_year = ? AND cost_center_id = ?${accSql} ORDER BY month, id`,
    ...params,
  );
  return [
    ...prs.map((p): TransactionDto => ({ kind: 'REQUEST', id: p.id, date: p.created_at, month: p.month, reference: p.number, description: p.title, amount: p.amount_base, status: p.status, link: `/requests/${p.id}` })),
    ...acts.map((a): TransactionDto => ({
      kind: 'ACTUAL', id: a.id, date: a.created_at, month: a.month, reference: a.source, description: a.description ?? '', amount: a.amount, status: a.source,
      link: a.purchase_request_id ? `/requests/${a.purchase_request_id}` : null,
    })),
  ].sort((a, b) => a.month - b.month || a.kind.localeCompare(b.kind));
}

export function dashboard(user: UserRow, year: number): DashboardDto {
  const c = ctx(user, year);
  const companyId = user.company_id!;
  const annual = (cells: Cell[]) => measures(cells, 12, c.last, c.includePending);
  const ytd = (cells: Cell[]) => measures(cells, c.last, c.last, c.includePending);
  const budget = findBudgetByYear(companyId, year);

  const monthly: MonthlyPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    budget: Math.round(c.cells.reduce((s, x) => s + x.budget[i], 0) * 100) / 100,
    actual: i < c.last ? Math.round(c.cells.reduce((s, x) => s + x.actual[i], 0) * 100) / 100 : null,
    committed: Math.round(c.cells.reduce((s, x) => s + x.committed[i], 0) * 100) / 100,
  }));

  const bySection = new Map<number, Cell[]>();
  const byCc = new Map<number, Cell[]>();
  const byAcc = new Map<number, Cell[]>();
  for (const x of c.cells) {
    if (!c.org.costCenters.has(x.ccId)) continue;
    const s = c.org.sectionOfCostCenter(x.ccId).id;
    bySection.set(s, [...(bySection.get(s) ?? []), x]);
    byCc.set(x.ccId, [...(byCc.get(x.ccId) ?? []), x]);
    byAcc.set(x.accId, [...(byAcc.get(x.accId) ?? []), x]);
  }
  const sections = [...bySection.entries()].map(([id, cs]) => {
    const u = c.org.unit(id);
    return row('section', u.id, u.code, u.name, null, annual(cs), true);
  }).sort((a, b) => a.code.localeCompare(b.code));
  const topCostCenters = [...byCc.entries()].map(([id, cs]) => {
    const cc = c.org.cc(id);
    return row('costCenter', cc.id, cc.code, cc.name, c.org.sectionOfCostCenter(id).name, ytd(cs), true);
  }).filter((r) => r.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 5);
  const topAccounts = [...byAcc.entries()].filter(([id]) => c.accs.accounts.has(id)).map(([id, cs]) => {
    const a = c.accs.get(id);
    return row('account', a.id, a.code, a.name, c.accs.ancestors(a.id)[1]?.name ?? null, ytd(cs), false);
  }).filter((r) => r.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 5);

  const capexOpex = (['OPEX', 'CAPEX'] as const).map((cls) => {
    const cs = c.cells.filter((x) => c.accs.accounts.has(x.accId) && c.accs.expenseClassOf(x.accId) === cls);
    const m = annual(cs);
    return { expenseClass: cls, budget: m.annualBudget, actual: m.actual, committed: m.committed };
  });

  const pending = allPending(companyId);
  const now = nowIso();
  const crs = all<{ status: string; diff: number }>(
    `SELECT r.status, COALESCE((SELECT SUM(i.requested_amount - i.current_amount) FROM budget_change_items i WHERE i.change_request_id = r.id), 0) AS diff
       FROM budget_change_requests r JOIN budgets b ON b.id = r.budget_id WHERE r.company_id = ? AND b.fiscal_year = ?`, companyId, year,
  );
  const reqs = all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM purchase_requests WHERE company_id = ? AND fiscal_year = ? GROUP BY status', companyId, year);

  const planningBudget = get<{ id: number; fiscal_year: number; status: VersionStatus; vid: number }>(
    `SELECT b.id, b.fiscal_year, v.status, v.id AS vid FROM budgets b JOIN budget_versions v ON v.id = b.current_version_id
      WHERE b.company_id = ? AND v.status IN ('DRAFT', 'IN_APPROVAL') ORDER BY b.fiscal_year DESC LIMIT 1`, companyId,
  );
  const planning = planningBudget ? {
    budgetId: planningBudget.id, fiscalYear: planningBudget.fiscal_year, status: planningBudget.status,
    sections: all<{ org_unit_id: number; status: SectionStatus }>('SELECT org_unit_id, status FROM budget_sections WHERE version_id = ?', planningBudget.vid)
      .filter((s) => c.org.units.has(s.org_unit_id) && (c.scope.all || c.scope.unitIds.has(s.org_unit_id)))
      .map((s) => ({ name: c.org.unit(s.org_unit_id).name, status: s.status })),
  } : null;

  return {
    fiscalYear: year, throughMonth: c.last, budget: budget ? toBudgetDto(budget, c.scope) : null,
    totals: annual(c.cells), ytd: ytd(c.cells), monthly, sections, topCostCenters, topAccounts, capexOpex,
    approvals: { pendingTotal: c.scope.all ? pending.length : 0, pendingMine: inbox(user).length, overdue: c.scope.all ? pending.filter((p) => p.dueAt && p.dueAt < now).length : 0 },
    changes: {
      approved: crs.filter((r) => r.status === 'APPROVED').length,
      pending: crs.filter((r) => r.status === 'IN_APPROVAL').length,
      netChange: Math.round(crs.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.diff, 0) * 100) / 100,
    },
    requests: { inApproval: reqs.find((r) => r.status === 'IN_APPROVAL')?.n ?? 0, approvedOpen: reqs.find((r) => r.status === 'APPROVED')?.n ?? 0 },
    planning,
  };
}

export function workflowReport(user: UserRow): WorkflowReportDto {
  const companyId = user.company_id!;
  const rows = all<{ workflow_type: WorkflowType; status: string; n: number; avg_h: number | null }>(
    `SELECT workflow_type, status, COUNT(*) AS n,
            AVG(CASE WHEN completed_at IS NOT NULL THEN (julianday(completed_at) - julianday(started_at)) * 24 END) AS avg_h
       FROM workflow_instances WHERE company_id = ? GROUP BY workflow_type, status`, companyId,
  );
  const types = [...new Set(rows.map((r) => r.workflow_type))];
  const pending = allPending(companyId);
  const now = nowIso();
  return {
    byType: types.map((t) => {
      const of = (s: string) => rows.find((r) => r.workflow_type === t && r.status === s)?.n ?? 0;
      const done = rows.filter((r) => r.workflow_type === t && r.avg_h !== null && r.status === 'APPROVED');
      return {
        workflowType: t, inReview: of('IN_REVIEW'), approved: of('APPROVED'), rejected: of('REJECTED'), returned: of('RETURNED'), cancelled: of('CANCELLED'),
        avgHours: done.length ? Math.round(done[0].avg_h! * 10) / 10 : null,
      };
    }),
    overdue: pending.filter((p) => p.dueAt && p.dueAt < now),
    pending,
  };
}

export function changeReport(user: UserRow, year: number): ChangeReportRowDto[] {
  const scope = getScope(user);
  return all<{ id: number; number: string; cc: string; cc_id: number; title: string; reason: string; status: ChangeReportRowDto['status']; original: number; revised: number; who: string; created_at: string; decided_at: string | null }>(
    `SELECT r.id, r.number, c.code || ' ' || c.name AS cc, c.id AS cc_id, r.title, r.reason, r.status, u.full_name AS who, r.created_at, r.decided_at,
            COALESCE((SELECT SUM(current_amount) FROM budget_change_items WHERE change_request_id = r.id), 0) AS original,
            COALESCE((SELECT SUM(requested_amount) FROM budget_change_items WHERE change_request_id = r.id), 0) AS revised
       FROM budget_change_requests r JOIN cost_centers c ON c.id = r.cost_center_id JOIN budgets b ON b.id = r.budget_id JOIN users u ON u.id = r.requested_by
      WHERE r.company_id = ? AND b.fiscal_year = ? ORDER BY r.id DESC`, user.company_id!, year,
  ).filter((r) => scope.all || scope.costCenterIds.has(r.cc_id)).map((r) => ({
    id: r.id, number: r.number, costCenter: r.cc, title: r.title, reason: r.reason, status: r.status, original: r.original,
    change: Math.round((r.revised - r.original) * 100) / 100, revised: r.revised, requestedBy: r.who, createdAt: r.created_at, decidedAt: r.decided_at,
  }));
}
