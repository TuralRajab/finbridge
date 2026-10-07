/**
 * Configurable approval stages over the HTTP API on a fresh in-memory database:
 * committee stages (ALL mode, incl. delegates), return to the previous stage, disallowed reject / return,
 * comment on approve, several specific users, custom company roles and snapshot stability of running workflows.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { openDatabase, useDatabase } from '../src/db/database';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { syncTemplates } from '../src/services/templates';

const db = openDatabase(':memory:');
useDatabase(db);
syncTemplates();
db.prepare("INSERT INTO users (company_id, email, full_name, password_hash, role, created_at) VALUES (NULL, 'owner@wf.az', 'Operator', ?, 'SUPER_ADMIN', ?)")
  .run(hashPassword('Owner1234!'), new Date().toISOString());

const Y = new Date().getFullYear();
const PW = 'Password123';
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

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

const S: Record<string, any> = {};
let lastDefId: number | null = null;

/** Creates an active purchase-request definition that wins routing (priority 0) and retires the previous test definition. */
async function useDefinition(name: string, steps: any[]): Promise<any> {
  if (lastDefId) await ok(S.admin, 'PATCH', `/workflows/definitions/${lastDefId}/active`, { isActive: false });
  const def = await ok(S.admin, 'POST', '/workflows/definitions', { name, workflowType: 'PURCHASE_REQUEST', priority: 0, steps });
  lastDefId = def.id;
  return def;
}

