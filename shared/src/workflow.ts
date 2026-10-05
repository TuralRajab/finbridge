/**
 * Status vocabularies and workflow-engine metadata shared by API and UI.
 * The approval *chains* are not here: they are configured per company in workflow definitions.
 */

/* ------------------------------------------------------------------ budget */

export const VERSION_KINDS = ['INITIAL', 'REVISED', 'FORECAST', 'MANAGEMENT'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/**
 * DRAFT → IN_APPROVAL → APPROVED → LOCKED → SUPERSEDED (when a change request creates the next version).
 * A rejected/returned version goes back to DRAFT. LOCKED and SUPERSEDED are terminal for edits.
 */
export const VERSION_STATUSES = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'LOCKED', 'SUPERSEDED'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** Per budgeting unit (e.g. department) inside a draft version. */
export const SECTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'IN_APPROVAL', 'RETURNED', 'APPROVED'] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];
export const SECTION_EDITABLE: readonly SectionStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED'];

/* ------------------------------------------------------------------ requests */

/** Shared by purchase/expense requests and budget change requests. */
export const REQUEST_STATUSES = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'CLOSED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_EDITABLE: readonly RequestStatus[] = ['DRAFT', 'RETURNED'];

export const REQUEST_TYPES = ['PURCHASE', 'EXPENSE'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const BUDGET_CHECK_STATES = ['WITHIN', 'NEAR', 'OVER'] as const;
export type BudgetCheckState = (typeof BUDGET_CHECK_STATES)[number];

/* ------------------------------------------------------------------ workflow engine */

export const WORKFLOW_TYPES = [
  'BUDGET_SUBMISSION',
  'BUDGET_APPROVAL',
  'BUDGET_CHANGE',
  'PURCHASE_REQUEST',
  'EXPENSE_REQUEST',
  'FORECAST_SUBMISSION',
  'FORECAST_APPROVAL',
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

/** Who approves a step. Resolved at run time from the organisation structure. */
export const APPROVER_TYPES = [
  'SPECIFIC_USER', // config.userId
  'ROLE', // config.role — any active user with that role
  'CEO',
  'CFO',
  'FINANCE_MANAGER',
  'DEPARTMENT_HEAD', // head of nearest ancestor unit of type config.unitTypeCode (default DEPARTMENT)
  'ORG_UNIT_OWNER', // head of the subject unit (or nearest ancestor with a head)
  'EXECUTIVE', // head of the top-level unit (below company) the subject belongs to
  'COST_CENTER_OWNER', // budget owner of the cost center(s)
  'COST_CENTER_RESPONSIBLE', // responsible person of the cost center(s)
  'JOB_FAMILY_OWNER', // config.jobFamilyId, else the requester's job family
  'POSITION_HOLDER', // config.positionId
  'DYNAMIC_MANAGER', // requester's line manager
] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

export interface ApproverConfig {
  userId?: number;
  role?: string;
  unitTypeCode?: string;
  jobFamilyId?: number;
  /** Alternative to jobFamilyId, used by templates. */
  jobFamilyCode?: string;
  positionId?: number;
  positionCode?: string;
}

export const INSTANCE_STATUSES = ['IN_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ACTIONS = ['APPROVE', 'REJECT', 'RETURN'] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/** Entities a workflow can run on. */
export const WORKFLOW_ENTITIES = ['BUDGET_SECTION', 'BUDGET_VERSION', 'CHANGE_REQUEST', 'PURCHASE_REQUEST'] as const;
export type WorkflowEntity = (typeof WORKFLOW_ENTITIES)[number];
