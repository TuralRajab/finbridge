import { Router } from 'express';
import { z } from 'zod';
import { APPROVAL_MODES, APPROVER_TYPES, CONDITION_FIELDS, CONDITION_OPS, RETURN_TARGETS, TASK_ACTIONS, VERSION_KINDS, WORKFLOW_TYPES, type Condition, type DelegationDto, type RuleContext } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toId } from '../lib/params';
import { userCan } from '../lib/permissions';
import { getDefinition, listDefinitions, saveDefinition } from '../services/workflowDefinitions';
import { actOnTask, cancelInstance, inbox, instanceDto, isParticipant, previewWorkflow, processEscalations } from '../services/workflowEngine';
import { OrgIndex } from '../services/org';
import { AccountIndex } from '../services/accounts';

export const workflowsRouter = Router();

const approverConfig = z.object({
  userId: z.number().int().positive().optional(), userIds: z.array(z.number().int().positive()).max(50).optional(),
  role: z.string().trim().min(1).max(64).optional(), unitTypeCode: z.string().optional(),
  jobFamilyId: z.number().int().positive().optional(), jobFamilyCode: z.string().optional(),
  positionId: z.number().int().positive().optional(), positionCode: z.string().optional(),
}).default({});

const rule = z.object({ field: z.enum(CONDITION_FIELDS), op: z.enum(CONDITION_OPS), value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]) });
const condition: z.ZodType<Condition> = z.lazy(() => z.union([
  rule, z.object({ all: z.array(condition) }), z.object({ any: z.array(condition) }), z.object({ not: condition }),
])) as z.ZodType<Condition>;

const defSchema = z.object({
  name: z.string().trim().min(2).max(160),
  workflowType: z.enum(WORKFLOW_TYPES),
  description: z.string().trim().max(1000).nullable().default(null),
  priority: z.number().int().min(0).max(10000).default(100),
  conditions: condition.nullable().default(null),
  skipSelfApproval: z.boolean().default(true),
  isActive: z.boolean().default(true),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  steps: z.array(z.object({
    seq: z.number().int().optional().default(0),
    name: z.string().trim().min(1).max(120),
    approverType: z.enum(APPROVER_TYPES),
    approverConfig: approverConfig,
    condition: condition.nullable().default(null),
    slaHours: z.number().int().min(1).max(8760).nullable().default(null),
    escalation: z.object({ approverType: z.enum(APPROVER_TYPES), config: approverConfig }).nullable().default(null),
    // stage behaviour — defaults keep the classic "one approval, reject / return to requester" behaviour
    approvalMode: z.enum(APPROVAL_MODES).default('ANY'),
    allowReject: z.boolean().default(true),
    allowReturn: z.boolean().default(true),
    returnTo: z.enum(RETURN_TARGETS).default('REQUESTER'),
    requireCommentOnApprove: z.boolean().default(false),
    instructions: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  })).min(1).max(20),
});

workflowsRouter.get('/meta', (_req, res) => {
  res.json({ workflowTypes: WORKFLOW_TYPES, approverTypes: APPROVER_TYPES, conditionFields: CONDITION_FIELDS, conditionOps: CONDITION_OPS, approvalModes: APPROVAL_MODES, returnTargets: RETURN_TARGETS });
});

workflowsRouter.get('/definitions', requirePermission('masterdata.view'), (req, res) => { res.json(listDefinitions(companyIdOf(req))); });
workflowsRouter.get('/definitions/:id', requirePermission('masterdata.view'), (req, res) => { res.json(getDefinition(companyIdOf(req), toId(req.params.id))); });

workflowsRouter.post('/definitions', requirePermission('workflow.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = saveDefinition(companyId, currentUser(req).id, null, defSchema.parse(req.body) as Parameters<typeof saveDefinition>[3]);
  res.status(201).json(getDefinition(companyId, id));
});

workflowsRouter.put('/definitions/:id', requirePermission('workflow.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = saveDefinition(companyId, currentUser(req).id, toId(req.params.id), defSchema.parse(req.body) as Parameters<typeof saveDefinition>[3]);
  res.json(getDefinition(companyId, id));
});

workflowsRouter.post('/definitions/:id/clone', requirePermission('workflow.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const d = getDefinition(companyId, toId(req.params.id));
  const id = saveDefinition(companyId, currentUser(req).id, null, { ...d, name: `${d.name} (kopya)`, isActive: false });
  res.status(201).json(getDefinition(companyId, id));
});

workflowsRouter.patch('/definitions/:id/active', requirePermission('workflow.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const id = toId(req.params.id);
  if (!run('UPDATE workflow_definitions SET is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?', +isActive, nowIso(), id, companyId).changes) throw notFound('Workflow');
  audit(companyId, currentUser(req).id, 'WORKFLOW_DEFINITION', id, isActive ? 'ACTIVATED' : 'DEACTIVATED', null);
  res.json(getDefinition(companyId, id));
});

