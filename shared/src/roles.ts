/**
 * Roles and permissions.
 *
 * A company (tenant) holds one licence and many users; every user has one role.
 * Roles grant *capabilities*; *which data* a user sees is decided separately by the
 * object scope (org subtree, owned cost centers, own requests, assigned approvals).
 * Approving is never a role permission: it comes from being assigned a workflow task.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'CEO',
  'CFO',
  'FINANCE_MANAGER',
  'DEPARTMENT_MANAGER',
  'COST_CENTER_OWNER',
  'EMPLOYEE',
  'VIEWER',
] as const;
export type Role = (typeof ROLES)[number];

export const COMPANY_ROLES = ROLES.filter((r) => r !== 'SUPER_ADMIN') as Exclude<Role, 'SUPER_ADMIN'>[];

export const PERMISSIONS = [
  'platform.manage', // companies and licences (FinBridge operator)
  'company.manage', // company profile and budget-control settings
  'users.manage', // users, roles, delegations of others
  'org.manage', // org unit types, org tree, cost centers, job families, positions
  'coa.manage', // chart of accounts, currencies, exchange rates
  'templates.apply', // industry templates / company setup
  'workflow.manage', // workflow definitions
  'masterdata.view', // read structure, accounts, cost centers
  'budget.view',
  'budget.create', // create budgets and versions
  'budget.manage', // submit versions, lock, reopen sections, import into budgets
  'budget.edit', // edit lines inside the user's scope
  'budget.submit', // submit a budget section into its workflow
  'request.create', // purchase / expense requests
  'change.create', // budget change requests on locked budgets
  'actuals.view',
  'actuals.manage',
  'reports.view',
  'audit.view',
  'excel.import',
  'excel.export',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const FINANCE: readonly Permission[] = [
  'org.manage', 'coa.manage', 'templates.apply', 'workflow.manage', 'masterdata.view',
  'budget.view', 'budget.create', 'budget.manage', 'budget.edit', 'budget.submit',
  'request.create', 'change.create', 'actuals.view', 'actuals.manage', 'reports.view', 'audit.view',
  'excel.import', 'excel.export',
];

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ['platform.manage'],
  ADMIN: ['company.manage', 'users.manage', ...FINANCE],
  CEO: ['masterdata.view', 'budget.view', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'audit.view', 'excel.export'],
  CFO: ['masterdata.view', 'budget.view', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'audit.view', 'excel.export'],
  FINANCE_MANAGER: FINANCE,
  DEPARTMENT_MANAGER: ['masterdata.view', 'budget.view', 'budget.edit', 'budget.submit', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'excel.export'],
  COST_CENTER_OWNER: ['masterdata.view', 'budget.view', 'budget.edit', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'excel.export'],
  EMPLOYEE: ['masterdata.view', 'request.create'],
  VIEWER: ['masterdata.view', 'budget.view', 'actuals.view', 'reports.view', 'excel.export'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export function permissionMatrix(): Record<Role, Permission[]> {
  return Object.fromEntries(ROLES.map((r) => [r, permissionsFor(r)])) as Record<Role, Permission[]>;
}

/** Roles that see all company data. Others are limited by org / cost-center / request scope. */
export const COMPANY_WIDE_ROLES: readonly Role[] = ['ADMIN', 'CEO', 'CFO', 'FINANCE_MANAGER', 'VIEWER'];

export function hasCompanyWideScope(role: Role): boolean {
  return COMPANY_WIDE_ROLES.includes(role);
}

export const LICENSE_PLANS = ['PILOT', 'BUSINESS', 'ENTERPRISE'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];
