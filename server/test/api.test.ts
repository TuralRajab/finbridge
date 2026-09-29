import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import ExcelJS from 'exceljs';
import { openDatabase, useDatabase } from '../src/db/database';
import { DEMO_PASSWORD, seedDemo } from '../src/db/seed';
import { createApp } from '../src/app';

useDatabase(openDatabase(':memory:'));
seedDemo();

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const nextYear = new Date().getFullYear() + 1;
const thisYear = nextYear - 1;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server.close(); });

async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `login ${email}`);
  return ((await r.json()) as { token: string }).token;
}

async function call<T = any>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
}

test('login rejects a wrong password', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'finance@demo.az', password: 'nope' }) });
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as any).error.code, 'INVALID_CREDENTIALS');
});

test('department manager only sees own department', async () => {
  const t = await login('it.manager@demo.az');
  const budgets = await call<any[]>(t, 'GET', '/budgets');
  const next = budgets.data.find((b) => b.year === nextYear);
  const lines = await call<any[]>(t, 'GET', `/budgets/${next.id}/lines`);
  assert.ok(lines.data.length > 0);
  assert.ok(lines.data.every((l) => l.departmentName === 'İnformasiya texnologiyaları'));
  const pva = await call<any>(t, 'GET', `/reports/plan-vs-actual?year=${thisYear}`);
  assert.equal(pva.data.rows.length, 1);
});

test('full approval flow: changes requested → resubmit → review → CFO approve → lock', async () => {
  const finance = await login('finance@demo.az');
  const sales = await login('sales.manager@demo.az');
  const cfo = await login('cfo@demo.az');
  const viewer = await login('viewer@demo.az');

  const budgets = await call<any[]>(finance, 'GET', '/budgets');
  const id = budgets.data.find((b) => b.year === nextYear).id;
  let detail = (await call<any>(finance, 'GET', `/budgets/${id}`)).data;
  const deptId = (code: string) => detail.departments.find((d: any) => d.code === code).departmentId;

  // Sales edits a line (allowed: CHANGES_REQUESTED) and resubmits.
  const salesLines = (await call<any[]>(sales, 'GET', `/budgets/${id}/lines`)).data;
  const line = salesLines.find((l) => l.accountCode === '6310');
  const months = line.months.map((m: number) => Math.round(m * 0.95));
  assert.equal((await call(sales, 'PATCH', `/budgets/${id}/lines`, { lines: [{ id: line.id, months }] })).status, 200);
  assert.equal((await call(sales, 'POST', `/budgets/${id}/departments/${deptId('SAL')}/actions/submit`)).status, 200);

  // Once submitted, the department can no longer edit.
  const blocked = await call<any>(sales, 'PATCH', `/budgets/${id}/lines`, { lines: [{ id: line.id, months: line.months }] });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, 'BUDGET_NOT_EDITABLE');

  // A viewer cannot run workflow actions; a manager cannot review.
  assert.equal((await call(viewer, 'POST', `/budgets/${id}/departments/${deptId('SAL')}/actions/review`)).status, 403);
  assert.equal((await call(sales, 'POST', `/budgets/${id}/departments/${deptId('SAL')}/actions/review`)).status, 403);

  // request_changes needs a comment
  const noComment = await call<any>(finance, 'POST', `/budgets/${id}/departments/${deptId('SAL')}/actions/request_changes`, {});
  assert.equal(noComment.data.error.code, 'COMMENT_REQUIRED');

  // Cannot send to CFO before all departments are reviewed
  const early = await call<any>(finance, 'POST', `/budgets/${id}/actions/submit_to_cfo`);
  assert.equal(early.data.error.code, 'DEPARTMENTS_NOT_REVIEWED');

  // Finance brings every department to REVIEWED (submitting on their behalf where needed).
  detail = (await call<any>(finance, 'GET', `/budgets/${id}`)).data;
  for (const d of detail.departments) {
    if (['NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(d.status)) {
      assert.equal((await call(finance, 'POST', `/budgets/${id}/departments/${d.departmentId}/actions/submit`)).status, 200);
    }
  }
  detail = (await call<any>(finance, 'GET', `/budgets/${id}`)).data;
  for (const d of detail.departments) {
    if (d.status === 'SUBMITTED') assert.equal((await call(finance, 'POST', `/budgets/${id}/departments/${d.departmentId}/actions/review`)).status, 200);
  }
  assert.equal((await call(finance, 'POST', `/budgets/${id}/actions/submit_to_cfo`)).status, 200);
  assert.equal((await call(finance, 'POST', `/budgets/${id}/actions/approve`)).status, 403);
  const approved = await call<any>(cfo, 'POST', `/budgets/${id}/actions/approve`, { comment: 'OK' });
  assert.equal(approved.data.status, 'APPROVED');
  const locked = await call<any>(finance, 'POST', `/budgets/${id}/actions/lock`);
  assert.equal(locked.data.status, 'LOCKED');
  const events = await call<any[]>(finance, 'GET', `/budgets/${id}/events`);
  assert.ok(events.data.some((e) => e.action === 'approve'));
});

