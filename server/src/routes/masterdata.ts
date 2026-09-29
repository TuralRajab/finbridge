import { Router } from 'express';
import { z } from 'zod';
import type { AccountDto, CostCenterDto, DepartmentDto } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, requirePermission } from '../auth/middleware';
import { conflict, notFound } from '../lib/errors';
import { toId } from '../lib/params';

const code = z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N}_\-.]+$/u, 'Letters, digits, - _ . only');
const name = z.string().trim().min(1).max(160);
const optionalUser = z.number().int().positive().nullable().optional();

function assertUser(companyId: number, userId: number | null | undefined): void {
  if (userId == null) return;
  if (!get('SELECT id FROM users WHERE id = ? AND company_id = ?', userId, companyId)) throw notFound('User');
}

/* ------------------------------------------------------------------ departments */

export const departmentsRouter = Router();

interface DepartmentRow {
  id: number; code: string; name: string; manager_id: number | null; manager_name: string | null; is_active: number; cc_count: number;
}

export function listDepartments(companyId: number): DepartmentDto[] {
  return all<DepartmentRow>(
    `SELECT d.id, d.code, d.name, d.manager_id, u.full_name AS manager_name, d.is_active,
            (SELECT COUNT(*) FROM cost_centers c WHERE c.department_id = d.id) AS cc_count
       FROM departments d LEFT JOIN users u ON u.id = d.manager_id
      WHERE d.company_id = ? ORDER BY d.code`,
    companyId,
  ).map((r) => ({
    id: r.id, code: r.code, name: r.name, managerId: r.manager_id, managerName: r.manager_name,
    isActive: r.is_active === 1, costCenterCount: r.cc_count,
  }));
}

departmentsRouter.get('/', requirePermission('masterdata.view'), (req, res) => {
  res.json(listDepartments(companyIdOf(req)));
});

const deptSchema = z.object({ code, name, managerId: optionalUser, isActive: z.boolean().optional() });

departmentsRouter.post('/', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const body = deptSchema.parse(req.body);
  assertUser(companyId, body.managerId);
  const id = run(
    'INSERT INTO departments (company_id, code, name, manager_id) VALUES (?, ?, ?, ?)',
    companyId, body.code, body.name, body.managerId ?? null,
  ).lastInsertRowid;
  // A department added while a budget is collecting joins that budget's approval flow.
  run(
    `INSERT OR IGNORE INTO budget_departments (budget_id, department_id)
     SELECT id, ? FROM budgets WHERE company_id = ? AND status = 'COLLECTING'`,
    id, companyId,
  );
  res.status(201).json(listDepartments(companyId).find((d) => d.id === id));
});

departmentsRouter.patch('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const body = deptSchema.partial().parse(req.body);
  const d = get<{ code: string; name: string; manager_id: number | null; is_active: number }>(
    'SELECT code, name, manager_id, is_active FROM departments WHERE id = ? AND company_id = ?', id, companyId,
  );
  if (!d) throw notFound('Department');
  assertUser(companyId, body.managerId);
  run(
    'UPDATE departments SET code = ?, name = ?, manager_id = ?, is_active = ? WHERE id = ?',
    body.code ?? d.code, body.name ?? d.name, body.managerId !== undefined ? body.managerId : d.manager_id,
    body.isActive === undefined ? d.is_active : body.isActive ? 1 : 0, id,
  );
  res.json(listDepartments(companyId).find((x) => x.id === id));
});

departmentsRouter.delete('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  if (get('SELECT id FROM cost_centers WHERE department_id = ? LIMIT 1', id)) {
    throw conflict('IN_USE', 'Department still has cost centers');
  }
  const r = run('DELETE FROM departments WHERE id = ? AND company_id = ?', id, companyId);
  if (!r.changes) throw notFound('Department');
  res.status(204).end();
});

/* ------------------------------------------------------------------ cost centers */

export const costCentersRouter = Router();

interface CostCenterRow {
  id: number; code: string; name: string; department_id: number; department_name: string;
  owner_id: number | null; owner_name: string | null; is_active: number;
}

export function listCostCenters(companyId: number): CostCenterDto[] {
  return all<CostCenterRow>(
    `SELECT c.id, c.code, c.name, c.department_id, d.name AS department_name, c.owner_id, u.full_name AS owner_name, c.is_active
       FROM cost_centers c
       JOIN departments d ON d.id = c.department_id
       LEFT JOIN users u ON u.id = c.owner_id
      WHERE c.company_id = ? ORDER BY c.code`,
    companyId,
  ).map((r) => ({
    id: r.id, code: r.code, name: r.name, departmentId: r.department_id, departmentName: r.department_name,
    ownerId: r.owner_id, ownerName: r.owner_name, isActive: r.is_active === 1,
  }));
}