/** Builder test run: which definition and approvers a sample item would get. */
workflowsRouter.post('/preview', requirePermission('masterdata.view'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = z.object({
    workflowType: z.enum(WORKFLOW_TYPES), definitionId: z.number().int().positive().optional(),
    amount: z.number().default(0), costCenterId: z.number().int().positive().optional(), orgUnitId: z.number().int().positive().optional(),
    accountId: z.number().int().positive().optional(), requestType: z.enum(['PURCHASE', 'EXPENSE']).optional(),
    budgetKind: z.enum(VERSION_KINDS).optional(),
  }).parse(req.body);
  const org = OrgIndex.load(companyId);
  const unitId = b.costCenterId ? org.cc(b.costCenterId).orgUnitId : b.orgUnitId ?? org.root().id;
  const ctx: RuleContext = {
    ...org.ruleContextForUnit(unitId), amount: b.amount, requestType: b.requestType ?? null, budgetKind: b.budgetKind ?? null,
    costCenter: b.costCenterId ? [org.cc(b.costCenterId).code] : [],
    ...(b.accountId ? AccountIndex.load(companyId).ruleContext(b.accountId) : {}),
    industry: get<{ industry_code: string | null }>('SELECT industry_code FROM companies WHERE id = ?', companyId)?.industry_code ?? null,
  };
  res.json(previewWorkflow(companyId, b.workflowType, ctx, { orgUnitId: unitId, costCenterIds: b.costCenterId ? [b.costCenterId] : [], requesterId: currentUser(req).id }, b.definitionId));
});

/* ------------------------------------------------------------------ tasks & instances */

workflowsRouter.get('/inbox', (req, res) => { res.json(inbox(currentUser(req))); });

workflowsRouter.get('/instances/:id', (req, res) => {
  const user = currentUser(req);
  const id = toId(req.params.id);
  if (!userCan(user, 'budget.view') && !userCan(user, 'audit.view') && !isParticipant(user.id, id)) throw forbidden();
  res.json(instanceDto(user, id));
});

workflowsRouter.post('/tasks/:id/act', (req, res) => {
  const user = currentUser(req);
  const b = z.object({ action: z.enum(TASK_ACTIONS), comment: z.string().max(2000).nullable().optional() }).parse(req.body);
  const inst = actOnTask(user, toId(req.params.id), b.action, b.comment);
  res.json(instanceDto(user, inst.id));
});

workflowsRouter.post('/instances/:id/cancel', (req, res) => {
  const user = currentUser(req);
  cancelInstance(user, toId(req.params.id), z.object({ comment: z.string().max(2000).nullable().optional() }).parse(req.body ?? {}).comment);
  res.json(instanceDto(user, toId(req.params.id)));
});

workflowsRouter.post('/escalations/run', requirePermission('workflow.manage'), (req, res) => {
  res.json({ escalated: processEscalations(companyIdOf(req)) });
});

/* ------------------------------------------------------------------ delegations */

function delegations(companyId: number, userId?: number): DelegationDto[] {
  return all<{ id: number; from_user_id: number; f: string; to_user_id: number; t: string; workflow_type: DelegationDto['workflowType']; valid_from: string; valid_to: string; reason: string | null; is_active: number }>(
    `SELECT d.*, a.full_name AS f, b.full_name AS t FROM user_delegations d JOIN users a ON a.id = d.from_user_id JOIN users b ON b.id = d.to_user_id
      WHERE d.company_id = ?${userId ? ' AND (d.from_user_id = ? OR d.to_user_id = ?)' : ''} ORDER BY d.valid_from DESC`,
    companyId, ...(userId ? [userId, userId] : []),
  ).map((d) => ({ id: d.id, fromUserId: d.from_user_id, fromName: d.f, toUserId: d.to_user_id, toName: d.t, workflowType: d.workflow_type, validFrom: d.valid_from, validTo: d.valid_to, reason: d.reason, isActive: d.is_active === 1 }));
}

workflowsRouter.get('/delegations', (req, res) => {
  const user = currentUser(req);
  res.json(delegations(companyIdOf(req), userCan(user, 'users.manage') || userCan(user, 'workflow.manage') ? undefined : user.id));
});

const delSchema = z.object({
  fromUserId: z.number().int().positive().optional(), toUserId: z.number().int().positive(), workflowType: z.enum(WORKFLOW_TYPES).nullable().default(null),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(300).nullable().optional(),
});

workflowsRouter.post('/delegations', (req, res) => {
  const user = currentUser(req);
  const companyId = companyIdOf(req);
  const b = delSchema.parse(req.body);
  const from = b.fromUserId ?? user.id;
  if (from !== user.id && !userCan(user, 'users.manage')) throw forbidden('You can only delegate your own approvals');
  if (from === b.toUserId) throw badRequest('VALIDATION_ERROR', 'Choose another user');
  if (b.validTo < b.validFrom) throw badRequest('VALIDATION_ERROR', 'End date is before start date');
  for (const u of [from, b.toUserId]) if (!get('SELECT 1 FROM users WHERE id = ? AND company_id = ? AND is_active = 1', u, companyId)) throw notFound('User');
  const id = run(`INSERT INTO user_delegations (company_id, from_user_id, to_user_id, workflow_type, valid_from, valid_to, reason, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, companyId, from, b.toUserId, b.workflowType, b.validFrom, b.validTo, b.reason ?? null, user.id, nowIso()).lastInsertRowid;
  audit(companyId, user.id, 'DELEGATION', id, 'CREATED', { ...b, fromUserId: from });
  res.status(201).json(delegations(companyId).find((d) => d.id === id));
});

workflowsRouter.delete('/delegations/:id', (req, res) => {
  const user = currentUser(req);
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const d = get<{ from_user_id: number }>('SELECT from_user_id FROM user_delegations WHERE id = ? AND company_id = ?', id, companyId);
  if (!d) throw notFound('Delegation');
  if (d.from_user_id !== user.id && !userCan(user, 'users.manage')) throw forbidden();
  run('UPDATE user_delegations SET is_active = 0 WHERE id = ?', id);
  audit(companyId, user.id, 'DELEGATION', id, 'REVOKED', null);
  res.status(204).end();
});
