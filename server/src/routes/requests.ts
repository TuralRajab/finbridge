import { Router } from 'express';
import { z } from 'zod';
import { REQUEST_TYPES, toBase } from '@finbridge/shared';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { forbidden } from '../lib/errors';
import { toId } from '../lib/params';
import { getScope } from '../lib/scope';
import { checkBudget } from '../services/consumption';
import { rateFor } from '../services/currency';
import { cancelPr, canViewPr, createPr, listPrs, loadPr, prDto, recordPrActual, submitPr, updatePr } from '../services/purchaseRequests';

export const requestsRouter = Router();

const inputSchema = z.object({
  requestType: z.enum(REQUEST_TYPES).default('PURCHASE'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  vendor: z.string().trim().max(200).nullable().default(null),
  costCenterId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  fiscalYear: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amount: z.number().positive().max(1e12),
  currency: z.string().length(3).default('AZN'),
});

requestsRouter.get('/', requirePermission('requests.view'), (req, res) => {
  const q = z.object({ year: z.coerce.number().int().optional(), status: z.string().optional(), mine: z.enum(['1', 'true']).optional() }).parse(req.query);
  res.json(listPrs(currentUser(req), { year: q.year, status: q.status, mine: !!q.mine }));
});

/** Live funds check for the request form. */
requestsRouter.post('/budget-check', requirePermission('request.create'), (req, res) => {
  const user = currentUser(req);
  const b = z.object({
    costCenterId: z.number().int().positive(), accountId: z.number().int().positive(), fiscalYear: z.number().int(), month: z.number().int().min(1).max(12),
    amount: z.number().min(0), currency: z.string().length(3).default('AZN'), excludeRequestId: z.number().int().positive().optional(),
  }).parse(req.body);
  const scope = getScope(user);
  if (!scope.all && !scope.requestCostCenterIds.has(b.costCenterId)) throw forbidden();
  const amountBase = toBase(b.amount, rateFor(user.company_id!, b.currency));
  res.json(checkBudget(user.company_id!, b.costCenterId, b.accountId, b.fiscalYear, b.month, amountBase, b.excludeRequestId));
});

requestsRouter.post('/', requirePermission('request.create'), (req, res) => {
  const user = currentUser(req);
  res.status(201).json(prDto(user, createPr(user, inputSchema.parse(req.body))));
});

requestsRouter.get('/:id', (req, res) => {
  const user = currentUser(req);
  const pr = loadPr(companyIdOf(req), toId(req.params.id));
  if (!canViewPr(user, pr, getScope(user))) throw forbidden();
  res.json(prDto(user, pr));
});

requestsRouter.put('/:id', requirePermission('request.create'), (req, res) => {
  const user = currentUser(req);
  res.json(prDto(user, updatePr(user, loadPr(companyIdOf(req), toId(req.params.id)), inputSchema.parse(req.body))));
});

requestsRouter.post('/:id/submit', (req, res) => {
  const user = currentUser(req);
  res.json(prDto(user, submitPr(user, loadPr(companyIdOf(req), toId(req.params.id)))));
});

requestsRouter.post('/:id/cancel', (req, res) => {
  const user = currentUser(req);
  const pr = loadPr(companyIdOf(req), toId(req.params.id));
  cancelPr(user, pr, z.object({ comment: z.string().max(2000).nullable().optional() }).parse(req.body ?? {}).comment ?? null);
  res.json(prDto(user, loadPr(pr.company_id, pr.id)));
});

requestsRouter.post('/:id/actuals', requirePermission('actuals.manage'), (req, res) => {
  const user = currentUser(req);
  const pr = loadPr(companyIdOf(req), toId(req.params.id));
  recordPrActual(user, pr, z.object({
    amount: z.number().min(0).max(1e12), month: z.number().int().min(1).max(12), description: z.string().max(300).nullable().default(null), close: z.boolean().default(false),
  }).parse(req.body));
  res.json(prDto(user, loadPr(pr.company_id, pr.id)));
});
