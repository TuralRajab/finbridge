import { userScope } from './permissions';
import { OrgIndex } from '../services/org';
import type { UserRow } from './mappers';

/**
 * Object-level visibility, derived from the organisation structure:
 *  - company-wide roles see everything
 *  - unit heads (department managers) see the subtree of the units they head
 *  - cost-center owners / responsible persons see their cost centers
 *  - employees see only their own requests and may raise requests on cost centers of their home unit subtree
 * Approvers additionally see items assigned to them (checked per entity).
 */
export interface Scope {
  all: boolean;
  unitIds: Set<number>;
  costCenterIds: Set<number>;
  /** Cost centers the user may raise requests against. */
  requestCostCenterIds: Set<number>;
  ownRequestsOnly: boolean;
}

export function getScope(user: UserRow, org?: OrgIndex): Scope {
  const scope = user.company_id === null ? 'COMPANY' : userScope(user);
  if (scope === 'COMPANY') {
    return { all: true, unitIds: new Set(), costCenterIds: new Set(), requestCostCenterIds: new Set(), ownRequestsOnly: false };
  }
  const idx = org ?? OrgIndex.load(user.company_id!);
  const unitIds = new Set<number>();
  const ccIds = new Set<number>();

  if (scope === 'UNIT') {
    for (const u of idx.units.values()) {
      if (u.headUserId === user.id) idx.subtree(u.id).forEach((id) => unitIds.add(id));
    }
    for (const c of idx.costCenters.values()) if (unitIds.has(c.orgUnitId)) ccIds.add(c.id);
  }
  for (const c of idx.costCenters.values()) {
    if (c.ownerUserId === user.id || c.responsibleUserId === user.id) {
      ccIds.add(c.id);
      unitIds.add(c.orgUnitId);
    }
  }
  // Sections containing the user's cost centers are visible (status only, lines stay filtered).
  for (const ccId of ccIds) unitIds.add(idx.sectionOfCostCenter(ccId).id);

  if (scope === 'OWN') {
    const reqCcs = new Set<number>();
    if (user.org_unit_id && idx.units.has(user.org_unit_id)) idx.ccsInSubtree(user.org_unit_id).forEach((c) => reqCcs.add(c.id));
    return { all: false, unitIds: new Set(), costCenterIds: new Set(), requestCostCenterIds: reqCcs, ownRequestsOnly: true };
  }
  return { all: false, unitIds, costCenterIds: ccIds, requestCostCenterIds: new Set(ccIds), ownRequestsOnly: false };
}

export function inScopeCostCenter(scope: Scope, costCenterId: number): boolean {
  return scope.all || scope.costCenterIds.has(costCenterId);
}

export function inScopeUnit(scope: Scope, unitId: number): boolean {
  return scope.all || scope.unitIds.has(unitId);
}

/** SQL fragment restricting a cost-center column to the scope. */
export function costCenterFilter(scope: Scope, column: string): { sql: string; params: number[] } {
  if (scope.all) return { sql: '', params: [] };
  const ids = [...scope.costCenterIds];
  if (!ids.length) return { sql: ' AND 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
