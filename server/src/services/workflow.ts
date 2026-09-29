import {
  BUDGET_TRANSITIONS, DEPT_TRANSITIONS, can,
  type BudgetAction, type DeptAction, type DeptStatus,
} from '@finbridge/shared';
import { get, run, tx } from '../db/database';
import { badRequest, conflict, forbidden, HttpError } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { getScope } from '../lib/scope';
import { canSubmitDepartment, logEvent, type BudgetRow } from './budgets';

function cleanComment(comment?: string | null): string | null {
  const c = comment?.trim();
  return c ? c.slice(0, 2000) : null;
}

export function runBudgetAction(user: UserRow, budget: BudgetRow, action: BudgetAction, rawComment?: string | null): void {
  const t = BUDGET_TRANSITIONS[action];
  const comment = cleanComment(rawComment);
  if (!can(user.role, t.permission)) throw forbidden();
  if (!t.from.includes(budget.status)) {
    throw conflict('INVALID_TRANSITION', `Cannot ${action} a budget in status ${budget.status}`);
  }
  if (t.commentRequired && !comment) throw badRequest('COMMENT_REQUIRED', 'A comment is required');

  tx(() => {
    if (action === 'open') {
      run(
        `INSERT OR IGNORE INTO budget_departments (budget_id, department_id)
         SELECT ?, id FROM departments WHERE company_id = ? AND is_active = 1`,
        budget.id, budget.company_id,
      );
    }
    if (action === 'submit_to_cfo') {
      const pending = get<{ n: number; total: number }>(
        "SELECT SUM(status <> 'REVIEWED') AS n, COUNT(*) AS total FROM budget_departments WHERE budget_id = ?",
        budget.id,
      );
      if (!pending?.total || (pending.n ?? 0) > 0) {
        throw new HttpError(409, 'DEPARTMENTS_NOT_REVIEWED', 'All departments must be reviewed before sending to the CFO');
      }
    }
    if (action === 'approve') {
      run("UPDATE budgets SET approved_by = ?, approved_at = datetime('now') WHERE id = ?", user.id, budget.id);
    }
    if (action === 'lock') {
      run("UPDATE budgets SET locked_at = datetime('now') WHERE id = ?", budget.id);
    }
    run('UPDATE budgets SET status = ? WHERE id = ?', t.to, budget.id);
    logEvent({ budgetId: budget.id, userId: user.id, action, fromStatus: budget.status, toStatus: t.to, comment });
  });
}

export function runDeptAction(user: UserRow, budget: BudgetRow, departmentId: number, action: DeptAction, rawComment?: string | null): void {
  const t = DEPT_TRANSITIONS[action];
  const comment = cleanComment(rawComment);
  if (!can(user.role, t.permission)) throw forbidden();
  if (action === 'submit' && !canSubmitDepartment(user, getScope(user), departmentId)) throw forbidden();
  if (budget.status !== 'COLLECTING') {
    throw conflict('INVALID_TRANSITION', 'Department actions are only possible while the budget is collecting');
  }
  const row = get<{ status: DeptStatus }>(
    'SELECT status FROM budget_departments WHERE budget_id = ? AND department_id = ?', budget.id, departmentId,
  );
  if (!row) throw conflict('INVALID_TRANSITION', 'Department is not part of this budget');
  if (!t.from.includes(row.status)) {
    throw conflict('INVALID_TRANSITION', `Cannot ${action} a department in status ${row.status}`);
  }
  if (t.commentRequired && !comment) throw badRequest('COMMENT_REQUIRED', 'A comment is required');

  tx(() => {
    if (action === 'submit') {
      run(
        "UPDATE budget_departments SET status = ?, submitted_at = datetime('now'), submitted_by = ? WHERE budget_id = ? AND department_id = ?",
        t.to, user.id, budget.id, departmentId,
      );
    } else if (action === 'review') {
      run(
        "UPDATE budget_departments SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE budget_id = ? AND department_id = ?",
        t.to, user.id, budget.id, departmentId,
      );
    } else {
      run('UPDATE budget_departments SET status = ?, reviewed_at = NULL WHERE budget_id = ? AND department_id = ?', t.to, budget.id, departmentId);
    }
    logEvent({ budgetId: budget.id, departmentId, userId: user.id, action, fromStatus: row.status, toStatus: t.to, comment });
  });
}
