import {
  conditionWeight, evaluateCondition,
  type ApproverConfig, type ApproverType, type Condition, type InboxItemDto, type InstanceStatus, type RuleContext, type TaskAction,
  type WorkflowEntity, type WorkflowInstanceDto, type WorkflowPreviewDto, type WorkflowType,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { addHours, nowIso, today } from '../lib/clock';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors';
import { parseJson } from '../lib/json';
import type { UserRow } from '../lib/mappers';
import { OrgIndex } from './org';
import { stepDto, type DefinitionRow, type StepRow } from './workflowDefinitions';

/* ------------------------------------------------------------------ types */

export interface Subject {
  /** Org unit the item belongs to (section unit, or the cost center's unit). */
  orgUnitId: number | null;
  costCenterIds: number[];
  requesterId: number;
}

interface SnapshotStep {
  seq: number;
  name: string;
  approverType: ApproverType;
  approverConfig: ApproverConfig;
  slaHours: number | null;
  escalation: { approverType: ApproverType; config: ApproverConfig } | null;
}

interface Snapshot { definitionId: number; revision: number; skipSelfApproval: boolean; steps: SnapshotStep[] }

export interface InstanceRow {
  id: number; company_id: number; definition_id: number | null; definition_name: string; definition_snapshot: string;
  workflow_type: WorkflowType; entity_type: WorkflowEntity; entity_id: number; subject: string; context: string;
  status: InstanceStatus; current_seq: number | null; started_by: number; started_at: string; completed_at: string | null;
}

interface TaskRow {
  id: number; instance_id: number; seq: number; step_name: string; approver_type: ApproverType; status: string;
  activated_at: string | null; due_at: string | null; escalated_at: string | null; acted_by: number | null; acted_at: string | null; comment: string | null;
}

export interface EntitySummary { title: string; subtitle: string; amount: number | null; currency: string | null; link: string }

export interface EntityHandler {
  onApproved(inst: InstanceRow, actorId: number): void;
  onRejected(inst: InstanceRow, actorId: number, comment: string | null): void;
  onReturned(inst: InstanceRow, actorId: number, comment: string | null): void;
  onCancelled(inst: InstanceRow, actorId: number): void;
  describe(companyId: number, entityId: number): EntitySummary;
  /** Users who may see the entity regardless of workflow assignment (e.g. requester); scope is checked elsewhere. */
}

const handlers = new Map<WorkflowEntity, EntityHandler>();
export function registerHandler(entity: WorkflowEntity, h: EntityHandler): void {
  handlers.set(entity, h);
}
function handler(entity: WorkflowEntity): EntityHandler {
  const h = handlers.get(entity);
  if (!h) throw new Error(`No workflow handler registered for ${entity}`);
  return h;
}

/* ------------------------------------------------------------------ definition selection */

function isEffective(d: DefinitionRow, day: string): boolean {
  return (!d.effective_from || d.effective_from <= day) && (!d.effective_to || d.effective_to >= day);
}

/** Active, effective definition of the type whose conditions match; lowest priority wins, then the most specific. */
export function selectDefinition(companyId: number, type: WorkflowType, ctx: RuleContext): DefinitionRow | null {
  const day = today();
  const candidates = all<DefinitionRow>('SELECT * FROM workflow_definitions WHERE company_id = ? AND workflow_type = ? AND is_active = 1', companyId, type)
    .filter((d) => isEffective(d, day) && evaluateCondition(parseJson<Condition | null>(d.conditions, null), ctx))
    .sort((a, b) => a.priority - b.priority
      || conditionWeight(parseJson<Condition | null>(b.conditions, null)) - conditionWeight(parseJson<Condition | null>(a.conditions, null))
      || a.id - b.id);
  return candidates[0] ?? null;
}

function applicableSteps(definitionId: number, ctx: RuleContext): SnapshotStep[] {
  return all<StepRow>('SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY seq', definitionId)
    .map(stepDto)
    .filter((s) => evaluateCondition(s.condition, ctx))
    .map((s) => ({ seq: s.seq, name: s.name, approverType: s.approverType, approverConfig: s.approverConfig, slaHours: s.slaHours, escalation: s.escalation }));
}

/* ------------------------------------------------------------------ approver resolution */

function activeUsers(companyId: number, ids: (number | null | undefined)[]): number[] {
  const clean = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!clean.length) return [];
  return all<{ id: number }>(`SELECT id FROM users WHERE company_id = ? AND is_active = 1 AND id IN (${clean.map(() => '?').join(',')})`, companyId, ...clean).map((r) => r.id);
}

