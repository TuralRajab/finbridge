import { Router } from 'express';
import { z } from 'zod';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { forbidden } from '../lib/errors';
import { toId } from '../lib/params';
import { cancelCr, canViewCr, createCr, crDto, listCrs, loadCr, submitCr, updateCr } from '../services/changeRequests';

export const changesRouter = Router();

const inputSchema = z.object({
  budgetId: z.number().int().positive(),
  costCenterId: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(3).max(2000),
  items: z.array(z.object({ accountId: z.number().int().positive(), month: z.number().int().min(1).max(12), requestedAmount: z.number().finite().min(0).max(1e12) })).min(1).max(200),
});

changesRouter.get('/', (req, res) => {
  const q = z.object({ budgetId: z.coerce.number().int().positive().optional(), year: z.coerce.number().int().optional() }).parse(req.query);
  res.json(listCrs(currentUser(req), q));
});

changesRouter.post('/', requirePermission('change.create'), (req, res) => {
  const user = currentUser(req);
  res.status(201).json(crDto(user, createCr(user, inputSchema.parse(req.body))));
});

changesRouter.get('/:id', (req, res) => {
  const user = currentUser(req);
  const cr = loadCr(companyIdOf(req), toId(req.params.id));
  if (!canViewCr(user, cr)) throw forbidden();
  res.json(crDto(user, cr));
});

changesRouter.put('/:id', requirePermission('change.create'), (req, res) => {
  const user = currentUser(req);
  const cr = loadCr(companyIdOf(req), toId(req.params.id));
  res.json(crDto(user, updateCr(user, cr, inputSchema.parse(req.body))));
});

changesRouter.post('/:id/submit', (req, res) => {
  const user = currentUser(req);
  res.json(crDto(user, submitCr(user, loadCr(companyIdOf(req), toId(req.params.id)))));
});

changesRouter.post('/:id/cancel', (req, res) => {
  const user = currentUser(req);
  const cr = loadCr(companyIdOf(req), toId(req.params.id));
  cancelCr(user, cr, z.object({ comment: z.string().max(2000).nullable().optional() }).parse(req.body ?? {}).comment ?? null);
  res.json(crDto(user, loadCr(cr.company_id, cr.id)));
});
