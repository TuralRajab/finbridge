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
  'company.view', // company profile and licence page
  'company.manage', // company profile and budget-control settings
  'users.view', // users & roles pages (read)
  'users.manage', // users, roles, delegations of others
  'org.view', // organisation structure and cost-center pages
  'org.manage', // org unit types, org tree, cost centers, job families, positions
  'coa.view', // chart of accounts and currency pages
  'coa.manage', // chart of accounts, currencies, exchange rates
  'templates.apply', // industry templates / company setup
  'workflow.view', // workflow definitions (read)
  'workflow.manage', // workflow definitions
  'masterdata.view', // reference data for pickers — always granted to company users
  'dashboard.view',
  'budget.view',
  'budget.create', // create budgets and versions
  'budget.manage', // submit versions, lock, reopen sections, import into budgets
  'budget.edit', // edit lines inside the user's scope
  'budget.submit', // submit a budget section into its workflow
  'requests.view', // purchase / expense request pages (within scope)
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

/** Permissions a company role may hold (everything except the platform operator's). */
export const ASSIGNABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'platform.manage') as Exclude<Permission, 'platform.manage'>[];

/** Holding the key implies the listed permissions (edit implies view). */
export const PERMISSION_IMPLIES: Partial<Record<Permission, Permission[]>> = {
  'company.manage': ['company.view'],
  'users.manage': ['users.view'],
  'org.manage': ['org.view'],
  'coa.manage': ['coa.view'],
  'workflow.manage': ['workflow.view'],
  'budget.create': ['budget.view'],
  'budget.manage': ['budget.view'],
  'budget.edit': ['budget.view'],
  'budget.submit': ['budget.view'],
  'change.create': ['budget.view'],
  'request.create': ['requests.view'],
  'actuals.manage': ['actuals.view'],
};

/** Adds implied permissions and the always-granted reference-data permission. */
export function expandPermissions(perms: Iterable<string>, companyUser = true): Permission[] {
  const out = new Set<Permission>();
  for (const p of perms) {
    if (!(PERMISSIONS as readonly string[]).includes(p)) continue;
    out.add(p as Permission);
    for (const i of PERMISSION_IMPLIES[p as Permission] ?? []) out.add(i);
  }
  if (companyUser) out.add('masterdata.view');
  return [...out];
}

/**
 * What a role sees. Combined with permissions (what it may do):
 *  COMPANY — all company data · UNIT — the units the user heads (whole subtree) and cost centers they own
 *  COST_CENTERS — only the cost centers the user owns or is responsible for · OWN — only their own requests
 */
export const DATA_SCOPES = ['COMPANY', 'UNIT', 'COST_CENTERS', 'OWN'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

const VIEW_ALL: readonly Permission[] = ['dashboard.view', 'org.view', 'coa.view', 'company.view', 'requests.view'];

const FINANCE: readonly Permission[] = [
  ...VIEW_ALL, 'org.manage', 'coa.manage', 'templates.apply', 'workflow.manage', 'masterdata.view',
  'budget.view', 'budget.create', 'budget.manage', 'budget.edit', 'budget.submit',
  'request.create', 'change.create', 'actuals.view', 'actuals.manage', 'reports.view', 'audit.view',
  'excel.import', 'excel.export',
];

const EXEC: readonly Permission[] = [...VIEW_ALL, 'workflow.view', 'masterdata.view', 'budget.view', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'audit.view', 'excel.export'];

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ['platform.manage'],
  ADMIN: ASSIGNABLE_PERMISSIONS,
  CEO: EXEC,
  CFO: EXEC,
  FINANCE_MANAGER: FINANCE,
  DEPARTMENT_MANAGER: [...VIEW_ALL, 'masterdata.view', 'budget.view', 'budget.edit', 'budget.submit', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'excel.export'],
  COST_CENTER_OWNER: [...VIEW_ALL, 'masterdata.view', 'budget.view', 'budget.edit', 'request.create', 'change.create', 'actuals.view', 'reports.view', 'excel.export'],
  EMPLOYEE: ['masterdata.view', 'company.view', 'requests.view', 'request.create'],
  VIEWER: [...VIEW_ALL, 'masterdata.view', 'budget.view', 'actuals.view', 'reports.view', 'excel.export'],
};

/** Default data scope of each built-in role. */
export const DEFAULT_SCOPE: Record<Exclude<Role, 'SUPER_ADMIN'>, DataScope> = {
  ADMIN: 'COMPANY', CEO: 'COMPANY', CFO: 'COMPANY', FINANCE_MANAGER: 'COMPANY', VIEWER: 'COMPANY',
  DEPARTMENT_MANAGER: 'UNIT', COST_CENTER_OWNER: 'COST_CENTERS', EMPLOYEE: 'OWN',
};

/** Default permissions of a built-in role (the starting point of the company's editable copy). */
export function can(role: Role, permission: Permission): boolean {
  return expandPermissions(MATRIX[role], role !== 'SUPER_ADMIN').includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return expandPermissions(MATRIX[role], role !== 'SUPER_ADMIN');
}

export function permissionMatrix(): Record<Role, Permission[]> {
  return Object.fromEntries(ROLES.map((r) => [r, permissionsFor(r)])) as Record<Role, Permission[]>;
}

/** Roles that see all company data by default. Others are limited by org / cost-center / request scope. */
export const COMPANY_WIDE_ROLES: readonly Role[] = ['ADMIN', 'CEO', 'CFO', 'FINANCE_MANAGER', 'VIEWER'];

export function hasCompanyWideScope(role: Role): boolean {
  return COMPANY_WIDE_ROLES.includes(role);
}

/**
 * Page-oriented catalogue for the role editor: each page/module with its "view" permission,
 * its "edit" permissions and additional actions. Labels live in the web app.
 */
export interface PermissionArea { key: string; view: Permission | null; edit: Permission[]; extra: Permission[] }
export const PERMISSION_AREAS: PermissionArea[] = [
  { key: 'dashboard', view: 'dashboard.view', edit: [], extra: [] },
  { key: 'budgets', view: 'budget.view', edit: ['budget.edit'], extra: ['budget.create', 'budget.submit', 'budget.manage'] },
  { key: 'changes', view: 'budget.view', edit: ['change.create'], extra: [] },
  { key: 'requests', view: 'requests.view', edit: ['request.create'], extra: [] },
  { key: 'actuals', view: 'actuals.view', edit: ['actuals.manage'], extra: [] },
  { key: 'reports', view: 'reports.view', edit: [], extra: [] },
  { key: 'organization', view: 'org.view', edit: ['org.manage'], extra: [] },
  { key: 'accounts', view: 'coa.view', edit: ['coa.manage'], extra: [] },
  { key: 'setup', view: null, edit: ['templates.apply'], extra: [] },
  { key: 'workflows', view: 'workflow.view', edit: ['workflow.manage'], extra: [] },
  { key: 'users', view: 'users.view', edit: ['users.manage'], extra: [] },
  { key: 'company', view: 'company.view', edit: ['company.manage'], extra: [] },
  { key: 'audit', view: 'audit.view', edit: [], extra: [] },
  { key: 'excel', view: null, edit: [], extra: ['excel.export', 'excel.import'] },
];

export const LICENSE_PLANS = ['PILOT', 'BUSINESS', 'ENTERPRISE'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];
