import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Lang } from '@finbridge/shared';
import { all } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { toId } from '../lib/params';
import { listLines, loadBudget, MONTH_COLS } from '../services/budgets';
import { actualsTemplate, budgetTemplate, buildWorkbook, headers, monthColumns, sendWorkbook } from '../services/excel';
import { consumptionReport, changeReport } from '../services/reports';
import { listAccounts, listCostCenters } from './masterdata';
import { listUnits } from './org';
import { listPrs } from '../services/purchaseRequests';
import { consumptionQuery } from './reports';
import { costCenterFilter, getScope } from '../lib/scope';

/** Every table in FinBridge can be exported back to Excel (scoped to what the user may see). */
export const exportsRouter = Router();
exportsRouter.use(requirePermission('excel.export'));

const langOf = (req: Request): Lang => (req.query.lang === 'en' || req.query.lang === 'az' ? req.query.lang : currentUser(req).language);
const stamp = () => new Date().toISOString().slice(0, 10);

exportsRouter.get('/budget/:id', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  const versionId = req.query.versionId ? toId(req.query.versionId) : null;
  const lines = listLines(currentUser(req), budget, versionId);
  const totals: Record<string, unknown> = { section: h.total, total: lines.reduce((s, l) => s + l.total, 0) };
  MONTH_COLS.forEach((m, i) => { totals[m] = lines.reduce((s, l) => s + l.months[i], 0); });
  sendWorkbook(res, `finbridge-budget-${budget.fiscal_year}-${stamp()}.xlsx`, await buildWorkbook([{
    name: `${h.budget} ${budget.fiscal_year}`,
    columns: [
      { header: h.section, key: 'section', width: 20 }, { header: h.costCenterCode, key: 'costCenterCode', width: 12 }, { header: h.costCenterName, key: 'costCenterName', width: 24 },
      { header: h.accountCode, key: 'accountCode', width: 10 }, { header: h.accountName, key: 'accountName', width: 30 }, { header: h.expenseClass, key: 'expenseClass', width: 10 },
      { header: h.description, key: 'description', width: 24 }, ...monthColumns(lang), { header: h.total, key: 'total', money: true, width: 15 },
    ],
    rows: lines.map((l) => ({ section: l.sectionName, costCenterCode: l.costCenterCode, costCenterName: l.costCenterName, accountCode: l.accountCode, accountName: l.accountName, expenseClass: l.expenseClass, description: l.description, ...Object.fromEntries(l.months.map((m, i) => [`m${i + 1}`, m])), total: l.total })),
    totals,
  }]));
});

exportsRouter.get('/consumption', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const q = consumptionQuery.parse(req.query);
  const data = consumptionReport(currentUser(req), q);
  const money = (key: string, header: string) => ({ header, key, money: true, width: 15 });
  sendWorkbook(res, `finbridge-consumption-${q.year}-${stamp()}.xlsx`, await buildWorkbook([{
    name: `${q.year}`,
    columns: [
      { header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 30 }, { header: h.section, key: 'parentName', width: 20 },
      money('annualBudget', h.annualBudget), money('budget', h.budget), money('originalBudget', h.originalBudget), money('pending', h.pending), money('committed', h.committed),
      money('actual', h.actual), money('available', h.available), money('variance', h.variance), { header: h.variancePct, key: 'variancePct', percent: true, width: 10 },
      { header: h.consumptionPct, key: 'consumptionPct', percent: true, width: 12 }, money('forecast', h.forecast),
    ],
    rows: data.rows as unknown as Record<string, unknown>[],
    totals: { name: h.total, ...data.totals },
  }]));
});

exportsRouter.get('/actuals', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  const f = costCenterFilter(getScope(currentUser(req)), 'x.cost_center_id');
  const rows = all<{ cc: string; cc_name: string; acc: string; acc_name: string; month: number; amount: number; source: string }>(
    `SELECT c.code AS cc, c.name AS cc_name, a.code AS acc, a.name AS acc_name, x.month, x.amount, x.source FROM actuals x
       JOIN cost_centers c ON c.id = x.cost_center_id JOIN accounts a ON a.id = x.account_id WHERE x.company_id = ? AND x.fiscal_year = ?${f.sql} ORDER BY c.code, a.code, x.month`,
    companyIdOf(req), year, ...f.params,
  );
  const wide = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const k = `${r.cc}|${r.acc}`;
    const w = wide.get(k) ?? { costCenterCode: r.cc, costCenterName: r.cc_name, accountCode: r.acc, accountName: r.acc_name, total: 0 };
    w[`m${r.month}`] = Number(w[`m${r.month}`] ?? 0) + r.amount;
    w.total = Number(w.total) + r.amount;
    wide.set(k, w);
  }
  sendWorkbook(res, `finbridge-actuals-${year}-${stamp()}.xlsx`, await buildWorkbook([{
    name: `${h.actual} ${year}`,
    columns: [{ header: h.costCenterCode, key: 'costCenterCode', width: 12 }, { header: h.costCenterName, key: 'costCenterName', width: 24 }, { header: h.accountCode, key: 'accountCode', width: 10 }, { header: h.accountName, key: 'accountName', width: 30 }, ...monthColumns(lang), { header: h.total, key: 'total', money: true, width: 15 }],
    rows: [...wide.values()],
  }]));
});

