import { Router } from 'express';
import { z } from 'zod';
import { COMPANY_ROLES, permissionMatrix, PERMISSIONS } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { hashPassword } from '../auth/password';
import { audit, diff } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, notFound } from '../lib/errors';
import { assertSeatAvailable } from '../lib/license';
import { toUserDto, type UserRow } from '../lib/mappers';
import { toId } from '../lib/params';

export const usersRouter = Router();

usersRouter.get('/', requirePermission('masterdata.view'), (req, res) => {
  const rows = all<UserRow & { unit_name: string | null }>(
    'SELECT u.*, o.name AS unit_name FROM users u LEFT JOIN org_units o ON o.id = u.org_unit_id WHERE u.company_id = ? ORDER BY u.full_name', companyIdOf(req),
  );
  res.json(rows.map((u) => toUserDto(u, u.unit_name)));
});

usersRouter.get('/roles', requirePermission('masterdata.view'), (_req, res) => {
  res.json({ roles: COMPANY_ROLES, permissions: PERMISSIONS.filter((p) => p !== 'platform.manage'), matrix: permissionMatrix() });
});

const roleSchema = z.enum(COMPANY_ROLES as [string, ...string[]]);
const optId = z.number().int().positive().nullable().optional();

function assertRefs(companyId: number, b: { orgUnitId?: number | null; managerId?: number | null; jobFamilyId?: number | null }, selfId?: number): void {
  if (b.orgUnitId && !get('SELECT 1 FROM org_units WHERE id = ? AND company_id = ?', b.orgUnitId, companyId)) throw notFound('Org unit');
  if (b.managerId) {
    if (b.managerId === selfId) throw badRequest('VALIDATION_ERROR', 'A user cannot be their own manager');
    if (!get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', b.managerId, companyId)) throw notFound('Manager');
  }
  if (b.jobFamilyId && !get('SELECT 1 FROM job_families WHERE id = ? AND company_id = ?', b.jobFamilyId, companyId)) throw notFound('Job family');
}

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  role: roleSchema,
  orgUnitId: optId,
  managerId: optId,
  jobFamilyId: optId,
  jobTitle: z.string().trim().max(120).nullable().optional(),
  language: z.enum(['az', 'en']).default('az'),
  password: z.string().min(8).max(200),
});

usersRouter.post('/', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = createSchema.parse(req.body);
  assertRefs(companyId, b);
  assertSeatAvailable(companyId);
  const id = run(
    `INSERT INTO users (company_id, email, full_name, password_hash, role, org_unit_id, manager_id, job_family_id, job_title, language, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, b.email, b.fullName, hashPassword(b.password), b.role, b.orgUnitId ?? null, b.managerId ?? null, b.jobFamilyId ?? null,
    b.jobTitle ?? null, b.language, nowIso(),
  ).lastInsertRowid;
  audit(companyId, currentUser(req).id, 'USER', id, 'CREATED', { email: b.email, role: b.role });
  res.status(201).json(toUserDto(get<UserRow>('SELECT * FROM users WHERE id = ?', id)!));
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: roleSchema.optional(),
  orgUnitId: optId,
  managerId: optId,
  jobFamilyId: optId,
  jobTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

usersRouter.patch('/:id', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = updateSchema.parse(req.body);
  const u = get<UserRow>('SELECT * FROM users WHERE id = ? AND company_id = ?', id, companyId);
  if (!u) throw notFound('User');
  if (id === currentUser(req).id && (b.isActive === false || (b.role && b.role !== u.role))) {
    throw badRequest('VALIDATION_ERROR', 'You cannot deactivate yourself or change your own role');
  }
  assertRefs(companyId, b, id);
  if (b.isActive === true && u.is_active === 0) assertSeatAvailable(companyId);
  const next = {
    full_name: b.fullName ?? u.full_name, role: b.role ?? u.role,
    org_unit_id: b.orgUnitId !== undefined ? b.orgUnitId : u.org_unit_id, manager_id: b.managerId !== undefined ? b.managerId : u.manager_id,
    job_family_id: b.jobFamilyId !== undefined ? b.jobFamilyId : u.job_family_id, job_title: b.jobTitle !== undefined ? b.jobTitle : u.job_title,
    is_active: b.isActive === undefined ? u.is_active : b.isActive ? 1 : 0,
  };
  run('UPDATE users SET full_name = ?, role = ?, org_unit_id = ?, manager_id = ?, job_family_id = ?, job_title = ?, is_active = ? WHERE id = ?',
    next.full_name, next.role, next.org_unit_id, next.manager_id, next.job_family_id, next.job_title, next.is_active, id);
  if (b.password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), id);
  audit(companyId, currentUser(req).id, 'USER', id, 'UPDATED', { ...diff(u as unknown as Record<string, unknown>, next), ...(b.password ? { password: ['***', '***'] } : {}) });
  res.json(toUserDto(get<UserRow>('SELECT * FROM users WHERE id = ?', id)!));
});
