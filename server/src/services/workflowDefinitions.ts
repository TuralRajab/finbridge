import {
  APPROVER_TYPES, WORKFLOW_TYPES, ROLES, configUserIds, stepBehaviour,
  type ApproverConfig, type Condition, type StepBehaviour, type WorkflowDefinitionDto, type WorkflowStepDto, type WorkflowType,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, notFound } from '../lib/errors';
import { parseJson } from '../lib/json';

export interface DefinitionInput {
  name: string;
  workflowType: WorkflowType;
  description: string | null;
  priority: number;
  conditions: Condition | null;
  skipSelfApproval: boolean;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  steps: StepInput[];
}

/** A step as saved: behaviour settings are optional and default to the classic behaviour. */
export type StepInput = Omit<WorkflowStepDto, keyof StepBehaviour> & Partial<StepBehaviour>;

export interface DefinitionRow {
  id: number; company_id: number; name: string; workflow_type: WorkflowType; description: string | null; priority: number;
  conditions: string | null; skip_self_approval: number; is_active: number; effective_from: string | null; effective_to: string | null;
  revision: number; updated_at: string;
}

export interface StepRow {
  id: number; definition_id: number; seq: number; name: string; approver_type: string; approver_config: string; condition: string | null; sla_hours: number | null; escalation: string | null;
  approval_mode: string | null; allow_reject: number | null; allow_return: number | null; return_to: string | null; require_comment_on_approve: number | null; instructions: string | null;
}

export function stepDto(s: StepRow): WorkflowStepDto {
  return {
    id: s.id, seq: s.seq, name: s.name, approverType: s.approver_type as WorkflowStepDto['approverType'],
    approverConfig: parseJson(s.approver_config, {}), condition: parseJson<Condition | null>(s.condition, null),
    slaHours: s.sla_hours, escalation: parseJson(s.escalation, null),
    ...stepBehaviour({
      approvalMode: s.approval_mode as StepBehaviour['approvalMode'], allowReject: s.allow_reject !== 0, allowReturn: s.allow_return !== 0,
      returnTo: s.return_to as StepBehaviour['returnTo'], requireCommentOnApprove: s.require_comment_on_approve === 1, instructions: s.instructions,
    }),
  };
}

/** Built-in role code, or a role defined by the company (company_roles). */
export function isKnownRole(companyId: number, code: string): boolean {
  if ((ROLES as readonly string[]).includes(code) && code !== 'SUPER_ADMIN') return true;
  try {
    return !!get('SELECT 1 FROM company_roles WHERE company_id = ? AND code = ?', companyId, code);
  } catch {
    return false; // company_roles not migrated yet
  }
}

