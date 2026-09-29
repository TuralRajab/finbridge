import { hasCompanyWideScope } from '@finbridge/shared';
import { all } from '../db/database';
import type { UserRow } from './mappers';

/**
 * Data visibility for a user.
 *  - company-wide roles (Admin, CFO, Finance, Viewer) see everything
 *  - Department Manager sees the departments they manage (and their cost centers)
 *  - Cost Center Owner sees only the cost centers they own
 */
export interface Scope {
  all: boolean;
  departmentIds: Set<number>;
  costCenterIds: Set<number>;
}

export function getScope(user: UserRow): Scope {
  if (hasCompanyWideScope(user.role) || user.company_id === null) {
    return { all: true, departmentIds: new Set(), costCenterIds: new Set() };
  }
  if (user.role === 'DEPARTMENT_MANAGER') {
    const depts = all<{ id: number }>(
      'SELECT id FROM departments WHERE company_id = ? AND (manager_id = ? OR id = ?)',
      user.company_id, user.id, user.department_id ?? -1,
    ).map((r) => r.id);
    const ccs = depts.length
      ? all<{ id: number }>(`SELECT id FROM cost_centers WHERE department_id IN (${depts.map(() => '?').join(',')})`, ...depts).map((r) => r.id)
      : [];
    return { all: false, departmentIds: new Set(depts), costCenterIds: new Set(ccs) };
  }
  // COST_CENTER_OWNER
  const rows = all<{ id: number; department_id: number }>(
    'SELECT id, department_id FROM cost_centers WHERE company_id = ? AND owner_id = ?',
    user.company_id, user.id,
  );
  return {
    all: false,
    departmentIds: new Set(rows.map((r) => r.department_id)),
    costCenterIds: new Set(rows.map((r) => r.id)),
  };
}

export function inScopeCostCenter(scope: Scope, costCenterId: number): boolean {
  return scope.all || scope.costCenterIds.has(costCenterId);
}

export function inScopeDepartment(scope: Scope, departmentId: number): boolean {
  return scope.all || scope.departmentIds.has(departmentId);
}

/** SQL fragment restricting a cost-center column to the scope, e.g. `AND bl.cost_center_id IN (...)`. */
export function costCenterFilter(scope: Scope, column: string): { sql: string; params: number[] } {
  if (scope.all) return { sql: '', params: [] };
  const ids = [...scope.costCenterIds];
  if (!ids.length) return { sql: ' AND 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
