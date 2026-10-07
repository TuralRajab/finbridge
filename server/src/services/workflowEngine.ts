import {
  conditionWeight, configUserIds, evaluateCondition, stepBehaviour,
  type ApproverConfig, type ApproverType, type AssigneeDecision, type Condition, type InboxItemDto, type InstanceStatus, type RuleContext,
  type StepBehaviour, type TaskAction, type WorkflowEntity, type WorkflowInstanceDto, type WorkflowPreviewDto, type WorkflowTaskDto, type WorkflowType,
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

/** Step as frozen into the instance. Behaviour fields are missing in snapshots taken before they existed (→ defaults). */
interface SnapshotStep extends Partial<StepBehaviour> {
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
  returned_from_task_id: number | null;
}

interface AssigneeRow {
  task_id: number; user_id: number; reason: 'RESOLVED' | 'DELEGATE' | 'ESCALATION' | 'FALLBACK'; on_behalf_of_id: number | null;
  decision: AssigneeDecision | null; decided_at: string | null; decided_by: number | null; comment: string | null;
}

/** Assignees whose approval is required in ALL mode (delegates act for them; escalation approvers can decide alone). */
const isRequired = (a: Pick<AssigneeRow, 'reason'>) => a.reason === 'RESOLVED' || a.reason === 'FALLBACK';

const EMPTY_SNAPSHOT: Snapshot = { definitionId: 0, revision: 0, skipSelfApproval: true, steps: [] };
const snapshotOf = (inst: Pick<InstanceRow, 'definition_snapshot'>) => parseJson<Snapshot>(inst.definition_snapshot, EMPTY_SNAPSHOT);
const behaviourOf = (snap: Snapshot, seq: number): StepBehaviour => stepBehaviour(snap.steps.find((s) => s.seq === seq));

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
    .map((s) => ({
      seq: s.seq, name: s.name, approverType: s.approverType, approverConfig: s.approverConfig, slaHours: s.slaHours, escalation: s.escalation,
      ...stepBehaviour(s),
    }));
}

/* ------------------------------------------------------------------ approver resolution */

function activeUsers(companyId: number, ids: (number | null | undefined)[]): number[] {
  const clean = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!clean.length) return [];
  return all<{ id: number }>(`SELECT id FROM users WHERE company_id = ? AND is_active = 1 AND id IN (${clean.map(() => '?').join(',')})`, companyId, ...clean).map((r) => r.id);
}

/** Users by built-in role (identity for the CEO / CFO / Finance approver types and fallbacks). */
function usersWithRole(companyId: number, role: string): number[] {
  return all<{ id: number }>('SELECT id FROM users WHERE company_id = ? AND role = ? AND is_active = 1 ORDER BY id', companyId, role).map((r) => r.id);
}