function validateConfig(companyId: number, step: string, cfg: ApproverConfig): void {
  for (const uid of configUserIds(cfg)) {
    if (!get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', uid, companyId)) throw badRequest('VALIDATION_ERROR', `Step "${step}": user not found`);
  }
  if (cfg.jobFamilyId && !get('SELECT 1 FROM job_families WHERE id = ? AND company_id = ?', cfg.jobFamilyId, companyId)) throw badRequest('VALIDATION_ERROR', `Step "${step}": job family not found`);
  if (cfg.positionId && !get('SELECT 1 FROM positions WHERE id = ? AND company_id = ?', cfg.positionId, companyId)) throw badRequest('VALIDATION_ERROR', `Step "${step}": position not found`);
  if (cfg.role && !isKnownRole(companyId, cfg.role)) throw badRequest('VALIDATION_ERROR', `Step "${step}": unknown role`);
}

function validateRefs(companyId: number, steps: StepInput[]): void {
  if (!steps.length) throw badRequest('VALIDATION_ERROR', 'A workflow needs at least one step');
  for (const s of steps) {
    for (const t of [s.approverType, s.escalation?.approverType].filter(Boolean) as string[]) {
      if (!(APPROVER_TYPES as readonly string[]).includes(t)) throw badRequest('VALIDATION_ERROR', `Unknown approver type ${t}`);
    }
    validateConfig(companyId, s.name, s.approverConfig ?? {});
    if (s.escalation) validateConfig(companyId, s.name, s.escalation.config ?? {});
    for (const [type, cfg, where] of [[s.approverType, s.approverConfig ?? {}, ''], ...(s.escalation ? [[s.escalation.approverType, s.escalation.config ?? {}, ' (escalation)']] : [])] as [string, ApproverConfig, string][]) {
      if (type === 'SPECIFIC_USER' && !configUserIds(cfg).length) throw badRequest('VALIDATION_ERROR', `Step "${s.name}"${where}: choose a user`);
      if (type === 'ROLE' && !cfg.role) throw badRequest('VALIDATION_ERROR', `Step "${s.name}"${where}: choose a role`);
      if (type === 'POSITION_HOLDER' && !cfg.positionId && !cfg.positionCode) throw badRequest('VALIDATION_ERROR', `Step "${s.name}"${where}: choose a position`);
    }
    const b = stepBehaviour(s);
    if (b.instructions && b.instructions.length > 2000) throw badRequest('VALIDATION_ERROR', `Step "${s.name}": instructions are too long`);
  }
}

/** Creates or replaces a definition. Running instances keep their own snapshot, so edits never affect them. */
export function saveDefinition(companyId: number, userId: number | null, id: number | null, input: DefinitionInput): number {
  if (!(WORKFLOW_TYPES as readonly string[]).includes(input.workflowType)) throw badRequest('VALIDATION_ERROR', 'Unknown workflow type');
  validateRefs(companyId, input.steps);
  const ts = nowIso();
  return tx(() => {
    let defId = id;
    if (defId) {
      const before = get<DefinitionRow>('SELECT * FROM workflow_definitions WHERE id = ? AND company_id = ?', defId, companyId);
      if (!before) throw notFound('Workflow');
      run(`UPDATE workflow_definitions SET name = ?, workflow_type = ?, description = ?, priority = ?, conditions = ?, skip_self_approval = ?,
             is_active = ?, effective_from = ?, effective_to = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
        input.name, input.workflowType, input.description, input.priority, input.conditions ? JSON.stringify(input.conditions) : null,
        input.skipSelfApproval ? 1 : 0, input.isActive ? 1 : 0, input.effectiveFrom, input.effectiveTo, ts, defId);
      run('DELETE FROM workflow_steps WHERE definition_id = ?', defId);
    } else {
      defId = run(`INSERT INTO workflow_definitions (company_id, name, workflow_type, description, priority, conditions, skip_self_approval, is_active,
                     effective_from, effective_to, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        companyId, input.name, input.workflowType, input.description, input.priority, input.conditions ? JSON.stringify(input.conditions) : null,
        input.skipSelfApproval ? 1 : 0, input.isActive ? 1 : 0, input.effectiveFrom, input.effectiveTo, userId, ts, ts).lastInsertRowid;
    }
    input.steps.forEach((s, i) => {
      const b = stepBehaviour(s);
      run(`INSERT INTO workflow_steps (definition_id, seq, name, approver_type, approver_config, condition, sla_hours, escalation,
             approval_mode, allow_reject, allow_return, return_to, require_comment_on_approve, instructions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        defId!, i + 1, s.name, s.approverType, JSON.stringify(s.approverConfig ?? {}), s.condition ? JSON.stringify(s.condition) : null,
        s.slaHours ?? null, s.escalation ? JSON.stringify(s.escalation) : null,
        b.approvalMode, b.allowReject ? 1 : 0, b.allowReturn ? 1 : 0, b.returnTo, b.requireCommentOnApprove ? 1 : 0, b.instructions);
    });
    audit(companyId, userId, 'WORKFLOW_DEFINITION', defId!, id ? 'UPDATED' : 'CREATED', { name: input.name, type: input.workflowType, steps: input.steps.length });
    return defId!;
  });
}

export function listDefinitions(companyId: number): WorkflowDefinitionDto[] {
  const defs = all<DefinitionRow & { n: number }>(
    `SELECT d.*, (SELECT COUNT(*) FROM workflow_instances i WHERE i.definition_id = d.id) AS n
       FROM workflow_definitions d WHERE d.company_id = ? ORDER BY d.workflow_type, d.priority, d.name`, companyId,
  );
  const steps = all<StepRow>(
    'SELECT s.* FROM workflow_steps s JOIN workflow_definitions d ON d.id = s.definition_id WHERE d.company_id = ? ORDER BY s.seq', companyId,
  );
  return defs.map((d) => toDefinitionDto(d, steps.filter((s) => s.definition_id === d.id), d.n));
}

export function toDefinitionDto(d: DefinitionRow, steps: StepRow[], instanceCount = 0): WorkflowDefinitionDto {
  return {
    id: d.id, name: d.name, workflowType: d.workflow_type, description: d.description, priority: d.priority,
    conditions: parseJson<Condition | null>(d.conditions, null), skipSelfApproval: d.skip_self_approval === 1, isActive: d.is_active === 1,
    effectiveFrom: d.effective_from, effectiveTo: d.effective_to, revision: d.revision, steps: steps.map(stepDto),
    updatedAt: d.updated_at, instanceCount,
  };
}

export function getDefinition(companyId: number, id: number): WorkflowDefinitionDto {
  const d = get<DefinitionRow>('SELECT * FROM workflow_definitions WHERE id = ? AND company_id = ?', id, companyId);
  if (!d) throw notFound('Workflow');
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM workflow_instances WHERE definition_id = ?', id)?.n ?? 0;
  return toDefinitionDto(d, all<StepRow>('SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY seq', id), n);
}
