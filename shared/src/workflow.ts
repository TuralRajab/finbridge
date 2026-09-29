import type { Permission, Role } from './roles';
import { can } from './roles';

/**
 * Budget life cycle
 *
 *   DRAFT ──open──▶ COLLECTING ──submit_to_cfo──▶ CFO_REVIEW ──approve──▶ APPROVED ──lock──▶ LOCKED
 *                        ▲                              │
 *                        └────────────reject────────────┘
 *
 * While COLLECTING, every department runs its own sub-flow:
 *
 *   NOT_STARTED ─edit─▶ IN_PROGRESS ─submit─▶ SUBMITTED ─review─▶ REVIEWED
 *                            ▲                    │                  │
 *                            └── CHANGES_REQUESTED ◀─request_changes─┘
 */
export const BUDGET_STATUSES = ['DRAFT', 'COLLECTING', 'CFO_REVIEW', 'APPROVED', 'LOCKED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const DEPT_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'REVIEWED'] as const;
export type DeptStatus = (typeof DEPT_STATUSES)[number];

export const BUDGET_ACTIONS = ['open', 'submit_to_cfo', 'approve', 'reject', 'lock'] as const;
export type BudgetAction = (typeof BUDGET_ACTIONS)[number];

export const DEPT_ACTIONS = ['submit', 'review', 'request_changes'] as const;
export type DeptAction = (typeof DEPT_ACTIONS)[number];

interface Transition<S> {
  from: readonly S[];
  to: S;
  permission: Permission;
  commentRequired?: boolean;
}

export const BUDGET_TRANSITIONS: Record<BudgetAction, Transition<BudgetStatus>> = {
  open: { from: ['DRAFT'], to: 'COLLECTING', permission: 'budget.manage' },
  submit_to_cfo: { from: ['COLLECTING'], to: 'CFO_REVIEW', permission: 'budget.manage' },
  approve: { from: ['CFO_REVIEW'], to: 'APPROVED', permission: 'budget.approve' },
  reject: { from: ['CFO_REVIEW'], to: 'COLLECTING', permission: 'budget.approve', commentRequired: true },
  lock: { from: ['APPROVED'], to: 'LOCKED', permission: 'budget.manage' },
};

export const DEPT_TRANSITIONS: Record<DeptAction, Transition<DeptStatus>> = {
  submit: { from: ['NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED'], to: 'SUBMITTED', permission: 'budget.submit' },
  review: { from: ['SUBMITTED'], to: 'REVIEWED', permission: 'budget.manage' },
  request_changes: { from: ['SUBMITTED', 'REVIEWED'], to: 'CHANGES_REQUESTED', permission: 'budget.manage', commentRequired: true },
};

export function canRunBudgetAction(role: Role, status: BudgetStatus, action: BudgetAction): boolean {
  const t = BUDGET_TRANSITIONS[action];
  return t.from.includes(status) && can(role, t.permission);
}

export function canRunDeptAction(role: Role, budgetStatus: BudgetStatus, deptStatus: DeptStatus, action: DeptAction): boolean {
  const t = DEPT_TRANSITIONS[action];
  return budgetStatus === 'COLLECTING' && t.from.includes(deptStatus) && can(role, t.permission);
}

/** Department statuses in which the department itself may still change its numbers. */
export const DEPT_EDITABLE_STATUSES: readonly DeptStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED'];

/**
 * Whether a user with `role` may edit lines of a department whose sub-flow is in `deptStatus`.
 * Scope (which departments / cost centers the user owns) is checked separately.
 */
export function canEditBudgetLines(role: Role, budgetStatus: BudgetStatus, deptStatus: DeptStatus | null): boolean {
  if (!can(role, 'budget.edit')) return false;
  const isFinance = can(role, 'budget.manage');
  if (budgetStatus === 'DRAFT') return isFinance;
  if (budgetStatus === 'COLLECTING') {
    if (isFinance) return true;
    return deptStatus !== null && DEPT_EDITABLE_STATUSES.includes(deptStatus);
  }
  return false;
}
