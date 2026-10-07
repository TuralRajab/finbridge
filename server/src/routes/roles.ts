import { Router } from 'express';
import { z } from 'zod';
import { ASSIGNABLE_PERMISSIONS, COMPANY_ROLES, DATA_SCOPES, DEFAULT_SCOPE, type Permission } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, conflict, notFound } from '../lib/errors';
import { parseJson } from '../lib/json';
import { toId } from '../lib/params';
import { defaultPermissionsOf, effective, isLocked, listRoles, roleById, roleByCode, type BaseRole } from '../services/roles';

export const rolesRouter = Router();

const permissionList = z.array(z.enum(ASSIGNABLE_PERMISSIONS as [Permission, ...Permission[]])).max(100)
  .transform((p) => [...new Set(p)].filter((x) => x !== 'masterdata.view').sort());
const baseRole = z.enum(COMPANY_ROLES as [BaseRole, ...BaseRole[]]);

const roleSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z][A-Za-z0-9_\-]*$/, 'Latin letters, digits, - and _ only').transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  baseRole: baseRole.default('VIEWER'),
  permissions: permissionList,
  dataScope: z.enum(DATA_SCOPES),
  isActive: z.boolean().default(true),
});

const respond = (companyId: number, id: number) => listRoles(companyId).find((r) => r.id === id);

rolesRouter.get('/', requirePermission('masterdata.view'), (req, res) => { res.json(listRoles(companyIdOf(req))); });

rolesRouter.post('/', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = roleSchema.parse(req.body);
  if (roleByCode(companyId, b.code)) throw conflict('DUPLICATE_CODE', `A role with code ${b.code} already exists`);
  const ts = nowIso();
  const id = Number(run(`INSERT INTO company_roles (company_id, code, name, name_en, description, base_role, permissions, data_scope, is_system, is_active, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    companyId, b.code, b.name, b.nameEn ?? null, b.description ?? null, b.baseRole, JSON.stringify(b.permissions), b.dataScope, +b.isActive, ts, ts).lastInsertRowid);
  audit(companyId, currentUser(req).id, 'ROLE', id, 'CREATED', { code: b.code, baseRole: b.baseRole, dataScope: b.dataScope, permissions: b.permissions });
  res.status(201).json(respond(companyId, id));
});

rolesRouter.patch('/:id', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const r = roleById(companyId, id);
  if (!r) throw notFound('Role');
  const b = roleSchema.omit({ code: true }).partial().parse(req.body);
  if (isLocked(r) && (b.permissions !== undefined || b.dataScope !== undefined || b.isActive === false || b.baseRole !== undefined)) {
    throw badRequest('VALIDATION_ERROR', 'The Administrator role always has all permissions and cannot be changed');
  }
  if (r.is_system && b.baseRole !== undefined && b.baseRole !== r.base_role) throw badRequest('VALIDATION_ERROR', 'The base of a built-in role cannot change');
  const usersOfRole = all<{ id: number; is_active: number }>(
    'SELECT id, is_active FROM users WHERE company_id = ? AND (role_id = ? OR (role_id IS NULL AND role = ? AND ? = 1))', companyId, id, r.code, r.is_system,
  );
  if (b.isActive === false && r.is_active === 1) {
    if (r.is_system) throw badRequest('VALIDATION_ERROR', 'Built-in roles cannot be deactivated');
    if (usersOfRole.some((u) => u.is_active === 1)) throw conflict('IN_USE', 'Assign its active users another role first');
  }
  // never let an administrator remove their own ability to manage users
  const me = currentUser(req);
  if (effective(me).roleId === id && b.permissions && !b.permissions.includes('users.manage') && !isLocked(r)) {
    throw badRequest('VALIDATION_ERROR', 'You cannot remove "Manage users and roles" from your own role');
  }
  const next = {
    name: b.name ?? r.name, name_en: b.nameEn !== undefined ? b.nameEn : r.name_en, description: b.description !== undefined ? b.description : r.description,
    base_role: b.baseRole ?? r.base_role, permissions: b.permissions ? JSON.stringify(b.permissions) : r.permissions, data_scope: b.dataScope ?? r.data_scope,
    is_active: b.isActive === undefined ? r.is_active : +b.isActive,
  };
  tx(() => {
    run('UPDATE company_roles SET name = ?, name_en = ?, description = ?, base_role = ?, permissions = ?, data_scope = ?, is_active = ?, updated_at = ? WHERE id = ?',
      next.name, next.name_en, next.description, next.base_role, next.permissions, next.data_scope, next.is_active, nowIso(), id);
    // users of a custom role count as its base role in CEO / CFO / Finance approver steps
    if (next.base_role !== r.base_role) run('UPDATE users SET role = ? WHERE company_id = ? AND role_id = ?', next.base_role, companyId, id);
    const before = parseJson<string[]>(r.permissions, []);
    const after = parseJson<string[]>(next.permissions, []);
    audit(companyId, me.id, 'ROLE', id, 'UPDATED', {
      added: after.filter((p) => !before.includes(p)), removed: before.filter((p) => !after.includes(p)),
      ...(next.data_scope !== r.data_scope ? { dataScope: [r.data_scope, next.data_scope] } : {}),
      ...(next.base_role !== r.base_role ? { baseRole: [r.base_role, next.base_role] } : {}),
      ...(next.name !== r.name ? { name: [r.name, next.name] } : {}),
      ...(next.is_active !== r.is_active ? { isActive: [r.is_active === 1, next.is_active === 1] } : {}),
    });
  });
  res.json(respond(companyId, id));
});

/** Restores FinBridge's default permissions and data scope of a built-in role. */
rolesRouter.post('/:id/reset', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const r = roleById(companyId, id);
  if (!r) throw notFound('Role');
  if (!r.is_system) throw badRequest('VALIDATION_ERROR', 'Only built-in roles have defaults');
  const code = r.code as BaseRole;
  run('UPDATE company_roles SET permissions = ?, data_scope = ?, updated_at = ? WHERE id = ?', JSON.stringify(defaultPermissionsOf(code)), DEFAULT_SCOPE[code], nowIso(), id);
  audit(companyId, currentUser(req).id, 'ROLE', id, 'RESET', null);
  res.json(respond(companyId, id));
});

rolesRouter.delete('/:id', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const r = roleById(companyId, id);
  if (!r) throw notFound('Role');
  if (r.is_system) throw badRequest('VALIDATION_ERROR', 'Built-in roles cannot be deleted');
  if (get('SELECT 1 FROM users WHERE role_id = ? LIMIT 1', id)) throw conflict('IN_USE', 'The role is assigned to users — assign them another role first');
  run('DELETE FROM company_roles WHERE id = ?', id);
  audit(companyId, currentUser(req).id, 'ROLE', id, 'DELETED', { code: r.code });
  res.status(204).end();
});
