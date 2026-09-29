import { Router } from 'express';
import { z } from 'zod';
import { get, run } from '../db/database';
import { companyIdOf, requirePermission } from '../auth/middleware';
import type { CompanyRow } from '../lib/license';
import { toCompanyDto } from '../lib/mappers';

export const companyRouter = Router();

companyRouter.get('/', (req, res) => {
  const c = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyIdOf(req))!;
  res.json(toCompanyDto(c));
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  taxId: z.string().trim().max(20).nullable().optional(),
});

companyRouter.patch('/', requirePermission('company.manage'), (req, res) => {
  const id = companyIdOf(req);
  const body = updateSchema.parse(req.body);
  run('UPDATE companies SET name = ?, tax_id = ? WHERE id = ?', body.name, body.taxId ?? null, id);
  res.json(toCompanyDto(get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id)!));
});
