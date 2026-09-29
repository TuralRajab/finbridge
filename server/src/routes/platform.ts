import { Router } from 'express';
import { z } from 'zod';
import { LICENSE_PLANS, type PlatformCompanyDto } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { requirePermission } from '../auth/middleware';
import { hashPassword } from '../auth/password';
import { notFound } from '../lib/errors';
import type { CompanyRow } from '../lib/license';
import { toCompanyDto } from '../lib/mappers';
import { toId } from '../lib/params';

/** FinBridge operator endpoints: companies (tenants) and their licences. */
export const platformRouter = Router();
platformRouter.use(requirePermission('platform.manage'));

function dto(c: CompanyRow): PlatformCompanyDto {
  const admin = get<{ email: string }>("SELECT email FROM users WHERE company_id = ? AND role = 'ADMIN' ORDER BY id LIMIT 1", c.id);
  return { ...toCompanyDto(c), adminEmail: admin?.email ?? null };
}

platformRouter.get('/companies', (_req, res) => {
  res.json(all<CompanyRow>('SELECT * FROM companies ORDER BY name').map(dto));
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  taxId: z.string().trim().max(20).optional().nullable(),
  plan: z.enum(LICENSE_PLANS),
  maxUsers: z.number().int().min(1).max(10000),
  validUntil: dateSchema,
  admin: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(200),
  }),
});

platformRouter.post('/companies', (req, res) => {
  const body = createSchema.parse(req.body);
  const id = tx(() => {
    const companyId = run(
      'INSERT INTO companies (name, tax_id, license_plan, license_max_users, license_valid_until) VALUES (?, ?, ?, ?, ?)',
      body.name, body.taxId ?? null, body.plan, body.maxUsers, body.validUntil,
    ).lastInsertRowid;
    run(
      "INSERT INTO users (company_id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, 'ADMIN')",
      companyId, body.admin.email, body.admin.fullName, hashPassword(body.admin.password),
    );
    return companyId;
  });
  res.status(201).json(dto(get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id)!));
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  plan: z.enum(LICENSE_PLANS).optional(),
  maxUsers: z.number().int().min(1).max(10000).optional(),
  validUntil: dateSchema.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

platformRouter.patch('/companies/:id', (req, res) => {
  const id = toId(req.params.id);
  const body = updateSchema.parse(req.body);
  const c = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id);
  if (!c) throw notFound('Company');
  run(
    'UPDATE companies SET name = ?, license_plan = ?, license_max_users = ?, license_valid_until = ?, status = ? WHERE id = ?',
    body.name ?? c.name, body.plan ?? c.license_plan, body.maxUsers ?? c.license_max_users,
    body.validUntil ?? c.license_valid_until, body.status ?? c.status, id,
  );
  res.json(dto(get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id)!));
});
