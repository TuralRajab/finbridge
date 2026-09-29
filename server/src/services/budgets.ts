import {
  BUDGET_ACTIONS, DEPT_ACTIONS, can, canEditBudgetLines, canRunBudgetAction, canRunDeptAction,
  type BudgetDepartmentDto, type BudgetDetailDto, type BudgetDto, type BudgetLineDto, type BudgetStatus, type DeptStatus,
} from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { notFound } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { costCenterFilter, getScope, inScopeCostCenter, inScopeDepartment, type Scope } from '../lib/scope';

export const MONTH_COLS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const;
export const MONTH_SUM = MONTH_COLS.join(' + ');

export interface BudgetRow {
  id: number;
  company_id: number;
  year: number;
  name: string;
  status: BudgetStatus;
  currency: string;
  created_at: string;
  approved_at: string | null;
  locked_at: string | null;
}

export function loadBudget(companyId: number, id: number): BudgetRow {
  const b = get<BudgetRow>('SELECT * FROM budgets WHERE id = ? AND company_id = ?', id, companyId);
  if (!b) throw notFound('Budget');
  return b;
}

export function findBudgetByYear(companyId: number, year: number): BudgetRow | undefined {
  return get<BudgetRow>('SELECT * FROM budgets WHERE company_id = ? AND year = ?', companyId, year);
}

export function toBudgetDto(b: BudgetRow, scope?: Scope): BudgetDto {
  const f = scope ? costCenterFilter(scope, 'cost_center_id') : { sql: '', params: [] };
  const agg = get<{ total: number | null; n: number }>(
    `SELECT SUM(${MONTH_SUM}) AS total, COUNT(*) AS n FROM budget_lines WHERE budget_id = ?${f.sql}`,
    b.id, ...f.params,
  );
  return {
    id: b.id,
    year: b.year,
    name: b.name,
    status: b.status,
    currency: b.currency,
    total: Math.round((agg?.total ?? 0) * 100) / 100,
    lineCount: agg?.n ?? 0,
    createdAt: b.created_at,
    approvedAt: b.approved_at,
    lockedAt: b.locked_at,
  };
}

export function deptStatuses(budgetId: number): Map<number, DeptStatus> {
  return new Map(
    all<{ department_id: number; status: DeptStatus }>('SELECT department_id, status FROM budget_departments WHERE budget_id = ?', budgetId)
      .map((r) => [r.department_id, r.status]),
  );
}

/** Whether the user may edit budget lines of `departmentId` right now. */
export function canEditDepartment(user: UserRow, scope: Scope, budget: BudgetRow, departmentId: number, statuses?: Map<number, DeptStatus>): boolean {
  const status = (statuses ?? deptStatuses(budget.id)).get(departmentId) ?? null;
  return canEditBudgetLines(user.role, budget.status, status) && inScopeDepartment(scope, departmentId);
}

export function canSubmitDepartment(user: UserRow, scope: Scope, departmentId: number): boolean {
  // Finance can submit on behalf of any department; department managers only for their own.
  return can(user.role, 'budget.manage') || (user.role === 'DEPARTMENT_MANAGER' && scope.departmentIds.has(departmentId));
}

export function budgetDetail(user: UserRow, budget: BudgetRow): BudgetDetailDto {
  const scope = getScope(user);
  const statuses = deptStatuses(budget.id);
  const rows = all<{
    id: number; code: string; name: string; manager_name: string | null; status: DeptStatus | null;
    submitted_at: string | null; reviewed_at: string | null; total: number | null; n: number;
  }>(
    `SELECT d.id, d.code, d.name, u.full_name AS manager_name, bd.status, bd.submitted_at, bd.reviewed_at,
            (SELECT SUM(${MONTH_SUM.replaceAll('m', 'bl.m')}) FROM budget_lines bl JOIN cost_centers c ON c.id = bl.cost_center_id
              WHERE bl.budget_id = ? AND c.department_id = d.id) AS total,
            (SELECT COUNT(*) FROM budget_lines bl JOIN cost_centers c ON c.id = bl.cost_center_id
              WHERE bl.budget_id = ? AND c.department_id = d.id) AS n
       FROM departments d
       LEFT JOIN users u ON u.id = d.manager_id
       LEFT JOIN budget_departments bd ON bd.department_id = d.id AND bd.budget_id = ?
      WHERE d.company_id = ? AND (d.is_active = 1 OR bd.status IS NOT NULL)
      ORDER BY d.code`,
    budget.id, budget.id, budget.id, budget.company_id,
  );
  const lastComments = new Map(
    all<{ department_id: number; comment: string }>(
      `SELECT e.department_id, e.comment FROM budget_events e
        WHERE e.budget_id = ? AND e.department_id IS NOT NULL AND e.comment IS NOT NULL AND e.comment <> ''
          AND e.id = (SELECT MAX(id) FROM budget_events x WHERE x.budget_id = e.budget_id AND x.department_id = e.department_id AND x.comment IS NOT NULL AND x.comment <> '')`,
      budget.id,
    ).map((r) => [r.department_id, r.comment]),
  );

  const departments: BudgetDepartmentDto[] = rows
    .filter((r) => inScopeDepartment(scope, r.id))
    .map((r) => {
      const status: DeptStatus = r.status ?? 'NOT_STARTED';
      const allowedActions = DEPT_ACTIONS.filter((a) =>
        r.status !== null && canRunDeptAction(user.role, budget.status, status, a) && (a !== 'submit' || canSubmitDepartment(user, scope, r.id)),
      );
      return {
        departmentId: r.id,
        code: r.code,
        name: r.name,
        managerName: r.manager_name,
        status,
        total: Math.round((r.total ?? 0) * 100) / 100,
        lineCount: r.n,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        lastComment: lastComments.get(r.id) ?? null,
        allowedActions,
        canEdit: canEditDepartment(user, scope, budget, r.id, statuses),
      };
    });

  return {
    ...toBudgetDto(budget, scope),
    departments,
    allowedActions: BUDGET_ACTIONS.filter((a) => canRunBudgetAction(user.role, budget.status, a)),
    canImport: can(user.role, 'excel.import') && (budget.status === 'DRAFT' || budget.status === 'COLLECTING'),
  };
}

