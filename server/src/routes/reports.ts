import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requirePermission } from '../auth/middleware';
import { changeReport, consumptionReport, dashboard, transactions, workflowReport } from '../services/reports';

export const reportsRouter = Router();
reportsRouter.use(requirePermission('reports.view'));

const year = z.coerce.number().int().min(2000).max(2100);

export const consumptionQuery = z.object({
  year,
  groupBy: z.enum(['unit', 'section', 'costCenter', 'account']).default('unit'),
  parentUnitId: z.coerce.number().int().positive().optional(),
  parentAccountId: z.coerce.number().int().positive().optional(),
  costCenterId: z.coerce.number().int().positive().optional(),
  through: z.coerce.number().int().min(1).max(12).optional(),
});

reportsRouter.get('/consumption', requirePermission('reports.view'), (req, res) => { res.json(consumptionReport(currentUser(req), consumptionQuery.parse(req.query))); });

reportsRouter.get('/transactions', requirePermission('reports.view'), (req, res) => {
  const q = z.object({ year, costCenterId: z.coerce.number().int().positive(), accountId: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json(transactions(currentUser(req), q.year, q.costCenterId, q.accountId));
});

reportsRouter.get('/dashboard', requirePermission('dashboard.view'), (req, res) => { res.json(dashboard(currentUser(req), z.object({ year }).parse(req.query).year)); });
reportsRouter.get('/workflows', requirePermission('reports.view'), (req, res) => { res.json(workflowReport(currentUser(req))); });
reportsRouter.get('/changes', requirePermission('reports.view'), (req, res) => { res.json(changeReport(currentUser(req), z.object({ year }).parse(req.query).year)); });