costCentersRouter.get('/', requirePermission('masterdata.view'), (req, res) => {
  res.json(listCostCenters(companyIdOf(req)));
});

const ccSchema = z.object({
  code, name, departmentId: z.number().int().positive(), ownerId: optionalUser, isActive: z.boolean().optional(),
});

function assertDepartment(companyId: number, departmentId: number): void {
  if (!get('SELECT id FROM departments WHERE id = ? AND company_id = ?', departmentId, companyId)) throw notFound('Department');
}

costCentersRouter.post('/', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const body = ccSchema.parse(req.body);
  assertDepartment(companyId, body.departmentId);
  assertUser(companyId, body.ownerId);
  const id = run(
    'INSERT INTO cost_centers (company_id, department_id, code, name, owner_id) VALUES (?, ?, ?, ?, ?)',
    companyId, body.departmentId, body.code, body.name, body.ownerId ?? null,
  ).lastInsertRowid;
  res.status(201).json(listCostCenters(companyId).find((c) => c.id === id));
});

costCentersRouter.patch('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const body = ccSchema.partial().parse(req.body);
  const c = get<{ code: string; name: string; department_id: number; owner_id: number | null; is_active: number }>(
    'SELECT code, name, department_id, owner_id, is_active FROM cost_centers WHERE id = ? AND company_id = ?', id, companyId,
  );
  if (!c) throw notFound('Cost center');
  if (body.departmentId) assertDepartment(companyId, body.departmentId);
  assertUser(companyId, body.ownerId);
  run(
    'UPDATE cost_centers SET code = ?, name = ?, department_id = ?, owner_id = ?, is_active = ? WHERE id = ?',
    body.code ?? c.code, body.name ?? c.name, body.departmentId ?? c.department_id,
    body.ownerId !== undefined ? body.ownerId : c.owner_id,
    body.isActive === undefined ? c.is_active : body.isActive ? 1 : 0, id,
  );
  res.json(listCostCenters(companyId).find((x) => x.id === id));
});

costCentersRouter.delete('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  if (get('SELECT 1 FROM budget_lines WHERE cost_center_id = ? UNION SELECT 1 FROM actuals WHERE cost_center_id = ? LIMIT 1', id, id)) {
    throw conflict('IN_USE', 'Cost center has budget or actual data — deactivate it instead');
  }
  const r = run('DELETE FROM cost_centers WHERE id = ? AND company_id = ?', id, companyId);
  if (!r.changes) throw notFound('Cost center');
  res.status(204).end();
});

/* ------------------------------------------------------------------ accounts */

export const accountsRouter = Router();

export function listAccounts(companyId: number): AccountDto[] {
  return all<{ id: number; code: string; name: string; type: 'OPEX' | 'CAPEX'; is_active: number }>(
    'SELECT id, code, name, type, is_active FROM accounts WHERE company_id = ? ORDER BY code', companyId,
  ).map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, isActive: r.is_active === 1 }));
}

accountsRouter.get('/', requirePermission('masterdata.view'), (req, res) => {
  res.json(listAccounts(companyIdOf(req)));
});

const accountSchema = z.object({ code, name, type: z.enum(['OPEX', 'CAPEX']), isActive: z.boolean().optional() });

accountsRouter.post('/', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const body = accountSchema.parse(req.body);
  const id = run('INSERT INTO accounts (company_id, code, name, type) VALUES (?, ?, ?, ?)', companyId, body.code, body.name, body.type).lastInsertRowid;
  res.status(201).json(listAccounts(companyId).find((a) => a.id === id));
});

accountsRouter.patch('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const body = accountSchema.partial().parse(req.body);
  const a = get<{ code: string; name: string; type: string; is_active: number }>(
    'SELECT code, name, type, is_active FROM accounts WHERE id = ? AND company_id = ?', id, companyId,
  );
  if (!a) throw notFound('Account');
  run(
    'UPDATE accounts SET code = ?, name = ?, type = ?, is_active = ? WHERE id = ?',
    body.code ?? a.code, body.name ?? a.name, body.type ?? a.type,
    body.isActive === undefined ? a.is_active : body.isActive ? 1 : 0, id,
  );
  res.json(listAccounts(companyId).find((x) => x.id === id));
});

accountsRouter.delete('/:id', requirePermission('masterdata.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  if (get('SELECT 1 FROM budget_lines WHERE account_id = ? UNION SELECT 1 FROM actuals WHERE account_id = ? LIMIT 1', id, id)) {
    throw conflict('IN_USE', 'Account has budget or actual data — deactivate it instead');
  }
  const r = run('DELETE FROM accounts WHERE id = ? AND company_id = ?', id, companyId);
  if (!r.changes) throw notFound('Account');
  res.status(204).end();
});
