import type { LicensePlan, Permission, Role } from './roles';
import type { BudgetAction, BudgetStatus, DeptAction, DeptStatus } from './workflow';
import type { Lang } from './months';

export type AccountType = 'OPEX' | 'CAPEX';

export interface UserDto {
  id: number;
  companyId: number | null;
  email: string;
  fullName: string;
  role: Role;
  departmentId: number | null;
  language: Lang;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface MeDto extends UserDto {
  permissions: Permission[];
  company: CompanyDto | null;
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
  baseCurrency: string;
  license: LicenseDto;
  createdAt: string;
}

export interface DepartmentDto {
  id: number;
  code: string;
  name: string;
  managerId: number | null;
  managerName: string | null;
  isActive: boolean;
  costCenterCount: number;
}

export interface CostCenterDto {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  departmentName: string;
  ownerId: number | null;
  ownerName: string | null;
  isActive: boolean;
}

export interface AccountDto {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  isActive: boolean;
}

export interface BudgetDto {
  id: number;
  year: number;
  name: string;
  status: BudgetStatus;
  currency: string;
  total: number;
  lineCount: number;
  createdAt: string;
  approvedAt: string | null;
  lockedAt: string | null;
}

export interface BudgetDepartmentDto {
  departmentId: number;
  code: string;
  name: string;
  managerName: string | null;
  status: DeptStatus;
  total: number;
  lineCount: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  lastComment: string | null;
  allowedActions: DeptAction[];
  canEdit: boolean;
}

export interface BudgetDetailDto extends BudgetDto {
  departments: BudgetDepartmentDto[];
  allowedActions: BudgetAction[];
  canImport: boolean;
}

export interface BudgetLineDto {
  id: number;
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  departmentId: number;
  departmentName: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  description: string;
  months: number[];
  total: number;
  canEdit: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface BudgetEventDto {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  comment: string | null;
  departmentName: string | null;
  userName: string;
  createdAt: string;
}

export interface ActualEntryDto {
  costCenterId: number;
  costCenterCode: string;
  costCenterName: string;
  departmentName: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  budget: number;
  amount: number;
}

export type PlanVsActualGroupBy = 'department' | 'costCenter' | 'account';

export interface PlanVsActualRow {
  key: string;
  id: number;
  code: string;
  name: string;
  parentName: string | null;
  annualBudget: number;
  budgetYtd: number;
  actualYtd: number;
  variance: number;
  variancePct: number | null;
  forecast: number;
}

export interface PlanVsActualDto {
  year: number;
  throughMonth: number;
  groupBy: PlanVsActualGroupBy;
  budgetId: number | null;
  budgetStatus: BudgetStatus | null;
  rows: PlanVsActualRow[];
  totals: Omit<PlanVsActualRow, 'key' | 'id' | 'code' | 'name' | 'parentName'>;
}

export interface MonthlyPoint {
  month: number;
  budget: number;
  actual: number | null;
}

export interface DashboardDto {
  year: number;
  throughMonth: number;
  budget: BudgetDto | null;
  kpis: {
    annualBudget: number;
    budgetYtd: number;
    actualYtd: number;
    variance: number;
    variancePct: number | null;
    forecast: number;
    forecastVsBudgetPct: number | null;
  };
  departments: PlanVsActualRow[];
  topOverspends: PlanVsActualRow[];
  monthly: MonthlyPoint[];
  approval: { status: BudgetStatus; year: number; budgetId: number; departments: { name: string; status: DeptStatus }[] } | null;
}

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  rowsRead: number;
  rowsValid: number;
  total: number;
  created: { departments: string[]; costCenters: string[]; accounts: string[] };
  errors: ImportIssue[];
  applied: boolean;
}

export interface PlatformCompanyDto extends CompanyDto {
  adminEmail: string | null;
}