test('actuals entry updates Plan vs Actual', async () => {
  const finance = await login('finance@demo.az');
  const before = (await call<any>(finance, 'GET', `/reports/plan-vs-actual?year=${thisYear}&through=9`)).data;
  const grid = (await call<any[]>(finance, 'GET', `/actuals?year=${thisYear}&month=9`)).data;
  assert.ok(grid.length > 0);
  const e = grid[0];
  const save = await call(finance, 'PUT', '/actuals', { year: thisYear, month: 9, entries: [{ costCenterId: e.costCenterId, accountId: e.accountId, amount: 12345 }] });
  assert.equal(save.status, 200);
  const after = (await call<any>(finance, 'GET', `/reports/plan-vs-actual?year=${thisYear}&through=9`)).data;
  assert.equal(Math.round(after.totals.actualYtd - before.totals.actualYtd), 12345);
});

test('Excel export → import round trip into a new budget', async () => {
  const finance = await login('finance@demo.az');
  const budgets = (await call<any[]>(finance, 'GET', '/budgets')).data;
  const current = budgets.find((b) => b.year === thisYear);
  const xlsx = await fetch(`${base}/export/budget/${current.id}?lang=en`, { headers: { authorization: `Bearer ${finance}` } });
  assert.equal(xlsx.status, 200);
  const buf = Buffer.from(await xlsx.arrayBuffer());

  // Re-shape the exported file into the import format (department code column added).
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.ok(wb.worksheets[0].rowCount > 5);

  const created = await call<any>(finance, 'POST', '/budgets', { year: thisYear + 5, name: 'Test import' });
  assert.equal(created.status, 201);
  const form = new FormData();
  form.append('file', new Blob([buf]), 'budget.xlsx');
  form.append('dryRun', 'true');
  const r = await fetch(`${base}/budgets/${created.data.id}/import`, { method: 'POST', headers: { authorization: `Bearer ${finance}` }, body: form });
  const report = (await r.json()) as any;
  assert.equal(r.status, 200);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors.slice(0, 3)));
  assert.equal(report.rowsValid, current.lineCount);
  assert.equal(Math.round(report.total), Math.round(current.total));

  form.set('dryRun', 'false');
  const applied = (await (await fetch(`${base}/budgets/${created.data.id}/import`, { method: 'POST', headers: { authorization: `Bearer ${finance}` }, body: form })).json()) as any;
  assert.equal(applied.applied, true);
  const detail = (await call<any>(finance, 'GET', `/budgets/${created.data.id}`)).data;
  assert.equal(Math.round(detail.total), Math.round(current.total));
});

test('licence seat limit is enforced', async () => {
  const owner = await login('owner@finbridge.az', 'Admin1234!');
  const companies = (await call<any[]>(owner, 'GET', '/platform/companies')).data;
  const c = companies[0];
  await call(owner, 'PATCH', `/platform/companies/${c.id}`, { maxUsers: c.license.usedUsers });
  const admin = await login('admin@demo.az');
  const r = await call<any>(admin, 'POST', '/users', { fullName: 'New Person', email: 'new@demo.az', role: 'VIEWER', password: 'Password123' });
  assert.equal(r.data.error.code, 'LICENSE_SEAT_LIMIT');
  await call(owner, 'PATCH', `/platform/companies/${c.id}`, { maxUsers: 25 });
  assert.equal((await call(admin, 'POST', '/users', { fullName: 'New Person', email: 'new@demo.az', role: 'VIEWER', password: 'Password123' })).status, 201);
});

test('expired licence blocks sign-in', async () => {
  const owner = await login('owner@finbridge.az', 'Admin1234!');
  const c = (await call<any[]>(owner, 'GET', '/platform/companies')).data[0];
  await call(owner, 'PATCH', `/platform/companies/${c.id}`, { validUntil: '2000-01-01' });
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'finance@demo.az', password: DEMO_PASSWORD }) });
  assert.equal(((await r.json()) as any).error.code, 'LICENSE_EXPIRED');
  await call(owner, 'PATCH', `/platform/companies/${c.id}`, { validUntil: `${nextYear}-12-31` });
});
