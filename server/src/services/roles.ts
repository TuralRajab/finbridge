/**
 * Company roles: the built-in roles as editable per-company rows plus custom roles.
 * A role = permissions (what the user may do / which pages they see) + data scope (which data).
 * users.role keeps the built-in role the user's role is based on; users.role_id the effective role.
 */
import {
  ASSIGNABLE_PERMISSIONS, COMPANY_ROLES, DEFAULT_SCOPE, expandPermissions, permissionsFor,
  type CompanyRoleDto, type DataScope, type Permission, type Role,
} from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { nowIso } from '../lib/clock';
import { parseJson } from '../lib/json';
import type { UserRow } from '../lib/mappers';

export type BaseRole = Exclude<Role, 'SUPER_ADMIN'>;

export interface RoleRow {
  id: number;
  company_id: number;
  code: string;
  name: string;
  name_en: string | null;
  description: string | null;
  base_role: BaseRole;
  permissions: string;
  data_scope: DataScope;
  is_system: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** The built-in names (the UI translates system role codes; these are stored for exports and custom-role copies). */
const SYSTEM_NAMES: Record<BaseRole, [string, string]> = {
  ADMIN: ['Administrator', 'Administrator'], CEO: ['Baş icraçı direktor (CEO)', 'Chief executive (CEO)'], CFO: ['Maliyyə direktoru (CFO)', 'Chief financial officer (CFO)'],
  FINANCE_MANAGER: ['Maliyyə meneceri', 'Finance manager'], DEPARTMENT_MANAGER: ['Departament rəhbəri', 'Department head'],
  COST_CENTER_OWNER: ['Xərc mərkəzi sahibi', 'Cost center owner'], EMPLOYEE: ['Əməkdaş', 'Employee'], VIEWER: ['Baxış hüququ', 'Viewer'],
};

/** Stored permissions exclude the implicit reference-data permission. */
const defaultPerms = (r: BaseRole): Permission[] => permissionsFor(r).filter((p) => p !== 'masterdata.view');

/** Creates the built-in role rows a company is missing (idempotent). */
export function ensureSystemRoles(companyId: number): void {
  const have = new Set(all<{ code: string }>('SELECT code FROM company_roles WHERE company_id = ? AND is_system = 1', companyId).map((r) => r.code));
  const ts = nowIso();
  for (const r of COMPANY_ROLES) {
    if (have.has(r)) continue;
    run(`INSERT OR IGNORE INTO company_roles (company_id, code, name, name_en, description, base_role, permissions, data_scope, is_system, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1, 1, ?, ?)`,
      companyId, r, SYSTEM_NAMES[r][0], SYSTEM_NAMES[r][1], r, JSON.stringify(defaultPerms(r)), DEFAULT_SCOPE[r], ts, ts);
  }
}

export function roleRows(companyId: number): RoleRow[] {
  ensureSystemRoles(companyId);
  return all<RoleRow>('SELECT * FROM company_roles WHERE company_id = ? ORDER BY is_system DESC, id', companyId);
}

export function roleById(companyId: number, id: number): RoleRow | undefined {
  return get<RoleRow>('SELECT * FROM company_roles WHERE id = ? AND company_id = ?', id, companyId);
}

export function roleByCode(companyId: number, code: string): RoleRow | undefined {
  ensureSystemRoles(companyId);
  return get<RoleRow>('SELECT * FROM company_roles WHERE company_id = ? AND code = ? COLLATE NOCASE', companyId, code);
}

/** The role row that applies to a user: users.role_id, else the built-in row of users.role. */
export function roleOfUser(user: Pick<UserRow, 'company_id' | 'role' | 'role_id'>): RoleRow | null {
  if (user.company_id === null) return null;
  if (user.role_id) {
    const r = roleById(user.company_id, user.role_id);
    if (r && r.is_active === 1) return r;
  }
  return roleByCode(user.company_id, user.role) ?? null;
}

export const isLocked = (r: Pick<RoleRow, 'is_system' | 'code'>) => r.is_system === 1 && r.code === 'ADMIN';

export function rolePermissions(r: RoleRow): Permission[] {
  // The Administrator role always has everything, so a company can never lock itself out.
  if (isLocked(r)) return expandPermissions(ASSIGNABLE_PERMISSIONS);
  return expandPermissions(parseJson<string[]>(r.permissions, []));
}

export interface Effective { permissions: Set<Permission>; scope: DataScope | null; roleCode: string; roleName: string; roleId: number | null }

/** Effective permissions / scope of a user; cached on the request's user object. */
export function effective(user: UserRow): Effective {
  const cached = (user as UserRow & { _eff?: Effective })._eff;
  if (cached) return cached;
  let eff: Effective;
  if (user.company_id === null) {
    eff = { permissions: new Set(permissionsFor(user.role)), scope: null, roleCode: user.role, roleName: user.role, roleId: null };
  } else {
    const r = roleOfUser(user);
    eff = r
      ? { permissions: new Set(rolePermissions(r)), scope: r.data_scope, roleCode: r.code, roleName: r.name, roleId: r.id }
      : { permissions: new Set(permissionsFor(user.role)), scope: DEFAULT_SCOPE[user.role as BaseRole], roleCode: user.role, roleName: user.role, roleId: null };
  }
  (user as UserRow & { _eff?: Effective })._eff = eff;
  return eff;
}

export function toRoleDto(r: RoleRow, userCount: number): CompanyRoleDto {
  const perms = isLocked(r) ? [...ASSIGNABLE_PERMISSIONS].filter((p) => p !== 'masterdata.view') : parseJson<Permission[]>(r.permissions, []);
  const defaults = r.is_system ? defaultPerms(r.code as BaseRole) : [];
  const customized = r.is_system === 1 && (
    [...new Set(perms)].sort().join(',') !== [...new Set(defaults)].sort().join(',') || r.data_scope !== DEFAULT_SCOPE[r.code as BaseRole]);
  return {
    id: r.id, code: r.code, name: r.name, nameEn: r.name_en, description: r.description, baseRole: r.base_role,
    permissions: perms, dataScope: r.data_scope, isSystem: r.is_system === 1, isLocked: isLocked(r), isActive: r.is_active === 1,
    userCount, isCustomized: customized, updatedAt: r.updated_at,
  };
}

export function listRoles(companyId: number): CompanyRoleDto[] {
  const rows = roleRows(companyId);
  const counts = new Map<number, number>();
  for (const u of all<{ role: string; role_id: number | null }>('SELECT role, role_id FROM users WHERE company_id = ? AND is_active = 1', companyId)) {
    const r = (u.role_id && rows.find((x) => x.id === u.role_id && x.is_active === 1)) || rows.find((x) => x.is_system === 1 && x.code === u.role);
    if (r) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  }
  return rows.map((r) => toRoleDto(r, counts.get(r.id) ?? 0));
}

export const defaultPermissionsOf = defaultPerms;
