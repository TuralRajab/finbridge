/**
 * Configurable roles: built-in roles as editable company rows, custom roles with page permissions
 * and data scope, enforcement on the API, lock-out protection and audit.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { get, openDatabase, useDatabase } from '../src/db/database';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { syncTemplates } from '../src/services/templates';

const db = openDatabase(':memory:');
useDatabase(db);
syncTemplates();
db.prepare("INSERT INTO users (company_id, email, full_name, password_hash, role, created_at) VALUES (NULL, 'owner@test.az', 'Operator', ?, 'SUPER_ADMIN', ?)")
  .run(hashPassword('Owner1234!'), new Date().toISOString());

const PW = 'Password123';
const Y = new Date().getFullYear() + 1;
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const S: Record<string, any> = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server.close(); });

async function login(email: string, password = PW): Promise<string> {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `login ${email}`);
  return ((await r.json()) as { token: string }).token;
}
async function call<T = any>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
}
async function ok<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await call<T>(token, method, path, body);
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

describe('configurable roles', () => {
  test('setup company, structure and a budget with two departments', async () => {
    const owner = await login('owner@test.az', 'Owner1234!');
    await ok(owner, 'POST', '/platform/companies', { name: 'Rol MMC', plan: 'BUSINESS', maxUsers: 20, validUntil: '2099-12-31', admin: { fullName: 'Rol Admin', email: 'admin@rol.az', password: PW } });
    S.admin = await login('admin@rol.az');
    await ok(S.admin, 'POST', '/templates/apply', { industryCode: 'SALES_DISTRIBUTION', structure: true, costCenters: true, workflows: true });
    const units = await ok<any[]>(S.admin, 'GET', '/org/units');
    S.sal = units.find((u) => u.code === 'SAL').id;
    const ccs = await ok<any[]>(S.admin, 'GET', '/cost-centers');
    S.salCc = ccs.find((c) => c.code === 'SAL-01').id;
    S.itCc = ccs.find((c) => c.code === 'IT-01').id;
    const accs = await ok<any[]>(S.admin, 'GET', '/accounts');
    S.acc = accs.find((a) => a.code === '721-01').id;
    const b = await ok(S.admin, 'POST', '/budgets', { fiscalYear: Y, name: `Büdcə ${Y}` });
    for (const cc of [S.salCc, S.itCc]) await ok(S.admin, 'POST', `/budgets/${b.id}/lines`, { costCenterId: cc, accountId: S.acc, months: Array(12).fill(1000) });
    S.budget = b.id;
  });

  test('built-in roles exist as editable rows; Administrator is locked', async () => {
    const roles = await ok<any[]>(S.admin, 'GET', '/roles');
    assert.deepEqual(roles.filter((r) => r.isSystem).map((r) => r.code).sort(), ['ADMIN', 'CEO', 'CFO', 'COST_CENTER_OWNER', 'DEPARTMENT_MANAGER', 'EMPLOYEE', 'FINANCE_MANAGER', 'VIEWER']);
    const adminRole = roles.find((r) => r.code === 'ADMIN');
    assert.equal(adminRole.isLocked, true);
    assert.equal(adminRole.userCount, 1);
    assert.equal((await call(S.admin, 'PATCH', `/roles/${adminRole.id}`, { permissions: ['dashboard.view'] })).status, 400);
    assert.equal((await call(S.admin, 'DELETE', `/roles/${adminRole.id}`)).status, 400);
    assert.ok(!roles.find((r) => r.code === 'VIEWER').permissions.includes('budget.edit'));
  });

  test('custom "Supervisor" role: pages it may see, unit scope, no editing', async () => {
    const role = await ok(S.admin, 'POST', '/roles', {
      code: 'supervisor', name: 'Nəzarətçi', nameEn: 'Supervisor', baseRole: 'VIEWER', dataScope: 'UNIT',
      permissions: ['dashboard.view', 'budget.view', 'reports.view', 'requests.view', 'org.view'],
    });
    assert.equal(role.code, 'SUPERVISOR');
    assert.equal((await call(S.admin, 'POST', '/roles', { code: 'SUPERVISOR', name: 'x x', dataScope: 'OWN', permissions: [] })).status, 409, 'duplicate code');
    assert.equal((await call(S.admin, 'POST', '/roles', { code: 'HACK', name: 'Hack', dataScope: 'COMPANY', permissions: ['platform.manage'] })).status, 400, 'platform permission is not assignable');
    const u = await ok(S.admin, 'POST', '/users', { email: 'sup@rol.az', fullName: 'Supervisor One', role: 'SUPERVISOR', password: PW, orgUnitId: S.sal });
    assert.equal(u.roleCode, 'SUPERVISOR');
    assert.equal(u.role, 'VIEWER', 'stored base role');
    await ok(S.admin, 'PATCH', `/org/units/${S.sal}`, { headUserId: u.id });
    S.sup = await login('sup@rol.az');
    const me = await ok(S.sup, 'GET', '/auth/me');
    assert.equal(me.roleName, 'Nəzarətçi');
    assert.equal(me.dataScope, 'UNIT');
    assert.ok(me.permissions.includes('dashboard.view') && me.permissions.includes('masterdata.view'));
    assert.ok(!me.permissions.includes('budget.edit'));
    // allowed
    assert.equal((await call(S.sup, 'GET', '/reports/dashboard?year=' + Y)).status, 200);
    assert.equal((await call(S.sup, 'GET', '/requests')).status, 200);
    // unit scope: only the Sales cost center
    const cons = await ok(S.sup, 'GET', `/reports/consumption?year=${Y}&groupBy=costCenter`);
    assert.deepEqual(cons.rows.map((r: any) => r.code), ['SAL-01']);
    // not allowed
    assert.equal((await call(S.sup, 'PATCH', `/budgets/${S.budget}/lines`, { lines: [] })).status, 403);
    assert.equal((await call(S.sup, 'POST', '/requests', { title: 'x', costCenterId: S.salCc, accountId: S.acc, fiscalYear: Y, month: 1, amount: 1 })).status, 403);
    assert.equal((await call(S.sup, 'GET', '/audit/logs')).status, 403);
    S.supRole = role.id;
  });

  test('editing a role changes access immediately; built-in roles can be reset', async () => {
    await ok(S.admin, 'PATCH', `/roles/${S.supRole}`, { permissions: ['dashboard.view', 'budget.view', 'reports.view', 'requests.view', 'request.create', 'audit.view'] });
    assert.equal((await call(S.sup, 'GET', '/audit/logs')).status, 200, 'granted without a new login');
    const viewer = (await ok<any[]>(S.admin, 'GET', '/roles')).find((r) => r.code === 'VIEWER');
    await ok(S.admin, 'POST', '/users', { email: 'viewer@rol.az', fullName: 'Viewer One', role: 'VIEWER', password: PW });
    const vt = await login('viewer@rol.az');
    assert.equal((await call(vt, 'GET', `/reports/consumption?year=${Y}`)).status, 200);
    const edited = await ok(S.admin, 'PATCH', `/roles/${viewer.id}`, { permissions: viewer.permissions.filter((p: string) => p !== 'reports.view') });
    assert.equal(edited.isCustomized, true);
    assert.equal((await call(vt, 'GET', `/reports/consumption?year=${Y}`)).status, 403);
    const reset = await ok(S.admin, 'POST', `/roles/${viewer.id}/reset`);
    assert.equal(reset.isCustomized, false);
    assert.equal((await call(vt, 'GET', `/reports/consumption?year=${Y}`)).status, 200);
  });

  test('changing the base role moves users into built-in approver identities', async () => {
    await ok(S.admin, 'PATCH', `/roles/${S.supRole}`, { baseRole: 'CFO' });
    assert.equal(get<{ role: string }>("SELECT role FROM users WHERE email = 'sup@rol.az'")!.role, 'CFO');
    await ok(S.admin, 'PATCH', `/roles/${S.supRole}`, { baseRole: 'VIEWER' });
  });

  test('lock-out protection, deletion rules and audit', async () => {
    const adminUser = (await ok<any[]>(S.admin, 'GET', '/users')).find((u) => u.email === 'admin@rol.az');
    assert.equal((await call(S.admin, 'PATCH', `/users/${adminUser.id}`, { role: 'VIEWER' })).status, 400, 'no self-demotion');
    // a custom admin-like role cannot remove its own users.manage
    const hr = await ok(S.admin, 'POST', '/roles', { code: 'HR_ADMIN', name: 'HR administrator', baseRole: 'VIEWER', dataScope: 'COMPANY', permissions: ['users.manage', 'org.view'] });
    await ok(S.admin, 'POST', '/users', { email: 'hradmin@rol.az', fullName: 'HR Admin', role: 'HR_ADMIN', password: PW });
    const ht = await login('hradmin@rol.az');
    assert.equal((await call(ht, 'PATCH', `/roles/${hr.id}`, { permissions: ['org.view'] })).status, 400);
    assert.equal((await call(ht, 'GET', '/users')).status, 200);
    assert.equal((await call(S.admin, 'DELETE', `/roles/${S.supRole}`)).status, 409, 'in use');
    assert.equal((await call(S.admin, 'PATCH', `/roles/${S.supRole}`, { isActive: false })).status, 409, 'active users');
    const sup = (await ok<any[]>(S.admin, 'GET', '/users')).find((u) => u.email === 'sup@rol.az');
    await ok(S.admin, 'PATCH', `/users/${sup.id}`, { role: 'VIEWER' });
    assert.equal((await call(S.admin, 'DELETE', `/roles/${S.supRole}`)).status, 204);
    assert.ok(get("SELECT 1 FROM audit_logs WHERE entity_type = 'ROLE' AND action = 'CREATED'"));
    assert.ok(get("SELECT 1 FROM audit_logs WHERE entity_type = 'ROLE' AND action = 'UPDATED' AND changes LIKE '%audit.view%'"));
    assert.equal((await call(ht, 'POST', '/roles', { code: 'X1', name: 'X1 role', dataScope: 'OWN', permissions: [] })).status, 201, 'users.manage may manage roles');
  });
});
