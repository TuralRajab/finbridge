import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ActualEntryDto } from '@finbridge/shared';
import { all, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { config } from '../config';
import { badRequest } from '../lib/errors';
import { parseJson } from '../lib/json';
import { costCenterFilter, getScope } from '../lib/scope';
import { AccountIndex } from '../services/accounts';
import { findBudgetByYear } from '../services/budgets';
import { assertUploadedFile, importActuals, upsertActualCell } from '../services/excel';
import { OrgIndex } from '../services/org';

export const actualsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });
const period = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) });

/** Month grid: every budgeted cost center × account plus anything already booked. */
actualsRouter.get('/', requirePermission('actuals.view'), (req, res) => {
  const companyId = companyIdOf(req);
  const { year, month } = period.parse(req.query);
  const org = OrgIndex.load(companyId);
  const accs = AccountIndex.load(companyId);
  const scope = getScope(currentUser(req), org);
  const budget = findBudgetByYear(companyId, year);
  const f = costCenterFilter(scope, 'x.cost_center_id');
  const rows = all<{ cost_center_id: number; account_id: number; budget: number | null; manual: number | null; from_requests: number | null }>(
    `WITH combos AS (
        SELECT cost_center_id, account_id FROM budget_lines WHERE version_id = ?
        UNION SELECT cost_center_id, account_id FROM actuals WHERE company_id = ? AND fiscal_year = ? AND month = ?
     )
     SELECT x.cost_center_id, x.account_id,
            (SELECT SUM(m${month}) FROM budget_lines b WHERE b.version_id = ? AND b.cost_center_id = x.cost_center_id AND b.account_id = x.account_id) AS budget,
            (SELECT amount FROM actuals a WHERE a.company_id = ? AND a.fiscal_year = ? AND a.month = ? AND a.cost_center_id = x.cost_center_id AND a.account_id = x.account_id AND a.purchase_request_id IS NULL) AS manual,
            (SELECT SUM(amount) FROM actuals a WHERE a.company_id = ? AND a.fiscal_year = ? AND a.month = ? AND a.cost_center_id = x.cost_center_id AND a.account_id = x.account_id AND a.purchase_request_id IS NOT NULL) AS from_requests
       FROM combos x WHERE 1 = 1${f.sql}`,
    budget?.current_version_id ?? -1, companyId, year, month, budget?.current_version_id ?? -1, companyId, year, month, companyId, year, month, ...f.params,
  );
  const out: ActualEntryDto[] = rows.filter((r) => org.costCenters.has(r.cost_center_id) && accs.accounts.has(r.account_id)).map((r) => {
    const cc = org.cc(r.cost_center_id);
    const a = accs.get(r.account_id);
    return {
      costCenterId: cc.id, costCenterCode: cc.code, costCenterName: cc.name, sectionName: org.sectionOfCostCenter(cc.id).name,
      accountId: a.id, accountCode: a.code, accountName: a.name, budget: Math.round((r.budget ?? 0) * 100) / 100,
      amount: r.manual ?? 0, fromRequests: Math.round((r.from_requests ?? 0) * 100) / 100,
    };
  }).sort((x, y) => x.costCenterCode.localeCompare(y.costCenterCode) || x.accountCode.localeCompare(y.accountCode));
  res.json(out);
});

actualsRouter.get('/months', requirePermission('actuals.view'), (req, res) => {
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  res.json(all<{ month: number; total: number }>('SELECT month, SUM(amount) AS total FROM actuals WHERE company_id = ? AND fiscal_year = ? GROUP BY month ORDER BY month', companyIdOf(req), year));
});

actualsRouter.put('/', requirePermission('actuals.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const user = currentUser(req);
  const b = period.extend({
    entries: z.array(z.object({ costCenterId: z.number().int().positive(), accountId: z.number().int().positive(), amount: z.number().finite().min(-1e12).max(1e12) })).max(5000),
  }).parse(req.body);
  const org = OrgIndex.load(companyId);
  const accs = AccountIndex.load(companyId);
  tx(() => {
    for (const e of b.entries) {
      org.cc(e.costCenterId);
      if (accs.get(e.accountId).isGroup) throw badRequest('ACCOUNT_NOT_ALLOWED', 'Actuals cannot be booked on group accounts');
      upsertActualCell(companyId, b.year, b.month, e.costCenterId, e.accountId, Math.round(e.amount * 100) / 100, 'MANUAL', user.id);
    }
  });
  res.json({ saved: b.entries.length });
});

actualsRouter.post('/import', requirePermission('actuals.manage', 'excel.import'), upload.single('file'), async (req, res) => {
  const o = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    mapping: z.string().optional(),
  }).parse(req.body ?? {});
  const report = await importActuals(currentUser(req), companyIdOf(req), o.year, assertUploadedFile(req.file), {
    dryRun: o.dryRun, mapping: o.mapping ? parseJson(o.mapping, undefined) : undefined, fileName: req.file!.originalname,
  });
  if (!report.dryRun && report.errors.length) throw badRequest('IMPORT_FAILED', 'The file has errors', report);
  res.json(report);
});