function usersWithRole(companyId: number, role: string): number[] {
  return all<{ id: number }>('SELECT id FROM users WHERE company_id = ? AND role = ? AND is_active = 1 ORDER BY id', companyId, role).map((r) => r.id);
}

/** Resolves who must approve a step, dynamically, from the current organisation data. */
export function resolveApprovers(companyId: number, type: ApproverType, cfg: ApproverConfig, subject: Subject, org: OrgIndex): number[] {
  const unitId = subject.orgUnitId;
  const headOf = (pick: (chain: ReturnType<OrgIndex['ancestors']>) => number | null | undefined) =>
    unitId && org.units.has(unitId) ? activeUsers(companyId, [pick(org.ancestors(unitId))]) : [];
  const ccs = subject.costCenterIds.length
    ? subject.costCenterIds.map((id) => org.costCenters.get(id)).filter(Boolean)
    : unitId && org.units.has(unitId) ? org.ccsInSubtree(unitId) : [];

  switch (type) {
    case 'SPECIFIC_USER': return activeUsers(companyId, [cfg.userId]);
    case 'ROLE': return cfg.role ? usersWithRole(companyId, cfg.role) : [];
    case 'CEO': return usersWithRole(companyId, 'CEO');
    case 'CFO': return usersWithRole(companyId, 'CFO');
    case 'FINANCE_MANAGER': return usersWithRole(companyId, 'FINANCE_MANAGER');
    case 'DEPARTMENT_HEAD': {
      const code = cfg.unitTypeCode ?? 'DEPARTMENT';
      return headOf((chain) => chain.find((u) => u.typeCode === code && u.headUserId)?.headUserId ?? chain.find((u) => u.headUserId)?.headUserId);
    }
    case 'ORG_UNIT_OWNER': return headOf((chain) => chain.find((u) => u.headUserId)?.headUserId);
    case 'EXECUTIVE': return unitId && org.units.has(unitId) ? activeUsers(companyId, [org.topLevel(unitId).headUserId]) : [];
    case 'COST_CENTER_OWNER': return activeUsers(companyId, ccs.map((c) => c!.ownerUserId));
    case 'COST_CENTER_RESPONSIBLE': return activeUsers(companyId, ccs.map((c) => c!.responsibleUserId ?? c!.ownerUserId));
    case 'JOB_FAMILY_OWNER': {
      const jf = cfg.jobFamilyId
        ? get<{ owner_user_id: number | null }>('SELECT owner_user_id FROM job_families WHERE id = ? AND company_id = ?', cfg.jobFamilyId, companyId)
        : cfg.jobFamilyCode
          ? get<{ owner_user_id: number | null }>('SELECT owner_user_id FROM job_families WHERE code = ? AND company_id = ?', cfg.jobFamilyCode, companyId)
          : get<{ owner_user_id: number | null }>('SELECT j.owner_user_id FROM users u JOIN job_families j ON j.id = u.job_family_id WHERE u.id = ?', subject.requesterId);
      return activeUsers(companyId, [jf?.owner_user_id]);
    }
    case 'POSITION_HOLDER': {
      const p = cfg.positionId
        ? get<{ holder_user_id: number | null }>('SELECT holder_user_id FROM positions WHERE id = ? AND company_id = ?', cfg.positionId, companyId)
        : get<{ holder_user_id: number | null }>('SELECT holder_user_id FROM positions WHERE code = ? AND company_id = ?', cfg.positionCode ?? '', companyId);
      return activeUsers(companyId, [p?.holder_user_id]);
    }
    case 'DYNAMIC_MANAGER': {
      const m = get<{ manager_id: number | null }>('SELECT manager_id FROM users WHERE id = ?', subject.requesterId);
      return activeUsers(companyId, [m?.manager_id]);
    }
    default: return [];
  }
}

