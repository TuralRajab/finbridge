import { Router } from 'express';
import { z } from 'zod';
import { COMPANY_ROLES } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { hashPassword } from '../auth/password';
import { badRequest, notFound } from '../lib/errors';
import { assertSeatAvailable } from '../lib/license';
import { toUserDto, type UserRow } from '../lib/mappers';
import { toId } from '../lib/params';

export const usersRouter = Router();

usersRouter.get('/', requirePermission('masterdata.view'), (req, res) => {
  const rows = all<UserRow>('SELECT * FROM users WHERE company_id = ? ORDER BY full_name', companyIdOf(req));
  res.json(rows.map(toUserDto));
});

const roleSchema = z.enum(COMPANY_ROLES as [string, ...string[]]);

function assertDepartment(companyId: number, departmentId: number | null | undefined): void {
  if (departmentId == null) return;
  if (!get('SELECT id FROM departments WHERE id = ? AND company_id = ?', departmentId, companyId)) throw notFound('Department');
}

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  role: roleSchema,
  departmentId: z.number().int().positive().nullable().optional(),
  language: z.enum(['az', 'en']).default('az'),
  password: z.string().min(8).max(200),
});

usersRouter.post('/', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const body = createSchema.parse(req.body);
  assertDepartment(companyId, body.departmentId);
  assertSeatAvailable(companyId);
  const id = run(
    'INSERT INTO users (company_id, email, full_name, password_hash, role, department_id, language) VALUES (?, ?, ?, ?, ?, ?, ?)',
    companyId, body.email, body.fullName, hashPassword(body.password), body.role, body.departmentId ?? null, body.language,
  ).lastInsertRowid;
  res.status(201).json(toUserDto(get<UserRow>('SELECT * FROM users WHERE id = ?', id)!));
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: roleSchema.optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

usersRouter.patch('/:id', requirePermission('users.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const body = updateSchema.parse(req.body);
  const u = get<UserRow>('SELECT * FROM users WHERE id = ? AND company_id = ?', id, companyId);
  if (!u) throw notFound('User');
  if (id === currentUser(req).id && (body.isActive === false || (body.role && body.role !== u.role))) {
    throw badRequest('VALIDATION_ERROR', 'You cannot deactivate yourself or change your own role');
  }
  if (body.departmentId !== undefined) assertDepartment(companyId, body.departmentId);
  if (body.isActive === true && u.is_active === 0) assertSeatAvailable(companyId);
  run(
    'UPDATE users SET full_name = ?, role = ?, department_id = ?, is_active = ? WHERE id = ?',
    body.fullName ?? u.full_name,
    body.role ?? u.role,
    body.departmentId !== undefined ? body.departmentId : u.department_id,
    body.isActive === undefined ? u.is_active : body.isActive ? 1 : 0,
    id,
  );
  if (body.password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.password), id);
  res.json(toUserDto(get<UserRow>('SELECT * FROM users WHERE id = ?', id)!));
});