/** Raises and submits a purchase request as the employee; returns the request and its workflow instance. */
async function submitRequest(title: string, amount = 1000): Promise<{ pr: any; inst: any }> {
  const pr = await ok(S.empT, 'POST', '/requests', { title, costCenterId: S.ccId, accountId: S.accountId, fiscalYear: Y, month: 6, amount });
  const sub = await ok(S.empT, 'POST', `/requests/${pr.id}/submit`);
  return { pr: sub, inst: await ok(S.empT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`) };
}

const instance = (id: number) => ok(S.empT, 'GET', `/workflows/instances/${id}`);
const pendingTask = (inst: any) => inst.tasks.find((t: any) => t.status === 'PENDING');
const requestStatus = async (id: number) => (await ok(S.empT, 'GET', `/requests/${id}`)).status;

describe('configurable approval stages', () => {
  before(async () => {
    const owner = await login('owner@wf.az', 'Owner1234!');
    await ok(owner, 'POST', '/platform/companies', {
      name: 'Stage Test MMC', plan: 'PILOT', maxUsers: 30, validUntil: `${Y + 2}-12-31`,
      admin: { fullName: 'Admin', email: 'admin@wf.az', password: PW },
    });
    S.admin = await login('admin@wf.az');
    await ok(S.admin, 'POST', '/templates/apply', {
      company: { name: 'Stage Test MMC' }, industryCode: 'MANUFACTURING', excludedAccountCodes: [], structure: true, costCenters: true, workflows: true,
    });
    const units = await ok<any[]>(S.admin, 'GET', '/org/units');
    const unit = units.find((u) => u.code === 'PRO') ?? units[1];
    const accounts = await ok<any[]>(S.admin, 'GET', '/accounts');
    S.accountId = accounts.find((a) => a.code === '701-01').id;
    const mk = async (key: string, role: string, extra: object = {}) => {
      S[key] = (await ok(S.admin, 'POST', '/users', { email: `${key}@wf.az`, fullName: key.toUpperCase(), role, password: PW, ...extra })).id;
      S[`${key}T`] = await login(`${key}@wf.az`);
    };
    await mk('emp', 'EMPLOYEE', { orgUnitId: unit.id });
    await mk('a1', 'FINANCE_MANAGER');
    await mk('a2', 'FINANCE_MANAGER');
    await mk('a3', 'CFO');
    await mk('dlg', 'FINANCE_MANAGER');
    await mk('sup', 'EMPLOYEE');
    const cc = await ok(S.admin, 'POST', '/cost-centers', { code: 'WF-01', name: 'Stage test', orgUnitId: unit.id, ownerUserId: S.a1, allowedAccountIds: [S.accountId] });
    S.ccId = cc.id;
  });

  test('defaults: a step saved without behaviour settings keeps the classic behaviour', async () => {
    const def = await useDefinition('Defaults', [{ name: 'Finance', approverType: 'SPECIFIC_USER', approverConfig: { userId: S.a1 } }]);
    assert.deepEqual(
      [def.steps[0].approvalMode, def.steps[0].allowReject, def.steps[0].allowReturn, def.steps[0].returnTo, def.steps[0].requireCommentOnApprove, def.steps[0].instructions],
      ['ANY', true, true, 'REQUESTER', false, null],
    );
    const { pr, inst } = await submitRequest('Defaults');
    const t = pendingTask(inst);
    assert.equal(t.approvalsRequired, 1);
    await ok(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'APPROVE' });
    assert.equal(await requestStatus(pr.id), 'APPROVED');
  });

  test('ALL mode with several specific users: every approver decides, a delegate counts for the person they act for', async () => {
    const def = await useDefinition('Committee', [{
      name: 'Investment committee', approverType: 'SPECIFIC_USER', approverConfig: { userIds: [S.a1, S.a2, S.a3] },
      approvalMode: 'ALL', instructions: 'Check against the procurement policy',
    }]);
    assert.deepEqual(def.steps[0].approverConfig.userIds, [S.a1, S.a2, S.a3]);
    // a2 is on leave: dlg acts for a2
    const today = new Date().toISOString().slice(0, 10);
    await ok(S.a2T, 'POST', '/workflows/delegations', { toUserId: S.dlg, validFrom: today, validTo: today });

    const { pr, inst } = await submitRequest('Committee purchase');
    const task = pendingTask(inst);
    assert.equal(task.approvalMode, 'ALL');
    assert.equal(task.instructions, 'Check against the procurement policy');
    assert.deepEqual(task.assignees.filter((a: any) => a.required).map((a: any) => a.userId).sort(), [S.a1, S.a2, S.a3].sort());
    assert.equal(task.approvalsRequired, 3);

    await ok(S.a1T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE' });
    let cur = await instance(inst.id);
    assert.equal(cur.status, 'IN_REVIEW');
    assert.equal(pendingTask(cur).approvalsDone, 1);
    assert.equal(await requestStatus(pr.id), 'IN_APPROVAL');
    // a1 already decided: cannot vote twice, task left a1's inbox, panel shows the decision
    assert.equal((await call(S.a1T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE' })).data.error.code, 'INVALID_TRANSITION');
    assert.ok(!(await ok<any[]>(S.a1T, 'GET', '/workflows/inbox')).some((i) => i.taskId === task.id));
    const a1View = await ok(S.a1T, 'GET', `/workflows/instances/${inst.id}`);
    assert.equal(a1View.canAct, false);
    assert.equal(a1View.myDecision, 'APPROVED');

    // the delegate sees the task and approves for a2
    assert.ok((await ok<any[]>(S.dlgT, 'GET', '/workflows/inbox')).some((i) => i.taskId === task.id));
    await ok(S.dlgT, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE', comment: 'For A2' });
    cur = await instance(inst.id);
    const t2 = pendingTask(cur);
    assert.equal(t2.approvalsDone, 2);
    const a2Row = t2.assignees.find((a: any) => a.userId === S.a2);
    assert.equal(a2Row.decision, 'APPROVED');
    assert.equal(a2Row.decidedBy, 'DLG');
    // a2 cannot approve again (the delegate already did)
    assert.equal((await call(S.a2T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE' })).data.error.code, 'INVALID_TRANSITION');

    await ok(S.a3T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE' });
    cur = await instance(inst.id);
    assert.equal(cur.status, 'APPROVED');
    assert.equal(cur.tasks[0].approvalsDone, 3);
    assert.equal(await requestStatus(pr.id), 'APPROVED');
    // revoke the delegation for the following tests
    for (const d of await ok<any[]>(S.a2T, 'GET', '/workflows/delegations')) if (d.isActive) await ok(S.a2T, 'DELETE', `/workflows/delegations/${d.id}`);
  });

  test('ALL mode: one rejection ends the stage', async () => {
    await useDefinition('Committee veto', [{ name: 'Board', approverType: 'SPECIFIC_USER', approverConfig: { userIds: [S.a1, S.a2] }, approvalMode: 'ALL' }]);
    const { pr, inst } = await submitRequest('Vetoed');
    const task = pendingTask(inst);
    await ok(S.a1T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE' });
    await ok(S.a2T, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'REJECT', comment: 'No' });
    assert.equal(await requestStatus(pr.id), 'REJECTED');
  });

  test('return to the previous step re-activates it; on the first step it goes back to the requester', async () => {
    await useDefinition('Return to previous', [
      { name: 'Owner', approverType: 'SPECIFIC_USER', approverConfig: { userId: S.a1 } },
      { name: 'Finance check', approverType: 'SPECIFIC_USER', approverConfig: { userId: S.a2 }, returnTo: 'PREVIOUS_STEP' },
    ]);
    const { pr, inst } = await submitRequest('Return me');
    await ok(S.a1T, 'POST', `/workflows/tasks/${pendingTask(inst).id}/act`, { action: 'APPROVE' });
    let cur = await instance(inst.id);
    const finTask = pendingTask(cur);
    assert.equal(finTask.stepName, 'Finance check');
    assert.equal(finTask.returnTo, 'PREVIOUS_STEP');
    await ok(S.a2T, 'POST', `/workflows/tasks/${finTask.id}/act`, { action: 'RETURN', comment: 'Attach three quotes' });
    cur = await instance(inst.id);
    assert.equal(cur.status, 'IN_REVIEW');
    assert.equal(await requestStatus(pr.id), 'IN_APPROVAL', 'the request stays in approval');
    const again = pendingTask(cur);
    assert.equal(again.stepName, 'Owner');
    assert.deepEqual([again.returnedFrom.taskId, again.returnedFrom.stepName, again.returnedFrom.comment], [finTask.id, 'Finance check', 'Attach three quotes']);
    assert.deepEqual(cur.tasks.map((t: any) => [t.stepName, t.status]), [['Owner', 'APPROVED'], ['Finance check', 'RETURNED'], ['Owner', 'PENDING']]);
    // the owner fixes and approves → finance gets it again → approved
    await ok(S.a1T, 'POST', `/workflows/tasks/${again.id}/act`, { action: 'APPROVE', comment: 'Quotes attached' });
    cur = await instance(inst.id);
    assert.equal(pendingTask(cur).stepName, 'Finance check');
    await ok(S.a2T, 'POST', `/workflows/tasks/${pendingTask(cur).id}/act`, { action: 'APPROVE' });
    assert.equal(await requestStatus(pr.id), 'APPROVED');

    // first step with PREVIOUS_STEP: nothing before it → back to the requester
    await useDefinition('Return first', [{ name: 'Only', approverType: 'SPECIFIC_USER', approverConfig: { userId: S.a1 }, returnTo: 'PREVIOUS_STEP' }]);
    const r2 = await submitRequest('Return first');
    await ok(S.a1T, 'POST', `/workflows/tasks/${pendingTask(r2.inst).id}/act`, { action: 'RETURN', comment: 'Fix it' });
    assert.equal(await requestStatus(r2.pr.id), 'RETURNED');
  });

  test('disallowed reject / return are refused server-side; approve may require a comment', async () => {
    await useDefinition('Finance return only', [{
      name: 'Finance', approverType: 'SPECIFIC_USER', approverConfig: { userId: S.a1 },
      allowReject: false, allowReturn: false, requireCommentOnApprove: true,
    }]);
    const { pr, inst } = await submitRequest('Locked actions');
    const t = pendingTask(inst);
    assert.deepEqual([t.allowReject, t.allowReturn, t.requireCommentOnApprove], [false, false, true]);
    const rej = await call(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'REJECT', comment: 'x' });
    assert.deepEqual([rej.status, rej.data.error.code], [400, 'INVALID_TRANSITION']);
    const ret = await call(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'RETURN', comment: 'x' });
    assert.deepEqual([ret.status, ret.data.error.code], [400, 'INVALID_TRANSITION']);
    const noComment = await call(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'APPROVE' });
    assert.deepEqual([noComment.status, noComment.data.error.code], [400, 'COMMENT_REQUIRED']);
    await ok(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'APPROVE', comment: 'Checked against policy' });
    assert.equal(await requestStatus(pr.id), 'APPROVED');
  });

  test('ROLE approver resolves company-defined (custom) roles', async () => {
    const ts = new Date().toISOString();
    const roleId = Number(db.prepare(`INSERT INTO company_roles (company_id, code, name, base_role, permissions, data_scope, is_system, created_at, updated_at)
      VALUES ((SELECT company_id FROM users WHERE id = ?), 'SUPERVISOR', 'Supervisor', 'EMPLOYEE', '[]', 'OWN', 0, ?, ?)`).run(S.sup, ts, ts).lastInsertRowid);
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(roleId, S.sup);
    const bad = await call(S.admin, 'POST', '/workflows/definitions', { name: 'Bad role', workflowType: 'PURCHASE_REQUEST', steps: [{ name: 'X', approverType: 'ROLE', approverConfig: { role: 'NO_SUCH_ROLE' } }] });
    assert.deepEqual([bad.status, bad.data.error.code], [400, 'VALIDATION_ERROR']);
    await useDefinition('Supervisor', [{ name: 'Supervisor', approverType: 'ROLE', approverConfig: { role: 'SUPERVISOR' } }]);
    const preview = await ok(S.admin, 'POST', '/workflows/preview', { workflowType: 'PURCHASE_REQUEST', amount: 1000, costCenterId: S.ccId });
    assert.deepEqual(preview.steps[0].approvers, ['SUP']);
    const { pr, inst } = await submitRequest('Supervisor approval');
    assert.deepEqual(pendingTask(inst).assignees.map((a: any) => a.userId), [S.sup]);
    await ok(S.supT, 'POST', `/workflows/tasks/${pendingTask(inst).id}/act`, { action: 'APPROVE' });
    assert.equal(await requestStatus(pr.id), 'APPROVED');
    // built-in role codes still resolve by the effective role (users without a company role)
    await useDefinition('Finance role', [{ name: 'Finance', approverType: 'ROLE', approverConfig: { role: 'FINANCE_MANAGER' } }]);
    const r2 = await submitRequest('Finance role');
    assert.deepEqual(pendingTask(r2.inst).assignees.map((a: any) => a.userId).sort(), [S.a1, S.a2, S.dlg].sort());
  });

  test('running instances keep the stage rules of their snapshot', async () => {
    const def = await useDefinition('Snapshot', [{ name: 'Pair', approverType: 'SPECIFIC_USER', approverConfig: { userIds: [S.a1, S.a2] }, approvalMode: 'ALL' }]);
    const { pr, inst } = await submitRequest('Snapshot');
    // the definition changes: single approval, no reject
    const upd = await ok(S.admin, 'PUT', `/workflows/definitions/${def.id}`, { ...def, steps: [{ ...def.steps[0], approvalMode: 'ANY', allowReject: false }] });
    assert.deepEqual([upd.steps[0].approvalMode, upd.steps[0].allowReject], ['ANY', false]);
    const t = pendingTask(await instance(inst.id));
    assert.deepEqual([t.approvalMode, t.allowReject], ['ALL', true]);
    await ok(S.a1T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'APPROVE' });
    assert.equal(await requestStatus(pr.id), 'IN_APPROVAL', 'still needs the second committee member');
    await ok(S.a2T, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'REJECT', comment: 'Rejecting is allowed by the snapshot' });
    assert.equal(await requestStatus(pr.id), 'REJECTED');
    // a new request uses the new rules
    const fresh = await submitRequest('After change');
    const ft = pendingTask(fresh.inst);
    assert.deepEqual([ft.approvalMode, ft.allowReject], ['ANY', false]);
  });
});
