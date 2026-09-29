import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ActualEntryDto } from '@finbridge/shared';
import { all, get, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { config } from '../config';
import { badRequest, notFound } from '../lib/errors';
import { costCenterFilter, getScope } from '../lib/scope';
import { findBudgetByYear } from '../services/budgets';
import { assertUploadedFile, importActuals, upsertActual } from '../services/excel';

export const actualsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** Grid of (cost center × account) for one month: every budgeted combination plus anything already booked. */
actualsRouter.get('/', requirePermission('actuals.view'), (req, res) => {
  const companyId = companyIdOf(req);
  const { year, month } = periodSchema.parse(req.query);
  const scope = getScope(currentUser(req));
  const budget = findBudgetByYear(companyId, year);
  const f = costCenterFilter(scope, 'c.id');
  const rows = all<{
    cc_id: number; cc_code: string; cc_name: string; dept_name: string; acc_id: number; acc_code: string; acc_name: string;
    budget: number | null; amount: number | null;
  }>(
    `WITH combos AS (
        SELECT cost_center_id, account_id, SUM(m${month}) AS budget FROM budget_lines WHERE budget_id = ? GROUP BY cost_center_id, account_id
        UNION
        SELECT cost_center_id, account_id, NULL FROM actuals WHERE company_id = ? AND year = ? AND month = ?
     )
     SELECT c.id AS cc_id, c.code AS cc_code, c.name AS cc_name, d.name AS dept_name, a.id AS acc_id, a.code AS acc_code, a.name AS acc_name,
            MAX(x.budget) AS budget,
            (SELECT amount FROM actuals t WHERE t.company_id = ? AND t.year = ? AND t.month = ? AND t.cost_center_id = c.id AND t.account_id = a.id) AS amount
       FROM combos x
       JOIN cost_centers c ON c.id = x.cost_center_id
       JOIN departments d ON d.id = c.department_id
       JOIN accounts a ON a.id = x.account_id
      WHERE 1 = 1${f.sql}
      GROUP BY c.id, a.id
      ORDER BY d.code, c.code, a.code`,
    budget?.id ?? -1, companyId, year, month, companyId, year, month, ...f.params,
  );
  const entries: ActualEntryDto[] = rows.map((r) => ({
    costCenterId: r.cc_id, costCenterCode: r.cc_code, costCenterName: r.cc_name, departmentName: r.dept_name,
    accountId: r.acc_id, accountCode: r.acc_code, accountName: r.acc_name,
    budget: Math.round((r.budget ?? 0) * 100) / 100, amount: r.amount ?? 0,
  }));
  res.json(entries);
});

actualsRouter.get('/months', requirePermission('actuals.view'), (req, res) => {
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  const rows = all<{ month: number; total: number }>(
    'SELECT month, SUM(amount) AS total FROM actuals WHERE company_id = ? AND year = ? GROUP BY month ORDER BY month', companyIdOf(req), year,
  );
  res.json(rows);
});

const saveSchema = periodSchema.extend({
  entries: z.array(z.object({
    costCenterId: z.number().int().positive(),
    accountId: z.number().int().positive(),
    amount: z.number().finite().min(-1e12).max(1e12),
  })).max(5000),
});

actualsRouter.put('/', requirePermission('actuals.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const user = currentUser(req);
  const body = saveSchema.parse(req.body);
  tx(() => {
    for (const e of body.entries) {
      if (!get('SELECT id FROM cost_centers WHERE id = ? AND company_id = ?', e.costCenterId, companyId)) throw notFound('Cost center');
      if (!get('SELECT id FROM accounts WHERE id = ? AND company_id = ?', e.accountId, companyId)) throw notFound('Account');
      upsertActual(companyId, body.year, body.month, e.costCenterId, e.accountId, Math.round(e.amount * 100) / 100, 'manual', user.id);
    }
  });
  res.json({ saved: body.entries.length });
});

actualsRouter.post('/import', requirePermission('actuals.manage', 'excel.import'), upload.single('file'), async (req, res) => {
  const companyId = companyIdOf(req);
  const opts = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  }).parse(req.body ?? {});
  const report = await importActuals(currentUser(req), companyId, opts.year, assertUploadedFile(req.file), opts.dryRun);
  if (!report.dryRun && report.errors.length) throw badRequest('IMPORT_FAILED', 'The file has errors', report);
  res.json(report);
});
