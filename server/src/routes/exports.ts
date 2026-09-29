import { Router, type Request } from 'express';
import { z } from 'zod';
import { MONTH_SHORT, type Lang } from '@finbridge/shared';
import { all } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { toId } from '../lib/params';
import { costCenterFilter, getScope } from '../lib/scope';
import { listLines, loadBudget, MONTH_COLS } from '../services/budgets';
import { actualsTemplate, budgetTemplate, buildWorkbook, headers, monthColumns, sendWorkbook } from '../services/excel';
import { listAccounts, listCostCenters, listDepartments } from './masterdata';
import { planVsActual } from '../services/reports';
import { pvaQuery } from './reports';

/** Every table in FinBridge can be exported back to Excel. */
export const exportsRouter = Router();
exportsRouter.use(requirePermission('excel.export'));

function langOf(req: Request): Lang {
  const q = String(req.query.lang ?? '');
  if (q === 'az' || q === 'en') return q;
  return currentUser(req).language;
}

const stamp = () => new Date().toISOString().slice(0, 10);

exportsRouter.get('/budget/:id', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const lines = listLines(currentUser(req), b);
  const rows = lines.map((l) => ({
    departmentName: l.departmentName, costCenterCode: l.costCenterCode, costCenterName: l.costCenterName,
    accountCode: l.accountCode, accountName: l.accountName, accountType: l.accountType, description: l.description,
    ...Object.fromEntries(l.months.map((m, i) => [`m${i + 1}`, m])), total: l.total,
  }));
  const totals: Record<string, unknown> = { departmentName: h.total, total: lines.reduce((s, l) => s + l.total, 0) };
  MONTH_COLS.forEach((m, i) => { totals[m] = lines.reduce((s, l) => s + l.months[i], 0); });
  const buf = await buildWorkbook([{
    name: `${h.budget} ${b.year}`,
    columns: [
      { header: h.departmentName, key: 'departmentName', width: 18 },
      { header: h.costCenterCode, key: 'costCenterCode', width: 14 },
      { header: h.costCenterName, key: 'costCenterName', width: 22 },
      { header: h.accountCode, key: 'accountCode', width: 12 },
      { header: h.accountName, key: 'accountName', width: 24 },
      { header: h.accountType, key: 'accountType', width: 9 },
      { header: h.description, key: 'description', width: 26 },
      ...monthColumns(lang),
      { header: h.total, key: 'total', money: true, width: 15 },
    ],
    rows, totals,
  }]);
  sendWorkbook(res, `finbridge-budget-${b.year}-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/plan-vs-actual', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const q = pvaQuery.parse(req.query);
  const data = planVsActual(companyIdOf(req), getScope(currentUser(req)), q.year, q);
  const period = data.throughMonth ? `${MONTH_SHORT[lang][0]}–${MONTH_SHORT[lang][data.throughMonth - 1]}` : '—';
  const nameHeader = q.groupBy === 'department' ? h.departmentName : q.groupBy === 'costCenter' ? h.costCenterName : h.accountName;
  const buf = await buildWorkbook([{
    name: `${q.year} ${period}`,
    columns: [
      { header: h.code, key: 'code', width: 12 },
      { header: nameHeader, key: 'name', width: 26 },
      ...(q.groupBy === 'costCenter' ? [{ header: h.departmentName, key: 'parentName', width: 18 }] : []),
      { header: h.annualBudget, key: 'annualBudget', money: true, width: 15 },
      { header: `${h.budgetYtd} ${period}`, key: 'budgetYtd', money: true, width: 17 },
      { header: `${h.actualYtd} ${period}`, key: 'actualYtd', money: true, width: 17 },
      { header: h.variance, key: 'variance', money: true, width: 14 },
      { header: h.variancePct, key: 'variancePct', percent: true, width: 10 },
      { header: h.forecast, key: 'forecast', money: true, width: 15 },
    ],
    rows: data.rows as unknown as Record<string, unknown>[],
    totals: { name: h.total, ...data.totals },
  }]);
  sendWorkbook(res, `finbridge-plan-vs-actual-${q.year}-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/actuals', async (req, res) => {
  const lang = langOf(req);
  const h = headers(lang);
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  const companyId = companyIdOf(req);
  const f = costCenterFilter(getScope(currentUser(req)), 'c.id');
  const rows = all<Record<string, unknown> & { month: number; amount: number; key: string }>(
    `SELECT d.name AS departmentName, c.code AS costCenterCode, c.name AS costCenterName, a.code AS accountCode, a.name AS accountName,
            x.month, x.amount
       FROM actuals x JOIN cost_centers c ON c.id = x.cost_center_id JOIN departments d ON d.id = c.department_id JOIN accounts a ON a.id = x.account_id
      WHERE x.company_id = ? AND x.year = ?${f.sql}
      ORDER BY d.code, c.code, a.code, x.month`,
    companyId, year, ...f.params,
  );
  const wide = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.costCenterCode}|${r.accountCode}`;
    const w = wide.get(key) ?? { departmentName: r.departmentName, costCenterCode: r.costCenterCode, costCenterName: r.costCenterName, accountCode: r.accountCode, accountName: r.accountName, total: 0 };
    w[`m${r.month}`] = r.amount;
    w.total = Number(w.total) + r.amount;
    wide.set(key, w);
  }
  const buf = await buildWorkbook([{
    name: `${lang === 'az' ? 'Fakt' : 'Actuals'} ${year}`,
    columns: [
      { header: h.departmentName, key: 'departmentName', width: 18 },
      { header: h.costCenterCode, key: 'costCenterCode', width: 14 },
      { header: h.costCenterName, key: 'costCenterName', width: 22 },
      { header: h.accountCode, key: 'accountCode', width: 12 },
      { header: h.accountName, key: 'accountName', width: 24 },
      ...monthColumns(lang),
      { header: h.total, key: 'total', money: true, width: 15 },
    ],
    rows: [...wide.values()],
  }]);
  sendWorkbook(res, `finbridge-actuals-${year}-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/departments', async (req, res) => {
  const h = headers(langOf(req));
  const buf = await buildWorkbook([{
    name: h.departmentName,
    columns: [{ header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 28 }, { header: h.manager, key: 'managerName', width: 24 }, { header: h.active, key: 'active', width: 8 }],
    rows: listDepartments(companyIdOf(req)).map((d) => ({ ...d, active: d.isActive ? '✓' : '' })),
  }]);
  sendWorkbook(res, `finbridge-departments-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/cost-centers', async (req, res) => {
  const h = headers(langOf(req));
  const buf = await buildWorkbook([{
    name: h.costCenterName,
    columns: [
      { header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 28 },
      { header: h.departmentName, key: 'departmentName', width: 20 }, { header: h.owner, key: 'ownerName', width: 24 }, { header: h.active, key: 'active', width: 8 },
    ],
    rows: listCostCenters(companyIdOf(req)).map((c) => ({ ...c, active: c.isActive ? '✓' : '' })),
  }]);
  sendWorkbook(res, `finbridge-cost-centers-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/accounts', async (req, res) => {
  const h = headers(langOf(req));
  const buf = await buildWorkbook([{
    name: h.accountName,
    columns: [{ header: h.code, key: 'code', width: 12 }, { header: h.name, key: 'name', width: 30 }, { header: h.accountType, key: 'type', width: 10 }, { header: h.active, key: 'active', width: 8 }],
    rows: listAccounts(companyIdOf(req)).map((a) => ({ ...a, active: a.isActive ? '✓' : '' })),
  }]);
  sendWorkbook(res, `finbridge-accounts-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/users', requirePermission('users.manage'), async (req, res) => {
  const h = headers(langOf(req));
  const rows = all<{ full_name: string; email: string; role: string; is_active: number; dept: string | null }>(
    'SELECT u.full_name, u.email, u.role, u.is_active, d.name AS dept FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.company_id = ? ORDER BY u.full_name',
    companyIdOf(req),
  );
  const buf = await buildWorkbook([{
    name: 'Users',
    columns: [
      { header: h.fullName, key: 'full_name', width: 24 }, { header: h.email, key: 'email', width: 28 },
      { header: h.role, key: 'role', width: 20 }, { header: h.departmentName, key: 'dept', width: 18 }, { header: h.active, key: 'active', width: 8 },
    ],
    rows: rows.map((r) => ({ ...r, active: r.is_active ? '✓' : '' })),
  }]);
  sendWorkbook(res, `finbridge-users-${stamp()}.xlsx`, buf);
});

exportsRouter.get('/templates/budget', requirePermission('excel.import'), async (req, res) => {
  sendWorkbook(res, 'finbridge-budget-template.xlsx', await budgetTemplate(companyIdOf(req), langOf(req)));
});

exportsRouter.get('/templates/actuals', requirePermission('excel.import'), async (req, res) => {
  sendWorkbook(res, 'finbridge-actuals-template.xlsx', await actualsTemplate(companyIdOf(req), langOf(req)));
});