function activeDelegations(companyId: number, fromIds: number[], type: WorkflowType): { from: number; to: number }[] {
  if (!fromIds.length) return [];
  const day = today();
  return all<{ from_user_id: number; to_user_id: number }>(
    `SELECT d.from_user_id, d.to_user_id FROM user_delegations d JOIN users u ON u.id = d.to_user_id AND u.is_active = 1
      WHERE d.company_id = ? AND d.is_active = 1 AND d.valid_from <= ? AND d.valid_to >= ? AND (d.workflow_type IS NULL OR d.workflow_type = ?)
        AND d.from_user_id IN (${fromIds.map(() => '?').join(',')})`,
    companyId, day, day, type, ...fromIds,
  ).map((r) => ({ from: r.from_user_id, to: r.to_user_id }));
}

/* ------------------------------------------------------------------ engine */

function logAction(instanceId: number, taskId: number | null, userId: number | null, action: string, from: string | null, to: string | null, comment: string | null, data?: unknown): void {
  run('INSERT INTO workflow_actions (instance_id, task_id, user_id, action, from_status, to_status, comment, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    instanceId, taskId, userId, action, from, to, comment, data === undefined ? null : JSON.stringify(data), nowIso());
}

function loadInstance(id: number): InstanceRow {
  const i = get<InstanceRow>('SELECT * FROM workflow_instances WHERE id = ?', id);
  if (!i) throw notFound('Workflow instance');
  return i;
}

export interface StartParams {
  companyId: number;
  type: WorkflowType;
  entityType: WorkflowEntity;
  entityId: number;
  subject: Subject;
  context: RuleContext;
}

/** Starts the matching workflow. Fails fast if no definition matches or a step has no resolvable approver. */
export function startWorkflow(p: StartParams): InstanceRow {
  return tx(() => {
    const def = selectDefinition(p.companyId, p.type, p.context);
    if (!def) throw new HttpError(409, 'NO_WORKFLOW', `No active ${p.type} workflow matches this item. Configure one under Workflows.`);
    const steps = applicableSteps(def.id, p.context);
    const org = OrgIndex.load(p.companyId);
    for (const s of steps) {
      const approvers = resolveApprovers(p.companyId, s.approverType, s.approverConfig, p.subject, org);
      if (!approvers.length) {
        throw new HttpError(409, 'NO_APPROVER', `Step "${s.name}": no approver could be determined (${s.approverType}). Assign the responsible person in the organisation setup.`);
      }
    }
    const snapshot: Snapshot = { definitionId: def.id, revision: def.revision, skipSelfApproval: def.skip_self_approval === 1, steps };
    const ts = nowIso();
    const id = run(
      `INSERT INTO workflow_instances (company_id, definition_id, definition_name, definition_snapshot, workflow_type, entity_type, entity_id,
         subject, context, status, started_by, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_REVIEW', ?, ?)`,
      p.companyId, def.id, def.name, JSON.stringify(snapshot), p.type, p.entityType, p.entityId, JSON.stringify(p.subject),
      JSON.stringify(p.context), p.subject.requesterId, ts,
    ).lastInsertRowid;
    logAction(id, null, p.subject.requesterId, 'SUBMIT', null, 'IN_REVIEW', null, { definition: def.name, revision: def.revision, steps: steps.map((s) => s.name) });
    advance(loadInstance(id), 0, p.subject.requesterId);
    return loadInstance(id);
  });
}

function advance(inst: InstanceRow, afterSeq: number, actorId: number): void {
  const snap = parseJson<Snapshot>(inst.definition_snapshot, { definitionId: 0, revision: 0, skipSelfApproval: true, steps: [] });
  const subject = parseJson<Subject>(inst.subject, { orgUnitId: null, costCenterIds: [], requesterId: inst.started_by });
  const org = OrgIndex.load(inst.company_id);
  for (const step of snap.steps.filter((s) => s.seq > afterSeq).sort((a, b) => a.seq - b.seq)) {
    const ts = nowIso();
    const resolved = resolveApprovers(inst.company_id, step.approverType, step.approverConfig, subject, org);
    let assignees = snap.skipSelfApproval ? resolved.filter((u) => u !== subject.requesterId) : resolved;
    let reason: 'RESOLVED' | 'FALLBACK' = 'RESOLVED';
    if (!assignees.length && resolved.length) {
      const taskId = run(
        `INSERT INTO workflow_tasks (instance_id, seq, step_name, approver_type, status, activated_at, acted_at, comment)
         VALUES (?, ?, ?, ?, 'SKIPPED', ?, ?, ?)`, inst.id, step.seq, step.name, step.approverType, ts, ts, 'Requester is the approver — self-approval skipped',
      ).lastInsertRowid;
      logAction(inst.id, taskId, null, 'AUTO_SKIP', 'PENDING', 'SKIPPED', 'Self-approval skipped');
      continue;
    }
    if (!assignees.length) {
      // organisation data changed after submission: route to finance so the item never gets stuck
      assignees = usersWithRole(inst.company_id, 'FINANCE_MANAGER').filter((u) => u !== subject.requesterId);
      if (!assignees.length) assignees = usersWithRole(inst.company_id, 'ADMIN').filter((u) => u !== subject.requesterId);
      reason = 'FALLBACK';
    }
    const taskId = run(
      `INSERT INTO workflow_tasks (instance_id, seq, step_name, approver_type, status, activated_at, due_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      inst.id, step.seq, step.name, step.approverType, ts, step.slaHours ? addHours(ts, step.slaHours) : null,
    ).lastInsertRowid;
    for (const u of assignees) run('INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason) VALUES (?, ?, ?)', taskId, u, reason);
    for (const d of activeDelegations(inst.company_id, assignees, inst.workflow_type)) {
      run("INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason, on_behalf_of_id) VALUES (?, ?, 'DELEGATE', ?)", taskId, d.to, d.from);
    }
    run('UPDATE workflow_instances SET current_seq = ? WHERE id = ?', step.seq, inst.id);
    logAction(inst.id, taskId, null, 'TASK_CREATED', null, 'PENDING', null, { step: step.name, assignees, reason });
    return;
  }
  complete(inst, 'APPROVED', actorId, null);
}

function complete(inst: InstanceRow, status: InstanceStatus, actorId: number, comment: string | null): void {
  const ts = nowIso();
  run("UPDATE workflow_tasks SET status = 'CANCELLED', acted_at = ? WHERE instance_id = ? AND status = 'PENDING'", ts, inst.id);
  run('UPDATE workflow_instances SET status = ?, completed_at = ?, current_seq = NULL WHERE id = ?', status, ts, inst.id);
  logAction(inst.id, null, actorId, status, 'IN_REVIEW', status, comment);
  const fresh = loadInstance(inst.id);
  const h = handler(inst.entity_type);
  if (status === 'APPROVED') h.onApproved(fresh, actorId);
  else if (status === 'REJECTED') h.onRejected(fresh, actorId, comment);
  else if (status === 'RETURNED') h.onReturned(fresh, actorId, comment);
  else if (status === 'CANCELLED') h.onCancelled(fresh, actorId);
}

/** Whether `userId` may act on the task: an assignee, or an active delegate of an assignee. */
function assigneeFor(task: TaskRow, inst: InstanceRow, userId: number): { onBehalfOf: number | null } | null {
  const direct = get<{ on_behalf_of_id: number | null }>('SELECT on_behalf_of_id FROM workflow_task_assignees WHERE task_id = ? AND user_id = ?', task.id, userId);
  if (direct) return { onBehalfOf: direct.on_behalf_of_id };
  const assignees = all<{ user_id: number }>('SELECT user_id FROM workflow_task_assignees WHERE task_id = ?', task.id).map((r) => r.user_id);
  const d = activeDelegations(inst.company_id, assignees, inst.workflow_type).find((x) => x.to === userId);
  return d ? { onBehalfOf: d.from } : null;
}

export function actOnTask(user: UserRow, taskId: number, action: TaskAction, rawComment?: string | null): InstanceRow {
  const comment = rawComment?.trim() ? rawComment.trim().slice(0, 2000) : null;
  return tx(() => {
    const task = get<TaskRow>('SELECT * FROM workflow_tasks WHERE id = ?', taskId);
    if (!task) throw notFound('Task');
    const inst = loadInstance(task.instance_id);
    if (inst.company_id !== user.company_id) throw notFound('Task');
    if (task.status !== 'PENDING' || inst.status !== 'IN_REVIEW') throw new HttpError(409, 'INVALID_TRANSITION', 'This approval step is no longer pending');
    const who = assigneeFor(task, inst, user.id);
    if (!who) throw new HttpError(403, 'NOT_ASSIGNEE', 'You are not an approver for this step');
    if ((action === 'REJECT' || action === 'RETURN') && !comment) throw badRequest('COMMENT_REQUIRED', 'A comment is required');
    if (who.onBehalfOf) run("INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason, on_behalf_of_id) VALUES (?, ?, 'DELEGATE', ?)", task.id, user.id, who.onBehalfOf);
    const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'RETURNED';
    run('UPDATE workflow_tasks SET status = ?, acted_by = ?, acted_at = ?, comment = ? WHERE id = ?', status, user.id, nowIso(), comment, task.id);
    logAction(inst.id, task.id, user.id, action, 'PENDING', status, comment, who.onBehalfOf ? { onBehalfOf: who.onBehalfOf } : undefined);
    if (action === 'APPROVE') advance(inst, task.seq, user.id);
    else complete(inst, action === 'REJECT' ? 'REJECTED' : 'RETURNED', user.id, comment);
    return loadInstance(inst.id);
  });
}

export function cancelInstance(user: UserRow, instanceId: number, comment?: string | null): void {
  tx(() => {
    const inst = loadInstance(instanceId);
    if (inst.company_id !== user.company_id) throw notFound('Workflow instance');
    if (inst.status !== 'IN_REVIEW') throw new HttpError(409, 'INVALID_TRANSITION', 'Only running workflows can be cancelled');
    if (inst.started_by !== user.id) throw forbidden('Only the requester can cancel');
    complete(inst, 'CANCELLED', user.id, comment?.trim() || null);
  });
}

/** Adds escalation approvers to overdue tasks whose step defines an escalation. Idempotent per task. */
export function processEscalations(companyId?: number): number {
  const ts = nowIso();
  const overdue = all<TaskRow & { company_id: number; definition_snapshot: string; subject: string; workflow_type: WorkflowType }>(
    `SELECT t.*, i.company_id, i.definition_snapshot, i.subject, i.workflow_type FROM workflow_tasks t JOIN workflow_instances i ON i.id = t.instance_id
      WHERE t.status = 'PENDING' AND t.due_at IS NOT NULL AND t.due_at < ? AND t.escalated_at IS NULL AND i.status = 'IN_REVIEW'${companyId ? ' AND i.company_id = ?' : ''}`,
    ...(companyId ? [ts, companyId] : [ts]),
  );
  let n = 0;
  for (const t of overdue) {
    const step = parseJson<Snapshot>(t.definition_snapshot, { definitionId: 0, revision: 0, skipSelfApproval: true, steps: [] }).steps.find((s) => s.seq === t.seq);
    tx(() => {
      run('UPDATE workflow_tasks SET escalated_at = ? WHERE id = ?', ts, t.id);
      if (!step?.escalation) { logAction(t.instance_id, t.id, null, 'OVERDUE', 'PENDING', 'PENDING', 'SLA exceeded'); return; }
      const subject = parseJson<Subject>(t.subject, { orgUnitId: null, costCenterIds: [], requesterId: 0 });
      const extra = resolveApprovers(t.company_id, step.escalation.approverType, step.escalation.config ?? {}, subject, OrgIndex.load(t.company_id))
        .filter((u) => u !== subject.requesterId);
      for (const u of extra) run("INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason) VALUES (?, ?, 'ESCALATION')", t.id, u);
      logAction(t.instance_id, t.id, null, 'ESCALATE', 'PENDING', 'PENDING', 'SLA exceeded', { escalatedTo: extra, approverType: step.escalation.approverType });
      n++;
    });
  }
  return n;
}

/* ------------------------------------------------------------------ read models */

function names(ids: number[]): Map<number, string> {
  if (!ids.length) return new Map();
  return new Map(all<{ id: number; full_name: string }>(`SELECT id, full_name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map((u) => [u.id, u.full_name]));
}

export function isParticipant(userId: number, instanceId: number): boolean {
  return !!get('SELECT 1 FROM workflow_tasks t JOIN workflow_task_assignees a ON a.task_id = t.id WHERE t.instance_id = ? AND a.user_id = ? LIMIT 1', instanceId, userId)
    || !!get('SELECT 1 FROM workflow_instances WHERE id = ? AND started_by = ?', instanceId, userId);
}

export function instanceDto(user: UserRow, instanceId: number): WorkflowInstanceDto {
  const inst = loadInstance(instanceId);
  if (inst.company_id !== user.company_id) throw notFound('Workflow instance');
  const tasks = all<TaskRow>('SELECT * FROM workflow_tasks WHERE instance_id = ? ORDER BY seq, id', inst.id);
  const assignees = all<{ task_id: number; user_id: number; reason: string }>(
    `SELECT a.* FROM workflow_task_assignees a JOIN workflow_tasks t ON t.id = a.task_id WHERE t.instance_id = ?`, inst.id,
  );
  const actions = all<{ id: number; user_id: number | null; action: string; from_status: string | null; to_status: string | null; comment: string | null; created_at: string }>(
    'SELECT * FROM workflow_actions WHERE instance_id = ? ORDER BY id', inst.id,
  );
  const nm = names([...new Set([inst.started_by, ...assignees.map((a) => a.user_id), ...tasks.map((t) => t.acted_by), ...actions.map((a) => a.user_id)].filter((x): x is number => !!x))]);
  const now = nowIso();
  const pending = tasks.find((t) => t.status === 'PENDING');
  const mine = pending && inst.status === 'IN_REVIEW' ? assigneeFor(pending, inst, user.id) : null;
  return {
    id: inst.id, workflowType: inst.workflow_type, definitionName: inst.definition_name, entityType: inst.entity_type, entityId: inst.entity_id,
    status: inst.status, currentSeq: inst.current_seq, startedBy: nm.get(inst.started_by) ?? '—', startedAt: inst.started_at, completedAt: inst.completed_at,
    tasks: tasks.map((t) => ({
      id: t.id, seq: t.seq, stepName: t.step_name, approverType: t.approver_type, status: t.status as WorkflowInstanceDto['tasks'][number]['status'],
      assignees: assignees.filter((a) => a.task_id === t.id).map((a) => ({ userId: a.user_id, name: nm.get(a.user_id) ?? '—', reason: a.reason })),
      activatedAt: t.activated_at, dueAt: t.due_at, isOverdue: t.status === 'PENDING' && !!t.due_at && t.due_at < now,
      actedBy: t.acted_by ? nm.get(t.acted_by) ?? '—' : null, actedAt: t.acted_at, comment: t.comment,
    })),
    actions: actions.map((a) => ({
      id: a.id, action: a.action, userName: a.user_id ? nm.get(a.user_id) ?? '—' : 'FinBridge', fromStatus: a.from_status, toStatus: a.to_status,
      comment: a.comment, createdAt: a.created_at,
    })),
    canAct: !!mine,
    myTaskId: mine ? pending!.id : null,
    canCancel: inst.status === 'IN_REVIEW' && inst.started_by === user.id,
  };
}

export function latestInstanceFor(companyId: number, entityType: WorkflowEntity, entityId: number): number | null {
  return get<{ id: number }>('SELECT id FROM workflow_instances WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1', companyId, entityType, entityId)?.id ?? null;
}

function toInbox(rows: (TaskRow & InstanceRow & { task_id: number; instance_id: number })[]): InboxItemDto[] {
  const now = nowIso();
  const starters = names([...new Set(rows.map((r) => r.started_by))]);
  return rows.map((r) => {
    const s = handler(r.entity_type).describe(r.company_id, r.entity_id);
    return {
      taskId: r.task_id, instanceId: r.instance_id, workflowType: r.workflow_type, entityType: r.entity_type, entityId: r.entity_id,
      title: s.title, subtitle: s.subtitle, amount: s.amount, currency: s.currency, stepName: r.step_name,
      requestedBy: starters.get(r.started_by) ?? '—', activatedAt: r.activated_at, dueAt: r.due_at,
      isOverdue: !!r.due_at && r.due_at < now, link: s.link,
    };
  });
}

const PENDING_SQL = `SELECT t.*, i.*, t.id AS task_id, i.id AS instance_id FROM workflow_tasks t JOIN workflow_instances i ON i.id = t.instance_id
                      WHERE t.status = 'PENDING' AND i.status = 'IN_REVIEW' AND i.company_id = ?`;

/** Pending approvals of the user (directly assigned or via an active delegation). */
export function inbox(user: UserRow): InboxItemDto[] {
  if (!user.company_id) return [];
  const day = today();
  const rows = all<TaskRow & InstanceRow & { task_id: number; instance_id: number }>(
    `${PENDING_SQL} AND (EXISTS (SELECT 1 FROM workflow_task_assignees a WHERE a.task_id = t.id AND a.user_id = ?)
       OR EXISTS (SELECT 1 FROM workflow_task_assignees a JOIN user_delegations d ON d.from_user_id = a.user_id
                   WHERE a.task_id = t.id AND d.to_user_id = ? AND d.is_active = 1 AND d.valid_from <= ? AND d.valid_to >= ?
                     AND (d.workflow_type IS NULL OR d.workflow_type = i.workflow_type)))
     ORDER BY t.due_at IS NULL, t.due_at, t.activated_at`,
    user.company_id, user.id, user.id, day, day,
  );
  return toInbox(rows);
}

export function allPending(companyId: number): InboxItemDto[] {
  return toInbox(all<TaskRow & InstanceRow & { task_id: number; instance_id: number }>(`${PENDING_SQL} ORDER BY t.due_at IS NULL, t.due_at`, companyId));
}

/** Dry run for the workflow builder: which definition and which approvers would be used. */
export function previewWorkflow(companyId: number, type: WorkflowType, ctx: RuleContext, subject: Subject, definitionId?: number): WorkflowPreviewDto {
  const def = definitionId
    ? get<DefinitionRow>('SELECT * FROM workflow_definitions WHERE id = ? AND company_id = ?', definitionId, companyId) ?? null
    : selectDefinition(companyId, type, ctx);
  if (!def) return { definition: null, steps: [] };
  const org = OrgIndex.load(companyId);
  const steps = all<StepRow>('SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY seq', def.id).map(stepDto);
  return {
    definition: { id: def.id, name: def.name },
    steps: steps.map((s) => {
      const included = evaluateCondition(s.condition, ctx);
      const ids = included ? resolveApprovers(companyId, s.approverType, s.approverConfig, subject, org) : [];
      const nm = names(ids);
      return {
        seq: s.seq, name: s.name, approverType: s.approverType, included, approvers: ids.map((i) => nm.get(i) ?? String(i)),
        note: !included ? 'condition not met' : !ids.length ? 'no approver resolved' : null,
      };
    }),
  };
}