interface LineRow {
  id: number; cost_center_id: number; cc_code: string; cc_name: string; department_id: number; department_name: string;
  account_id: number; account_code: string; account_name: string; account_type: 'OPEX' | 'CAPEX'; description: string;
  m1: number; m2: number; m3: number; m4: number; m5: number; m6: number; m7: number; m8: number; m9: number; m10: number; m11: number; m12: number;
  updated_at: string; updated_by_name: string | null;
}

export function listLines(user: UserRow, budget: BudgetRow, filter: { departmentId?: number; costCenterId?: number } = {}): BudgetLineDto[] {
  const scope = getScope(user);
  const statuses = deptStatuses(budget.id);
  const f = costCenterFilter(scope, 'bl.cost_center_id');
  const extra: string[] = [];
  const params: number[] = [];
  if (filter.departmentId) { extra.push(' AND c.department_id = ?'); params.push(filter.departmentId); }
  if (filter.costCenterId) { extra.push(' AND bl.cost_center_id = ?'); params.push(filter.costCenterId); }
  const rows = all<LineRow>(
    `SELECT bl.*, c.code AS cc_code, c.name AS cc_name, c.department_id, d.name AS department_name,
            a.code AS account_code, a.name AS account_name, a.type AS account_type, u.full_name AS updated_by_name
       FROM budget_lines bl
       JOIN cost_centers c ON c.id = bl.cost_center_id
       JOIN departments d ON d.id = c.department_id
       JOIN accounts a ON a.id = bl.account_id
       LEFT JOIN users u ON u.id = bl.updated_by
      WHERE bl.budget_id = ?${f.sql}${extra.join('')}
      ORDER BY d.code, c.code, a.code, bl.id`,
    budget.id, ...f.params, ...params,
  );
  const editableDept = new Map<number, boolean>();
  return rows.map((r) => {
    if (!editableDept.has(r.department_id)) editableDept.set(r.department_id, canEditDepartment(user, scope, budget, r.department_id, statuses));
    const months = MONTH_COLS.map((k) => r[k]);
    return {
      id: r.id,
      costCenterId: r.cost_center_id,
      costCenterCode: r.cc_code,
      costCenterName: r.cc_name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      accountId: r.account_id,
      accountCode: r.account_code,
      accountName: r.account_name,
      accountType: r.account_type,
      description: r.description,
      months,
      total: Math.round(months.reduce((s, m) => s + m, 0) * 100) / 100,
      canEdit: editableDept.get(r.department_id)! && inScopeCostCenter(scope, r.cost_center_id),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by_name,
    };
  });
}

/** First edit by a department moves its sub-flow from NOT_STARTED to IN_PROGRESS. */
export function markDepartmentInProgress(budgetId: number, departmentId: number): void {
  run(
    "UPDATE budget_departments SET status = 'IN_PROGRESS' WHERE budget_id = ? AND department_id = ? AND status = 'NOT_STARTED'",
    budgetId, departmentId,
  );
}

export function departmentOfCostCenter(companyId: number, costCenterId: number): number {
  const c = get<{ department_id: number }>('SELECT department_id FROM cost_centers WHERE id = ? AND company_id = ?', costCenterId, companyId);
  if (!c) throw notFound('Cost center');
  return c.department_id;
}

export function logEvent(e: {
  budgetId: number; departmentId?: number | null; userId: number; action: string;
  fromStatus?: string | null; toStatus?: string | null; comment?: string | null;
}): void {
  run(
    'INSERT INTO budget_events (budget_id, department_id, user_id, action, from_status, to_status, comment) VALUES (?, ?, ?, ?, ?, ?, ?)',
    e.budgetId, e.departmentId ?? null, e.userId, e.action, e.fromStatus ?? null, e.toStatus ?? null, e.comment ?? null,
  );
}