exportsRouter.get('/requests', async (req, res) => {
  const h = headers(langOf(req));
  const { year } = z.object({ year: z.coerce.number().int().optional() }).parse(req.query);
  const rows = listPrs(currentUser(req), { year });
  sendWorkbook(res, `finbridge-requests-${stamp()}.xlsx`, await buildWorkbook([{
    name: 'PR',
    columns: [
      { header: '#', key: 'number', width: 16 }, { header: h.name, key: 'title', width: 30 }, { header: h.costCenterCode, key: 'costCenterCode', width: 12 },
      { header: h.accountCode, key: 'accountCode', width: 10 }, { header: h.month, key: 'month', width: 6 }, { header: h.amount, key: 'amount', money: true },
      { header: 'CCY', key: 'currency', width: 6 }, { header: `${h.amount} (base)`, key: 'amountBase', money: true }, { header: h.status, key: 'status', width: 14 },
      { header: h.fullName, key: 'requestedBy', width: 22 },
    ],
    rows: rows as unknown as Record<string, unknown>[],
  }]));
});

exportsRouter.get('/changes', async (req, res) => {
  const h = headers(langOf(req));
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  sendWorkbook(res, `finbridge-budget-changes-${year}-${stamp()}.xlsx`, await buildWorkbook([{
    name: 'BCR',
    columns: [
      { header: '#', key: 'number', width: 16 }, { header: h.costCenterName, key: 'costCenter', width: 26 }, { header: h.name, key: 'title', width: 30 },
      { header: h.description, key: 'reason', width: 40 }, { header: h.originalBudget, key: 'original', money: true }, { header: h.variance, key: 'change', money: true },
      { header: h.budget, key: 'revised', money: true }, { header: h.status, key: 'status', width: 14 }, { header: h.fullName, key: 'requestedBy', width: 22 },
    ],
    rows: changeReport(currentUser(req), year) as unknown as Record<string, unknown>[],
  }]));
});

exportsRouter.get('/org-units', async (req, res) => {
  const h = headers(langOf(req));
  sendWorkbook(res, `finbridge-org-structure-${stamp()}.xlsx`, await buildWorkbook([{
    name: h.orgUnit,
    columns: [{ header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 30 }, { header: 'Type', key: 'typeName', width: 16 }, { header: 'Path', key: 'pathText', width: 50 }, { header: h.manager, key: 'headName', width: 22 }, { header: h.active, key: 'active', width: 8 }],
    rows: listUnits(companyIdOf(req)).map((u) => ({ ...u, pathText: u.path.join(' › '), active: u.isActive ? '✓' : '' })),
  }]));
});

exportsRouter.get('/cost-centers', async (req, res) => {
  const h = headers(langOf(req));
  sendWorkbook(res, `finbridge-cost-centers-${stamp()}.xlsx`, await buildWorkbook([{
    name: h.costCenterName,
    columns: [{ header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 28 }, { header: h.orgUnit, key: 'orgUnitName', width: 22 }, { header: h.section, key: 'sectionName', width: 20 }, { header: h.owner, key: 'ownerName', width: 22 }, { header: h.manager, key: 'responsibleName', width: 22 }, { header: 'CCY', key: 'currency', width: 6 }, { header: h.active, key: 'active', width: 8 }],
    rows: listCostCenters(companyIdOf(req)).map((c) => ({ ...c, active: c.isActive ? '✓' : '' })),
  }]));
});

exportsRouter.get('/accounts', async (req, res) => {
  const h = headers(langOf(req));
  const accs = listAccounts(companyIdOf(req));
  const byId = new Map(accs.map((a) => [a.id, a.code]));
  sendWorkbook(res, `finbridge-chart-of-accounts-${stamp()}.xlsx`, await buildWorkbook([{
    name: h.accountName,
    columns: [{ header: h.code, key: 'code', width: 12 }, { header: h.parentCode, key: 'parent', width: 12 }, { header: h.name, key: 'indented', width: 44 }, { header: h.accountType, key: 'accountType', width: 10 }, { header: h.expenseClass, key: 'expenseClass', width: 10 }, { header: h.category, key: 'category', width: 18 }, { header: h.active, key: 'active', width: 8 }],
    rows: accs.map((a) => ({ ...a, parent: a.parentId ? byId.get(a.parentId) : '', indented: `${'  '.repeat(a.level)}${a.name}`, active: a.isActive ? '✓' : '' })),
  }]));
});

exportsRouter.get('/users', requirePermission('users.manage'), async (req, res) => {
  const h = headers(langOf(req));
  const rows = all<{ full_name: string; email: string; role: string; is_active: number; unit: string | null; job_title: string | null }>(
    'SELECT u.full_name, u.email, u.role, u.is_active, o.name AS unit, u.job_title FROM users u LEFT JOIN org_units o ON o.id = u.org_unit_id WHERE u.company_id = ? ORDER BY u.full_name', companyIdOf(req),
  );
  sendWorkbook(res, `finbridge-users-${stamp()}.xlsx`, await buildWorkbook([{
    name: 'Users',
    columns: [{ header: h.fullName, key: 'full_name', width: 24 }, { header: h.email, key: 'email', width: 28 }, { header: h.role, key: 'role', width: 20 }, { header: h.orgUnit, key: 'unit', width: 22 }, { header: 'Title', key: 'job_title', width: 22 }, { header: h.active, key: 'active', width: 8 }],
    rows: rows.map((r) => ({ ...r, active: r.is_active ? '✓' : '' })),
  }]));
});

exportsRouter.get('/templates/budget', requirePermission('excel.import'), async (req, res) => {
  sendWorkbook(res, 'finbridge-budget-template.xlsx', await budgetTemplate(companyIdOf(req), langOf(req)));
});

exportsRouter.get('/templates/actuals', requirePermission('excel.import'), async (req, res) => {
  const { year } = z.object({ year: z.coerce.number().int().default(new Date().getFullYear()) }).parse(req.query);
  sendWorkbook(res, 'finbridge-actuals-template.xlsx', await actualsTemplate(companyIdOf(req), year, langOf(req)));
});