let hasCompanyRoles: boolean | null = null;
/** Users whose effective role code (company role, else built-in role) matches — used by the ROLE approver type. */
function usersWithEffectiveRole(companyId: number, code: string): number[] {
  if (hasCompanyRoles !== true) {
    hasCompanyRoles = !!get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'company_roles'")
      && all<{ name: string }>('PRAGMA table_info(users)').some((c) => c.name === 'role_id');
    if (!hasCompanyRoles) { hasCompanyRoles = null; return usersWithRole(companyId, code); }
  }
  return all<{ id: number }>(
    `SELECT u.id FROM users u LEFT JOIN company_roles r ON r.id = u.role_id
      WHERE u.company_id = ? AND u.is_active = 1 AND COALESCE(r.code, u.role) = ? ORDER BY u.id`, companyId, code,
  ).map((r) => r.id);
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
    case 'SPECIFIC_USER': return activeUsers(companyId, configUserIds(cfg));
    case 'ROLE': return cfg.role ? usersWithEffectiveRole(companyId, cfg.role) : [];
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

/**
 * Creates the pending task of a step (or a SKIPPED task when only the requester would approve it).
 * `noSkip` is used when a stage is re-activated by a return: it must get a real approver.
 */
function createTask(inst: InstanceRow, step: SnapshotStep, snap: Snapshot, subject: Subject, org: OrgIndex, opts: { noSkip?: boolean; returnedFrom?: number } = {}): 'CREATED' | 'SKIPPED' {
  const ts = nowIso();
  const resolved = resolveApprovers(inst.company_id, step.approverType, step.approverConfig, subject, org);
  let assignees = snap.skipSelfApproval ? resolved.filter((u) => u !== subject.requesterId) : resolved;
  let reason: 'RESOLVED' | 'FALLBACK' = 'RESOLVED';
  if (!assignees.length && resolved.length && !opts.noSkip) {
    const taskId = run(
      `INSERT INTO workflow_tasks (instance_id, seq, step_name, approver_type, status, activated_at, acted_at, comment)
       VALUES (?, ?, ?, ?, 'SKIPPED', ?, ?, ?)`, inst.id, step.seq, step.name, step.approverType, ts, ts, 'Requester is the approver — self-approval skipped',
    ).lastInsertRowid;
    logAction(inst.id, taskId, null, 'AUTO_SKIP', 'PENDING', 'SKIPPED', 'Self-approval skipped');
    return 'SKIPPED';
  }
  if (!assignees.length) {
    // organisation data changed after submission: route to finance so the item never gets stuck
    assignees = usersWithRole(inst.company_id, 'FINANCE_MANAGER').filter((u) => u !== subject.requesterId);
    if (!assignees.length) assignees = usersWithRole(inst.company_id, 'ADMIN').filter((u) => u !== subject.requesterId);
    reason = 'FALLBACK';
  }
  const taskId = run(
    `INSERT INTO workflow_tasks (instance_id, seq, step_name, approver_type, status, activated_at, due_at, returned_from_task_id) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    inst.id, step.seq, step.name, step.approverType, ts, step.slaHours ? addHours(ts, step.slaHours) : null, opts.returnedFrom ?? null,
  ).lastInsertRowid;
  for (const u of assignees) run('INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason) VALUES (?, ?, ?)', taskId, u, reason);
  for (const d of activeDelegations(inst.company_id, assignees, inst.workflow_type)) {
    run("INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason, on_behalf_of_id) VALUES (?, ?, 'DELEGATE', ?)", taskId, d.to, d.from);
  }
  run('UPDATE workflow_instances SET current_seq = ? WHERE id = ?', step.seq, inst.id);
  const b = stepBehaviour(step);
  logAction(inst.id, taskId, null, 'TASK_CREATED', null, 'PENDING', null, {
    step: step.name, assignees, reason, approvalMode: b.approvalMode, ...(opts.returnedFrom ? { returnedFrom: opts.returnedFrom } : {}),
  });
  return 'CREATED';
}

function advance(inst: InstanceRow, afterSeq: number, actorId: number): void {
  const snap = snapshotOf(inst);
  const subject = parseJson<Subject>(inst.subject, { orgUnitId: null, costCenterIds: [], requesterId: inst.started_by });
  const org = OrgIndex.load(inst.company_id);
  for (const step of snap.steps.filter((s) => s.seq > afterSeq).sort((a, b) => a.seq - b.seq)) {
    if (createTask(inst, step, snap, subject, org) === 'CREATED') return;
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

interface Standing {
  /** Assignee rows the user decides on: their own (unless it is a delegate row) and those of the people they act for. */
  rows: AssigneeRow[];
  /** People the user acts for as a delegate. */
  onBehalfOf: number[];
}

/**
 * Whether `userId` may act on the task: an assignee, or an active delegate of an assignee
 * (a delegate counts for the person they act for). Null when the user has no say on the task.
 */
function standingOn(task: Pick<TaskRow, 'id'>, inst: InstanceRow, userId: number, assignees?: AssigneeRow[]): Standing | null {
  const rows = assignees ?? all<AssigneeRow>('SELECT * FROM workflow_task_assignees WHERE task_id = ?', task.id);
  const own = rows.find((r) => r.user_id === userId);
  const principals = new Set<number>();
  if (own?.on_behalf_of_id) principals.add(own.on_behalf_of_id);
  for (const r of rows) if (r.reason === 'DELEGATE' && r.user_id === userId && r.on_behalf_of_id) principals.add(r.on_behalf_of_id);
  const delegable = rows.filter((r) => r.reason !== 'DELEGATE').map((r) => r.user_id);
  for (const d of activeDelegations(inst.company_id, delegable, inst.workflow_type)) if (d.to === userId) principals.add(d.from);
  principals.delete(userId);
  const decideOn = [
    ...(own && own.reason !== 'DELEGATE' ? [own] : []),
    ...rows.filter((r) => principals.has(r.user_id) && r.reason !== 'DELEGATE'),
  ];
  if (!own && !decideOn.length) return null;
  return { rows: decideOn, onBehalfOf: [...principals].filter((p) => rows.some((r) => r.user_id === p)) };
}

/** Rows the user can still decide on (ALL mode: undecided ones). */
const openRows = (st: Standing) => st.rows.filter((r) => !r.decision);

/** The latest approved task of an earlier stage — the target of a "return to previous step". */
function previousApprovedTask(instanceId: number, beforeSeq: number): TaskRow | null {
  return get<TaskRow>("SELECT * FROM workflow_tasks WHERE instance_id = ? AND seq < ? AND status = 'APPROVED' ORDER BY seq DESC, id DESC LIMIT 1", instanceId, beforeSeq) ?? null;
}

export function actOnTask(user: UserRow, taskId: number, action: TaskAction, rawComment?: string | null): InstanceRow {
  const comment = rawComment?.trim() ? rawComment.trim().slice(0, 2000) : null;
  return tx(() => {
    const task = get<TaskRow>('SELECT * FROM workflow_tasks WHERE id = ?', taskId);
    if (!task) throw notFound('Task');
    const inst = loadInstance(task.instance_id);
    if (inst.company_id !== user.company_id) throw notFound('Task');
    if (task.status !== 'PENDING' || inst.status !== 'IN_REVIEW') throw new HttpError(409, 'INVALID_TRANSITION', 'This approval step is no longer pending');
    const assignees = all<AssigneeRow>('SELECT * FROM workflow_task_assignees WHERE task_id = ?', task.id);
    const st = standingOn(task, inst, user.id, assignees);
    if (!st) throw new HttpError(403, 'NOT_ASSIGNEE', 'You are not an approver for this step');
    const snap = snapshotOf(inst);
    const b = behaviourOf(snap, task.seq);
    if (action === 'REJECT' && !b.allowReject) throw badRequest('INVALID_TRANSITION', 'Rejecting is not allowed at this stage');
    if (action === 'RETURN' && !b.allowReturn) throw badRequest('INVALID_TRANSITION', 'Returning is not allowed at this stage');
    if ((action === 'REJECT' || action === 'RETURN' || (action === 'APPROVE' && b.requireCommentOnApprove)) && !comment) {
      throw badRequest('COMMENT_REQUIRED', 'A comment is required');
    }
    const open = openRows(st);
    const ownRow = assignees.find((r) => r.user_id === user.id);
    // escalation approvers (and plain delegates without a principal row) decide for the whole stage
    const decidesAlone = ownRow?.reason === 'ESCALATION' || !st.rows.length;
    if (b.approvalMode === 'ALL' && !open.length && !decidesAlone) throw new HttpError(409, 'INVALID_TRANSITION', 'You have already decided on this step');
    for (const p of st.onBehalfOf) {
      run("INSERT OR IGNORE INTO workflow_task_assignees (task_id, user_id, reason, on_behalf_of_id) VALUES (?, ?, 'DELEGATE', ?)", task.id, user.id, p);
    }
    const ts = nowIso();
    const decision: AssigneeDecision = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'RETURNED';
    const decided = (open.length ? open : st.rows).map((r) => r.user_id);
    if (!decided.length && ownRow) decided.push(user.id);
    for (const u of decided) {
      run('UPDATE workflow_task_assignees SET decision = ?, decided_at = ?, decided_by = ?, comment = ? WHERE task_id = ? AND user_id = ?', decision, ts, user.id, comment, task.id, u);
    }
    const logData: Record<string, unknown> = {};
    if (st.onBehalfOf.length) logData.onBehalfOf = st.onBehalfOf.length === 1 ? st.onBehalfOf[0] : st.onBehalfOf;

    if (action === 'APPROVE' && b.approvalMode === 'ALL' && !decidesAlone) {
      const required = all<AssigneeRow>('SELECT * FROM workflow_task_assignees WHERE task_id = ?', task.id).filter(isRequired);
      const done = required.filter((r) => r.decision === 'APPROVED').length;
      if (done < required.length) {
        logAction(inst.id, task.id, user.id, 'APPROVE', 'PENDING', 'PENDING', comment, { ...logData, partial: true, approvals: done, required: required.length });
        return loadInstance(inst.id);
      }
      logData.approvals = done; logData.required = required.length;
    }

    const status = decision;
    run('UPDATE workflow_tasks SET status = ?, acted_by = ?, acted_at = ?, comment = ? WHERE id = ?', status, user.id, ts, comment, task.id);
    if (action === 'RETURN' && b.returnTo === 'PREVIOUS_STEP') {
      const prev = previousApprovedTask(inst.id, task.seq);
      const prevStep = prev ? snap.steps.find((s) => s.seq === prev.seq) : undefined;
      if (prev && prevStep) {
        logAction(inst.id, task.id, user.id, 'RETURN', 'PENDING', 'RETURNED', comment, { ...logData, returnTo: 'PREVIOUS_STEP', toStep: prevStep.name, toSeq: prevStep.seq });
        const subject = parseJson<Subject>(inst.subject, { orgUnitId: null, costCenterIds: [], requesterId: inst.started_by });
        // later stages are approved again after the previous stage re-approves
        createTask(inst, prevStep, snap, subject, OrgIndex.load(inst.company_id), { noSkip: true, returnedFrom: task.id });
        return loadInstance(inst.id);
      }
      logData.returnTo = 'REQUESTER';
      logData.noPreviousStep = true;
    }
    logAction(inst.id, task.id, user.id, action, 'PENDING', status, comment, Object.keys(logData).length ? logData : undefined);
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
  const snap = snapshotOf(inst);
  // chronological: a return to a previous stage re-activates it as a new task after the returning one
  const tasks = all<TaskRow>('SELECT * FROM workflow_tasks WHERE instance_id = ? ORDER BY id', inst.id);
  const assignees = all<AssigneeRow>(
    `SELECT a.* FROM workflow_task_assignees a JOIN workflow_tasks t ON t.id = a.task_id WHERE t.instance_id = ? ORDER BY a.rowid`, inst.id,
  );
  const actions = all<{ id: number; user_id: number | null; action: string; from_status: string | null; to_status: string | null; comment: string | null; created_at: string }>(
    'SELECT * FROM workflow_actions WHERE instance_id = ? ORDER BY id', inst.id,
  );
  const nm = names([...new Set([
    inst.started_by, ...assignees.flatMap((a) => [a.user_id, a.on_behalf_of_id, a.decided_by]), ...tasks.map((t) => t.acted_by), ...actions.map((a) => a.user_id),
  ].filter((x): x is number => !!x))]);
  const now = nowIso();
  const pending = tasks.find((t) => t.status === 'PENDING');
  const pendingRows = pending ? assignees.filter((a) => a.task_id === pending.id) : [];
  const mine = pending && inst.status === 'IN_REVIEW' ? standingOn(pending, inst, user.id, pendingRows) : null;
  const pendingMode = pending ? behaviourOf(snap, pending.seq).approvalMode : 'ANY';
  const mineOpen = mine ? openRows(mine) : [];
  const decidesAlone = !!mine && (pendingRows.find((r) => r.user_id === user.id)?.reason === 'ESCALATION' || !mine.rows.length);
  const canAct = !!mine && (pendingMode === 'ANY' || decidesAlone || mineOpen.length > 0);
  const myDecision = mine && !canAct ? mine.rows.find((r) => r.decision)?.decision ?? null : null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    id: inst.id, workflowType: inst.workflow_type, definitionName: inst.definition_name, entityType: inst.entity_type, entityId: inst.entity_id,
    status: inst.status, currentSeq: inst.current_seq, startedBy: nm.get(inst.started_by) ?? '—', startedAt: inst.started_at, completedAt: inst.completed_at,
    tasks: tasks.map((t): WorkflowTaskDto => {
      const b = behaviourOf(snap, t.seq);
      const rows = assignees.filter((a) => a.task_id === t.id);
      const required = rows.filter(isRequired);
      const from = t.returned_from_task_id ? byId.get(t.returned_from_task_id) : undefined;
      return {
        id: t.id, seq: t.seq, stepName: t.step_name, approverType: t.approver_type, status: t.status as WorkflowTaskDto['status'],
        assignees: rows.map((a) => ({
          userId: a.user_id, name: nm.get(a.user_id) ?? '—', reason: a.reason,
          onBehalfOf: a.on_behalf_of_id ? nm.get(a.on_behalf_of_id) ?? '—' : null, required: isRequired(a),
          decision: a.decision, decidedAt: a.decided_at, decidedBy: a.decided_by ? nm.get(a.decided_by) ?? '—' : null, decisionComment: a.comment,
        })),
        activatedAt: t.activated_at, dueAt: t.due_at, isOverdue: t.status === 'PENDING' && !!t.due_at && t.due_at < now,
        actedBy: t.acted_by ? nm.get(t.acted_by) ?? '—' : null, actedAt: t.acted_at, comment: t.comment,
        ...b,
        approvalsRequired: b.approvalMode === 'ALL' ? Math.max(required.length, 1) : 1,
        approvalsDone: b.approvalMode === 'ALL'
          ? (t.status === 'APPROVED' ? Math.max(required.length, 1) : required.filter((a) => a.decision === 'APPROVED').length)
          : t.status === 'APPROVED' ? 1 : 0,
        returnedFrom: from ? { taskId: from.id, stepName: from.step_name, by: from.acted_by ? nm.get(from.acted_by) ?? '—' : null, comment: from.comment, at: from.acted_at } : null,
      };
    }),
    actions: actions.map((a) => ({
      id: a.id, action: a.action, userName: a.user_id ? nm.get(a.user_id) ?? '—' : 'FinBridge', fromStatus: a.from_status, toStatus: a.to_status,
      comment: a.comment, createdAt: a.created_at,
    })),
    canAct,
    myTaskId: canAct ? pending!.id : null,
    myDecision,
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
  // committee stages: hide tasks on which the user (or the person they act for) has already decided
  return toInbox(rows.filter((r) => {
    if (behaviourOf(snapshotOf(r), r.seq).approvalMode !== 'ALL') return true;
    const st = standingOn({ id: r.task_id }, r, user.id);
    if (!st) return false;
    const own = get<{ reason: string }>('SELECT reason FROM workflow_task_assignees WHERE task_id = ? AND user_id = ?', r.task_id, user.id);
    return own?.reason === 'ESCALATION' || !st.rows.length || openRows(st).length > 0;
  }));
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
