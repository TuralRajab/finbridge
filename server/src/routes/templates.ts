import { Router } from 'express';
import { z } from 'zod';
import { get, run } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { notFound } from '../lib/errors';
import { applyTemplate, getTemplate, listTemplates } from '../services/templates';

export const templatesRouter = Router();

templatesRouter.get('/', requirePermission('masterdata.view'), (_req, res) => { res.json(listTemplates()); });
templatesRouter.get('/:code', requirePermission('masterdata.view'), (req, res) => { res.json(getTemplate(String(req.params.code))); });

const applySchema = z.object({
  company: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    taxId: z.string().trim().max(20).nullable().optional(),
    baseCurrency: z.string().length(3).optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  }).optional(),
  industryCode: z.string().min(2).max(40),
  accounts: z.boolean().default(true),
  excludedAccountCodes: z.array(z.string()).default([]),
  structure: z.boolean().default(true),
  costCenters: z.boolean().default(true),
  workflows: z.boolean().default(true),
  language: z.enum(['az', 'en']).default('az'),
});

/** Company setup wizard: company info → industry → review → apply (merge). */
templatesRouter.post('/apply', requirePermission('templates.apply'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = applySchema.parse(req.body);
  getTemplate(b.industryCode);
  if (b.company) {
    const c = get<{ name: string; tax_id: string | null; base_currency: string; fiscal_year_start_month: number }>('SELECT * FROM companies WHERE id = ?', companyId);
    if (!c) throw notFound('Company');
    const hasBudgets = !!get('SELECT 1 FROM budgets WHERE company_id = ? LIMIT 1', companyId);
    run('UPDATE companies SET name = ?, tax_id = ?, base_currency = ?, fiscal_year_start_month = ? WHERE id = ?',
      b.company.name ?? c.name, b.company.taxId !== undefined ? b.company.taxId : c.tax_id,
      hasBudgets ? c.base_currency : b.company.baseCurrency ?? c.base_currency, b.company.fiscalYearStartMonth ?? c.fiscal_year_start_month, companyId);
    if (b.company.name) run('UPDATE org_units SET name = ? WHERE company_id = ? AND parent_id IS NULL', b.company.name, companyId);
  }
  res.json(applyTemplate(companyId, currentUser(req).id, b.industryCode, b));
});
