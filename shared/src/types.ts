import type { LicensePlan, Permission, Role } from './roles';
import type {
  ApproverConfig, ApproverType, BudgetCheckState, InstanceStatus, RequestStatus, RequestType, SectionStatus,
  TaskStatus, VersionKind, VersionStatus, WorkflowEntity, WorkflowType,
} from './workflow';
import type { Condition } from './rules';
import type { BudgetCheckResult } from './calc';
import type { Lang } from './months';

export type AccountType = 'REVENUE' | 'EXPENSE' | 'CAPEX' | 'OTHER';
export type ExpenseClass = 'OPEX' | 'CAPEX';

/* ------------------------------------------------------------------ identity & tenancy */

export interface UserDto {
  id: number;
  companyId: number | null;
  email: string;
  fullName: string;
  role: Role;
  orgUnitId: number | null;
  orgUnitName: string | null;
  managerId: number | null;
  jobFamilyId: number | null;
  jobTitle: string | null;
  language: Lang;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface MeDto extends UserDto {
  permissions: Permission[];
  company: CompanyDto | null;
  pendingTasks: number;
}

export interface LicenseDto {
  plan: LicensePlan;
  maxUsers: number;
  usedUsers: number;
  validUntil: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isValid: boolean;
}

export interface CompanyDto {
  id: number;
  name: string;
  taxId: string | null;
  industryCode: string | null;
  baseCurrency: string;
  defaultLanguage: Lang;
  fiscalYearStartMonth: number;
  setupCompleted: boolean;
  license: LicenseDto;
  createdAt: string;
}

export interface PlatformCompanyDto extends CompanyDto {
  adminEmail: string | null;
}

export interface CompanySettingsDto {
  nearLimitPct: number;
  availabilityBasis: 'ANNUAL' | 'YTD';
  includePendingInAvailable: boolean;
  blockOverBudget: boolean;
  autoLockOnApproval: boolean;
}

export interface CurrencyDto { code: string; nameAz: string; nameEn: string; symbol: string; decimals: number }
export interface ExchangeRateDto { id: number; currency: string; rate: number; validFrom: string }

/* ------------------------------------------------------------------ organisation */

export interface OrgUnitTypeDto {
  id: number;
  code: string;
  name: string;
  nameEn: string | null;
  canHaveChildren: boolean;
  requiresCostCenter: boolean;
  inBudgeting: boolean;
  inWorkflow: boolean;
  isActive: boolean;
  sortOrder: number;
  allowedParentTypeIds: number[];
  unitCount: number;
}

export interface OrgUnitDto {
  id: number;
  typeId: number;
  typeCode: string;
  typeName: string;
  parentId: number | null;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  headUserId: number | null;
  headName: string | null;
  isActive: boolean;
  sortOrder: number;
  costCenterCount: number;
  childCount: number;
  /** Ancestors from the root, e.g. ["Company", "Commercial", "Sales"]. */
  path: string[];
}

export interface JobFamilyDto { id: number; code: string; name: string; ownerUserId: number | null; ownerName: string | null; isActive: boolean }
export interface PositionDto { id: number; code: string; title: string; orgUnitId: number | null; orgUnitName: string | null; holderUserId: number | null; holderName: string | null; isActive: boolean }

export interface CostCenterDto {
  id: number;
  code: string;
  name: string;
  description: string | null;
  orgUnitId: number;
  orgUnitName: string;
  departmentName: string | null;
  branchName: string | null;
  sectionUnitId: number;
  sectionName: string;
  ownerUserId: number | null;
  ownerName: string | null;
  responsibleUserId: number | null;
  responsibleName: string | null;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  allowedAccountIds: number[];
}

/* ------------------------------------------------------------------ chart of accounts & templates */

export interface AccountDto {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  accountType: AccountType;
  category: string | null;
  expenseClass: ExpenseClass | null;
  isGroup: boolean;
  allowBudgeting: boolean;
  allowRequests: boolean;
  currency: string | null;
  isActive: boolean;
  sortOrder: number;
  level: number;
  allowedCostCenterIds: number[];
}

export interface TemplateAccountDto {
  code: string;
  parentCode: string | null;
  nameAz: string;
  nameEn: string;
  accountType: AccountType;
  category: string | null;
  expenseClass: ExpenseClass | null;
  isGroup: boolean;
}

export interface TemplateUnit { code: string; type: string; parent: string | null; nameAz: string; nameEn: string }
export interface TemplateCostCenter { code: string; unit: string; nameAz: string; nameEn: string; accounts?: string[] }
export interface TemplateWorkflowStep { name: string; approverType: ApproverType; config?: ApproverConfig; condition?: Condition | null; slaHours?: number | null }
export interface TemplateWorkflow { name: string; type: WorkflowType; priority?: number; conditions?: Condition | null; steps: TemplateWorkflowStep[] }
export interface TemplateKpi { code: string; nameAz: string; nameEn: string; formulaAz: string; formulaEn: string }

export interface TemplateJobFamily { code: string; nameAz: string; nameEn: string }

export interface TemplateContent {
  /** Org unit type codes whose units are budget sections (default ["DEPARTMENT"]). */
  budgetingTypes: string[];
  jobFamilies: TemplateJobFamily[];
  units: TemplateUnit[];
  costCenters: TemplateCostCenter[];
  workflows: TemplateWorkflow[];
  kpis: TemplateKpi[];
  assumptionsAz: string[];
  assumptionsEn: string[];
}

export interface IndustryTemplateDto {
  code: string;
  nameAz: string;
  nameEn: string;
  descriptionAz: string;
  descriptionEn: string;
  accountCount: number;
  version: number;
}

export interface IndustryTemplateDetailDto extends IndustryTemplateDto {
  accounts: TemplateAccountDto[];
  content: TemplateContent;
}

export interface SetupApplyResult {
  accountsCreated: number;
  accountsSkipped: number;
  unitsCreated: number;
  costCentersCreated: number;
  workflowsCreated: number;
}

/* ------------------------------------------------------------------ budgets */

export interface BudgetDto {
  id: number;
  fiscalYear: number;
  name: string;
  currency: string;
  currentVersionId: number | null;
  currentVersionNo: number | null;
  currentStatus: VersionStatus | null;
  approvedVersionId: number | null;
  total: number;
  createdAt: string;
}

export interface BudgetVersionDto {
  id: number;
  budgetId: number;
  versionNo: number;
  name: string;
  kind: VersionKind;
  status: VersionStatus;
  scenarioCode: string;
  basedOnVersionId: number | null;
  changeRequestId: number | null;
  total: number;
  lineCount: number;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  workflowInstanceId: number | null;
}

export interface BudgetSectionDto {
  orgUnitId: number;
  code: string;
  name: string;
  headName: string | null;
  status: SectionStatus;
  total: number;
  lineCount: number;
  submittedAt: string | null;
  approvedAt: string | null;
  workflowInstanceId: number | null;
  canEdit: boolean;
  canSubmit: boolean;
  canReopen: boolean;
}

export interface BudgetDetailDto extends BudgetDto {
  versions: BudgetVersionDto[];
  version: BudgetVersionDto;
  sections: BudgetSectionDto[];
  canSubmitVersion: boolean;
  canLock: boolean;
  canImport: boolean;
  canCreateChange: boolean;
}

export interface BudgetLineDto {
  id: number;
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  sectionUnitId: number;
  sectionName: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  expenseClass: ExpenseClass | null;
  description: string;
  months: number[];
  total: number;
  canEdit: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface VersionDiffRow {
  costCenterCode: string;
  costCenterName: string;
  accountCode: string;
  accountName: string;
  month: number;
  before: number;
  after: number;
  difference: number;
}

/* ------------------------------------------------------------------ workflow */

export interface WorkflowStepDto {
  id?: number;
  seq: number;
  name: string;
  approverType: ApproverType;
  approverConfig: ApproverConfig;
  condition: Condition | null;
  slaHours: number | null;
  escalation: { approverType: ApproverType; config: ApproverConfig } | null;
}

export interface WorkflowDefinitionDto {
  id: number;
  name: string;
  workflowType: WorkflowType;
  description: string | null;
  priority: number;
  conditions: Condition | null;
  skipSelfApproval: boolean;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  revision: number;
  steps: WorkflowStepDto[];
  updatedAt: string;
  instanceCount: number;
}

export interface WorkflowPreviewDto {
  definition: { id: number; name: string } | null;
  steps: { seq: number; name: string; approverType: ApproverType; included: boolean; approvers: string[]; note: string | null }[];
}

export interface WorkflowTaskDto {
  id: number;
  seq: number;
  stepName: string;
  approverType: ApproverType;
  status: TaskStatus;
  assignees: { userId: number; name: string; reason: string }[];
  activatedAt: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  actedBy: string | null;
  actedAt: string | null;
  comment: string | null;
}

export interface WorkflowActionDto {
  id: number;
  action: string;
  userName: string;
  fromStatus: string | null;
  toStatus: string | null;
  comment: string | null;
  createdAt: string;
}

export interface WorkflowInstanceDto {
  id: number;
  workflowType: WorkflowType;
  definitionName: string;
  entityType: WorkflowEntity;
  entityId: number;
  status: InstanceStatus;
  currentSeq: number | null;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  tasks: WorkflowTaskDto[];
  actions: WorkflowActionDto[];
  canAct: boolean;
  myTaskId: number | null;
  canCancel: boolean;
}

export interface InboxItemDto {
  taskId: number;
  instanceId: number;
  workflowType: WorkflowType;
  entityType: WorkflowEntity;
  entityId: number;
  title: string;
  subtitle: string;
  amount: number | null;
  currency: string | null;
  stepName: string;
  requestedBy: string;
  activatedAt: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  link: string;
}

export interface DelegationDto {
  id: number;
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  workflowType: WorkflowType | null;
  validFrom: string;
  validTo: string;
  reason: string | null;
  isActive: boolean;
}

/* ------------------------------------------------------------------ requests & changes */

export interface PurchaseRequestDto {
  id: number;
  number: string;
  requestType: RequestType;
  title: string;
  description: string | null;
  vendor: string | null;
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  fiscalYear: number;
  month: number;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountBase: number;
  actualBase: number;
  status: RequestStatus;
  budgetState: BudgetCheckState | null;
  availableAtSubmit: number | null;
  requestedBy: string;
  requestedById: number;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  workflowInstanceId: number | null;
  canEdit: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canRecordActual: boolean;
}

export interface BudgetCheckDto extends BudgetCheckResult {
  basis: 'ANNUAL' | 'YTD';
  actual: number;
  committed: number;
  pending: number;
  currency: string;
  budgetVersionStatus: VersionStatus | null;
  blockOverBudget: boolean;
}

export interface ChangeItemDto {
  id: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  month: number;
  currentAmount: number;
  requestedAmount: number;
  difference: number;
}

export interface ChangeRequestDto {
  id: number;
  number: string;
  budgetId: number;
  fiscalYear: number;
  baseVersionId: number;
  baseVersionNo: number;
  resultVersionId: number | null;
  resultVersionNo: number | null;
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  title: string;
  reason: string;
  status: RequestStatus;
  totalCurrent: number;
  totalRequested: number;
  totalDifference: number;
  requestedBy: string;
  requestedById: number;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  workflowInstanceId: number | null;
  items: ChangeItemDto[];
  canEdit: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

export interface AttachmentDto { id: number; fileName: string; mimeType: string; sizeBytes: number; uploadedBy: string; createdAt: string }

/* ------------------------------------------------------------------ actuals */

export interface ActualEntryDto {
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  sectionName: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  budget: number;
  amount: number;
  fromRequests: number;
}

/* ------------------------------------------------------------------ reporting */

export interface Measures {
  annualBudget: number;
  budget: number;
  originalBudget: number;
  pending: number;
  committed: number;
  actual: number;
  available: number;
  variance: number;
  variancePct: number | null;
  consumptionPct: number | null;
  forecast: number;
}

export interface ReportRow extends Measures {
  key: string;
  id: number;
  code: string;
  name: string;
  parentName: string | null;
  kind: 'unit' | 'costCenter' | 'account' | 'section';
  hasChildren: boolean;
}

export type ReportGroupBy = 'unit' | 'section' | 'costCenter' | 'account';

export interface ConsumptionReportDto {
  fiscalYear: number;
  throughMonth: number;
  groupBy: ReportGroupBy;
  budgetId: number | null;
  versionNo: number | null;
  versionStatus: VersionStatus | null;
  path: { id: number; name: string }[];
  rows: ReportRow[];
  totals: Measures;
}

export interface TransactionDto {
  kind: 'REQUEST' | 'ACTUAL';
  id: number;
  date: string;
  month: number;
  reference: string;
  description: string;
  amount: number;
  status: string;
  link: string | null;
}

export interface MonthlyPoint { month: number; budget: number; actual: number | null; committed: number }

export interface DashboardDto {
  fiscalYear: number;
  throughMonth: number;
  budget: BudgetDto | null;
  /** Full-year view: annual budget, all actuals, open commitments, availability. */
  totals: Measures;
  /** Year-to-date view (months 1..throughMonth) used for variance. */
  ytd: Measures;
  monthly: MonthlyPoint[];
  sections: ReportRow[];
  topCostCenters: ReportRow[];
  topAccounts: ReportRow[];
  capexOpex: { expenseClass: ExpenseClass; budget: number; actual: number; committed: number }[];
  approvals: { pendingTotal: number; pendingMine: number; overdue: number };
  changes: { approved: number; pending: number; netChange: number };
  requests: { inApproval: number; approvedOpen: number };
  planning: { budgetId: number; fiscalYear: number; status: VersionStatus; sections: { name: string; status: SectionStatus }[] } | null;
}

export interface WorkflowReportDto {
  byType: { workflowType: WorkflowType; inReview: number; approved: number; rejected: number; returned: number; cancelled: number; avgHours: number | null }[];
  overdue: InboxItemDto[];
  pending: InboxItemDto[];
}

export interface ChangeReportRowDto {
  id: number;
  number: string;
  costCenter: string;
  title: string;
  reason: string;
  status: RequestStatus;
  original: number;
  change: number;
  revised: number;
  requestedBy: string;
  createdAt: string;
  decidedAt: string | null;
}

/* ------------------------------------------------------------------ audit & import */

export interface AuditLogDto {
  id: number;
  userName: string | null;
  entityType: string;
  entityId: number | null;
  action: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface ImportIssue { row: number; message: string; level?: 'error' | 'warning' }

export interface ImportColumn { index: number; header: string; field: string | null }

export interface ImportReport {
  dryRun: boolean;
  rowsRead: number;
  rowsValid: number;
  total: number;
  columns: ImportColumn[];
  created: { units: string[]; costCenters: string[]; accounts: string[] };
  errors: ImportIssue[];
  warnings: ImportIssue[];
  applied: boolean;
  jobId: number | null;
}

export interface ImportJobDto {
  id: number;
  kind: 'BUDGET' | 'ACTUALS';
  fileName: string;
  status: 'VALIDATED' | 'APPLIED' | 'FAILED';
  rowsRead: number;
  rowsValid: number;
  total: number;
  errorCount: number;
  userName: string | null;
  createdAt: string;
}
