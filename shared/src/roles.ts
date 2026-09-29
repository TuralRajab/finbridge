/**
 * Roles and permissions.
 *
 * A company (tenant) holds one licence and many users. Every user has exactly one role.
 * SUPER_ADMIN is the FinBridge platform operator and does not belong to a company.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'CFO',
  'FINANCE_MANAGER',
  'DEPARTMENT_MANAGER',
  'COST_CENTER_OWNER',
  'VIEWER',
] as const;
export type Role = (typeof ROLES)[number];

export const COMPANY_ROLES = ROLES.filter((r) => r !== 'SUPER_ADMIN') as Exclude<Role, 'SUPER_ADMIN'>[];

export const PERMISSIONS = [
  'platform.manage', // create companies, manage licences
  'company.manage', // company profile
  'users.manage', // invite / deactivate users, assign roles
  'masterdata.view',
  'masterdata.manage', // departments, cost centers, accounts
  'budget.view',
  'budget.create',
  'budget.manage', // send to departments, review, request changes, send to CFO, lock
  'budget.edit', // edit budget lines inside the user's scope
  'budget.submit', // submit a department budget to finance
  'budget.approve', // final approval (CFO)
  'actuals.view',
  'actuals.manage',
  'reports.view',
  'excel.import',
  'excel.export',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ['platform.manage'],
  ADMIN: [
    'company.manage', 'users.manage', 'masterdata.view', 'masterdata.manage',
    'budget.view', 'budget.create', 'budget.manage', 'budget.edit', 'budget.submit',
    'actuals.view', 'actuals.manage', 'reports.view', 'excel.import', 'excel.export',
  ],
  CFO: ['masterdata.view', 'budget.view', 'budget.approve', 'actuals.view', 'reports.view', 'excel.export'],
  FINANCE_MANAGER: [
    'masterdata.view', 'masterdata.manage', 'budget.view', 'budget.create', 'budget.manage',
    'budget.edit', 'budget.submit', 'actuals.view', 'actuals.manage', 'reports.view',
    'excel.import', 'excel.export',
  ],
  DEPARTMENT_MANAGER: ['masterdata.view', 'budget.view', 'budget.edit', 'budget.submit', 'actuals.view', 'reports.view', 'excel.export'],
  COST_CENTER_OWNER: ['masterdata.view', 'budget.view', 'budget.edit', 'actuals.view', 'reports.view', 'excel.export'],
  VIEWER: ['masterdata.view', 'budget.view', 'actuals.view', 'reports.view', 'excel.export'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Roles that see the whole company. Everyone else is limited to their departments / cost centers. */
export const COMPANY_WIDE_ROLES: readonly Role[] = ['ADMIN', 'CFO', 'FINANCE_MANAGER', 'VIEWER'];

export function hasCompanyWideScope(role: Role): boolean {
  return COMPANY_WIDE_ROLES.includes(role);
}

export const LICENSE_PLANS = ['PILOT', 'BUSINESS', 'ENTERPRISE'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];
