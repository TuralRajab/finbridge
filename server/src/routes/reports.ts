import { Router } from 'express';
import { z } from 'zod';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { getScope } from '../lib/scope';
import { dashboard, monthlySeries, planVsActual } from '../services/reports';

export const reportsRouter = Router();
reportsRouter.use(requirePermission('reports.view'));

export const pvaQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  through: z.coerce.number().int().min(0).max(12).optional(),
  groupBy: z.enum(['department', 'costCenter', 'account']).default('department'),
  departmentId: z.coerce.number().int().positive().optional(),
  method: z.enum(['budget', 'run_rate']).default('budget'),
});

reportsRouter.get('/plan-vs-actual', (req, res) => {
  const q = pvaQuery.parse(req.query);
  res.json(planVsActual(companyIdOf(req), getScope(currentUser(req)), q.year, q));
});

reportsRouter.get('/monthly', (req, res) => {
  const { year } = z.object({ year: z.coerce.number().int() }).parse(req.query);
  res.json(monthlySeries(companyIdOf(req), getScope(currentUser(req)), year));
});

reportsRouter.get('/dashboard', (req, res) => {
  const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query);
  res.json(dashboard(companyIdOf(req), getScope(currentUser(req)), year));
});
