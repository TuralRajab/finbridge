/**
 * End-to-end acceptance scenarios (1–24) over the HTTP API on a fresh in-memory database:
 * company → industry → template → organisation → cost centers → users → budget → sections → approval → lock
 * → purchase request → funds check → approval → actual → consumption → change request → revised version → reports → security.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { openDatabase, useDatabase, get } from '../src/db/database';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { advanceClock, setClock } from '../src/lib/clock';
import { processEscalations } from '../src/services/workflowEngine';
import { syncTemplates } from '../src/services/templates';

const db = openDatabase(':memory:');
useDatabase(db);
syncTemplates();
db.prepare("INSERT INTO users (company_id, email, full_name, password_hash, role, created_at) VALUES (NULL, 'owner@test.az', 'Operator', ?, 'SUPER_ADMIN', ?)")
  .run(hashPassword('Owner1234!'), new Date().toISOString());

const Y = new Date().getFullYear() + 1;
const PW = 'Password123';
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server.close(); setClock(null); });

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

/** Shared state built up by the ordered scenarios. */
const S: Record<string, any> = {};
const months = (v: number) => Array(12).fill(v);

describe('FinBridge acceptance scenarios', () => {
  test('1. create company (platform operator issues a licence)', async () => {
    const owner = await login('owner@test.az', 'Owner1234!');
    const c = await ok(owner, 'POST', '/platform/companies', {
      name: 'Test Qida MMC', plan: 'PILOT', maxUsers: 15, validUntil: `${Y + 1}-12-31`,
      admin: { fullName: 'Test Admin', email: 'admin@test.az', password: PW },
    });
    assert.equal(c.setupCompleted, false);
    S.companyId = c.id;
    S.admin = await login('admin@test.az');
    const me = await ok(S.admin, 'GET', '/auth/me');
    assert.equal(me.company.setupCompleted, false);
  });

  test('2–3. select Manufacturing and load its template (with review / exclusions)', async () => {
    const list = await ok<any[]>(S.admin, 'GET', '/templates');
    assert.ok(['BANKING', 'SALES_DISTRIBUTION', 'INDUSTRY', 'MANUFACTURING', 'AGRICULTURE', 'SERVICES'].every((c) => list.some((t) => t.code === c)));
    const tpl = await ok(S.admin, 'GET', '/templates/MANUFACTURING');
    assert.ok(tpl.accountCount >= 38);
    const res = await ok(S.admin, 'POST', '/templates/apply', {
      company: { name: 'Test Qida MMC', taxId: '1500000001' }, industryCode: 'MANUFACTURING',
      excludedAccountCodes: ['751'], structure: true, costCenters: true, workflows: true,
    });
    assert.ok(res.accountsCreated >= 40);
    assert.ok(res.unitsCreated >= 10 && res.costCentersCreated >= 10 && res.workflowsCreated >= 5);
    const accounts = await ok<any[]>(S.admin, 'GET', '/accounts');
    assert.ok(!accounts.some((a) => a.code.startsWith('751')), 'excluded group and its children were skipped');
    assert.ok(accounts.find((a) => a.code === '701')?.isGroup);
    // applying again only merges missing codes
    const again = await ok(S.admin, 'POST', '/templates/apply', { industryCode: 'MANUFACTURING', excludedAccountCodes: ['751'] });
    assert.equal(again.accountsCreated, 0);
    S.accounts = Object.fromEntries(accounts.map((a) => [a.code, a.id]));
    const me = await ok(S.admin, 'GET', '/auth/me');
    assert.equal(me.company.setupCompleted, true);
    assert.equal(me.company.industryCode, 'MANUFACTURING');
  });

  test('4. organisation hierarchy: create, move, reject cycles and disallowed parents', async () => {
    const types = await ok<any[]>(S.admin, 'GET', '/org/types');
    const T = Object.fromEntries(types.map((t) => [t.code, t.id]));
    let units = await ok<any[]>(S.admin, 'GET', '/org/units');
    const U = () => Object.fromEntries(units.map((u: any) => [u.code, u.id]));
    const team = await ok(S.admin, 'POST', '/org/units', { typeId: T.TEAM, parentId: U().PRO, code: 'LINE-3', name: 'İstehsal xətti 3' });
    assert.deepEqual(team.path.slice(-3), ['İstehsalat', 'İstehsal', 'İstehsal xətti 3']);
    // a TEAM cannot sit directly under the company root (allowed parents are configured on the type)
    const bad = await call(S.admin, 'POST', '/org/units', { typeId: T.TEAM, parentId: U().ROOT, code: 'BAD', name: 'x' });
    assert.equal(bad.data.error.code, 'INVALID_HIERARCHY');
    // circular move: a division under its own descendant
    units = await ok(S.admin, 'GET', '/org/units');
    const cyc = await call(S.admin, 'PATCH', `/org/units/${U().PRD}`, { parentId: U().PRO });
    assert.equal(cyc.data.error.code, 'INVALID_HIERARCHY');
    // move a department to another division
    const moved = await ok(S.admin, 'PATCH', `/org/units/${U().QC}`, { parentId: U().SCM });
    assert.equal(moved.parentId, U().SCM);
    await ok(S.admin, 'PATCH', `/org/units/${U().QC}`, { parentId: U().PRD });
    // configurable types: a custom type allowed only under DEPARTMENT
    const shift = await ok(S.admin, 'POST', '/org/types', { code: 'SHIFT', name: 'Növbə', canHaveChildren: false, allowedParentTypeIds: [T.DEPARTMENT] });
    assert.deepEqual(shift.allowedParentTypeIds, [T.DEPARTMENT]);
    S.U = U();
    S.T = T;
  });

  test('5–6. cost centers and responsible users', async () => {
    const mk = (email: string, fullName: string, role: string, extra: object = {}) => ok(S.admin, 'POST', '/users', { email, fullName, role, password: PW, ...extra });
    S.ceo = (await mk('ceo@test.az', 'CEO', 'CEO')).id;
    S.cfo = (await mk('cfo@test.az', 'CFO', 'CFO')).id;
    S.fin = (await mk('fin@test.az', 'Finance', 'FINANCE_MANAGER')).id;
    S.prodHead = (await mk('prod@test.az', 'Production head', 'DEPARTMENT_MANAGER', { orgUnitId: S.U.PRO })).id;
    S.ccOwner = (await mk('line3@test.az', 'Line 3 owner', 'COST_CENTER_OWNER', { orgUnitId: S.U['LINE-3'], managerId: undefined })).id;
    S.emp = (await mk('emp@test.az', 'Operator', 'EMPLOYEE', { orgUnitId: S.U['LINE-3'] })).id;
    S.hrHead = (await mk('hr@test.az', 'HR head', 'DEPARTMENT_MANAGER', { orgUnitId: S.U.HR })).id;
    S.people = (await mk('people@test.az', 'People director', 'DEPARTMENT_MANAGER', { orgUnitId: S.U.HR })).id;
    await ok(S.admin, 'PATCH', `/users/${S.emp}`, { managerId: S.ccOwner });
    const families = await ok<any[]>(S.admin, 'GET', '/org/job-families');
    const hrFamily = families.find((f) => f.code === 'HR');
    assert.ok(hrFamily, 'template created the HR job family');
    await ok(S.admin, 'PATCH', `/org/job-families/${hrFamily.id}`, { ownerUserId: S.people });
    for (const [code, head] of [['PRO', S.prodHead], ['PRD', S.prodHead], ['HR', S.hrHead], ['FIN', S.cfo]]) await ok(S.admin, 'PATCH', `/org/units/${S.U[code]}`, { headUserId: head });
    const cc = await ok(S.admin, 'POST', '/cost-centers', {
      code: 'PRD-03', name: 'İstehsal xətti 3', orgUnitId: S.U['LINE-3'], ownerUserId: S.ccOwner, responsibleUserId: S.ccOwner,
      allowedAccountIds: [S.accounts['701-01'], S.accounts['701-02'], S.accounts['701-06']],
    });
    assert.equal(cc.sectionName, 'İstehsal', 'cost center belongs to the department budget section');
    assert.equal(cc.departmentName, 'İstehsal');
    const ccs = await ok<any[]>(S.admin, 'GET', '/cost-centers');
    S.cc = Object.fromEntries(ccs.map((c) => [c.code, c.id]));
    await ok(S.admin, 'PATCH', `/cost-centers/${S.cc['HR-01']}`, { ownerUserId: S.hrHead, responsibleUserId: S.hrHead });
    for (const code of ['FIN-01', 'PRD-01', 'PRD-02', 'PRD-09', 'MNT-01', 'QC-01', 'PUR-01', 'WH-01', 'WH-02', 'SAL-01', 'SAL-02', 'MKT-01', 'IT-01']) {
      await ok(S.admin, 'PATCH', `/cost-centers/${S.cc[code]}`, { ownerUserId: S.fin });
    }
    S.finT = await login('fin@test.az');
    S.cfoT = await login('cfo@test.az');
    S.ceoT = await login('ceo@test.az');
    S.prodT = await login('prod@test.az');
    S.ownerT = await login('line3@test.az');
    S.empT = await login('emp@test.az');
    S.hrT = await login('hr@test.az');
  });

  test('7–8. create annual budget and assign amounts to cost centers × accounts', async () => {
    const b = await ok(S.finT, 'POST', '/budgets', { fiscalYear: Y, name: `Büdcə ${Y}` });
    S.budgetId = b.id;
    assert.equal(b.version.status, 'DRAFT');
    const line = (cc: string, acc: string, v: number) => ok(S.finT, 'POST', `/budgets/${b.id}/lines`, { costCenterId: S.cc[cc], accountId: S.accounts[acc], months: months(v) });
    await line('PRD-03', '701-01', 10000); // 120 000 / year
    await line('PRD-03', '701-06', 2000);
    await line('PRD-01', '701-01', 50000);
    await line('HR-01', '721-01', 8000);
    await line('FIN-01', '721-09', 1000);
    // group accounts and restricted accounts are rejected
    const grp = await call(S.finT, 'POST', `/budgets/${b.id}/lines`, { costCenterId: S.cc['PRD-03'], accountId: S.accounts['701'], months: months(1) });
    assert.equal(grp.data.error.code, 'ACCOUNT_NOT_ALLOWED');
    const restricted = await call(S.finT, 'POST', `/budgets/${b.id}/lines`, { costCenterId: S.cc['PRD-03'], accountId: S.accounts['721-01'], months: months(1) });
    assert.equal(restricted.data.error.code, 'ACCOUNT_NOT_ALLOWED');
    // the cost-center owner edits a line of his own cost center while the section is open
    const lines = await ok<any[]>(S.ownerT, 'GET', `/budgets/${b.id}/lines`);
    assert.ok(lines.every((l) => l.costCenterCode === 'PRD-03'), 'owner sees only his cost center');
    await ok(S.ownerT, 'PATCH', `/budgets/${b.id}/lines`, { lines: [{ id: lines.find((l) => l.accountCode === '701-06').id, months: months(2500) }] });
  });

  test('9–10. submit sections; multi-step, conditional approval routing', async () => {
    // the HR section matches the HR-specific workflow (condition department = HR): 5 steps
    let d = await ok(S.hrT, 'POST', `/budgets/${S.budgetId}/sections/${S.U.HR}/submit`);
    const hrSection = d.sections.find((s: any) => s.orgUnitId === S.U.HR);
    assert.equal(hrSection.status, 'IN_APPROVAL');
    const inst = await ok(S.finT, 'GET', `/workflows/instances/${hrSection.workflowInstanceId}`);
    assert.equal(inst.definitionName, 'HR illik büdcə təsdiqi');
    // HR head is the cost-center responsible AND requester → step auto-skipped (no self-approval)
    assert.equal(inst.tasks[0].status, 'SKIPPED');
    // job family owner has no owner configured → submission would have failed; we configured none, so resolution fell back? -> no: check pending step
    const pending = inst.tasks.find((t: any) => t.status === 'PENDING');
    assert.ok(pending, 'next step is pending');

    // the production section uses the generic department workflow: dept head (= requester, skipped) → finance
    d = await ok(S.prodT, 'POST', `/budgets/${S.budgetId}/sections/${S.U.PRO}/submit`);
    const pro = d.sections.find((s: any) => s.orgUnitId === S.U.PRO);
    const proInst = await ok(S.finT, 'GET', `/workflows/instances/${pro.workflowInstanceId}`);
    assert.equal(proInst.definitionName, 'Departament büdcəsinin təqdimatı');
    // someone who is not an approver cannot act
    const notMine = await call(S.ownerT, 'POST', `/workflows/tasks/${proInst.myTaskId ?? proInst.tasks.find((t: any) => t.status === 'PENDING').id}/act`, { action: 'APPROVE' });
    assert.equal(notMine.data.error.code, 'NOT_ASSIGNEE');
    // the section cannot be edited while in approval
    const lines = await ok<any[]>(S.ownerT, 'GET', `/budgets/${S.budgetId}/lines`);
    const blocked = await call(S.ownerT, 'PATCH', `/budgets/${S.budgetId}/lines`, { lines: [{ id: lines[0].id, months: months(1) }] });
    assert.equal(blocked.data.error.code, 'BUDGET_NOT_EDITABLE');
    // finance returns it with a comment (required), owner fixes, head resubmits, finance approves
    const finInbox = await ok<any[]>(S.finT, 'GET', '/workflows/inbox');
    const proTask = finInbox.find((i) => i.instanceId === pro.workflowInstanceId);
    assert.equal((await call(S.finT, 'POST', `/workflows/tasks/${proTask.taskId}/act`, { action: 'RETURN' })).data.error.code, 'COMMENT_REQUIRED');
    await ok(S.finT, 'POST', `/workflows/tasks/${proTask.taskId}/act`, { action: 'RETURN', comment: 'Texniki xidməti 10% azaldın' });
    await ok(S.ownerT, 'PATCH', `/budgets/${S.budgetId}/lines`, { lines: [{ id: lines.find((l) => l.accountCode === '701-06').id, months: months(2250) }] });
    d = await ok(S.prodT, 'POST', `/budgets/${S.budgetId}/sections/${S.U.PRO}/submit`);
    const pro2 = d.sections.find((s: any) => s.orgUnitId === S.U.PRO);
    const t2 = (await ok<any[]>(S.finT, 'GET', '/workflows/inbox')).find((i) => i.instanceId === pro2.workflowInstanceId);
    await ok(S.finT, 'POST', `/workflows/tasks/${t2.taskId}/act`, { action: 'APPROVE' });
    // approve the HR chain step by step as the resolved approvers (HR job family owner, finance, CFO, CEO)
    for (let i = 0; i < 6; i++) {
      const cur = await ok(S.finT, 'GET', `/workflows/instances/${hrSection.workflowInstanceId}`);
      const p = cur.tasks.find((t: any) => t.status === 'PENDING');
      if (!p) break;
      const email = ({ CFO: 'cfo@test.az', CEO: 'ceo@test.az', JOB_FAMILY_OWNER: 'people@test.az' } as Record<string, string>)[p.approverType as string] ?? 'fin@test.az';
      await ok(await login(email), 'POST', `/workflows/tasks/${p.id}/act`, { action: 'APPROVE' });
    }
    // finance submits the remaining sections (company root and finance) and approves them
    d = await ok(S.finT, 'GET', `/budgets/${S.budgetId}`);
    for (const s of d.sections.filter((x: any) => x.lineCount > 0 && x.status !== 'APPROVED' && x.status !== 'IN_APPROVAL')) {
      await ok(S.finT, 'POST', `/budgets/${S.budgetId}/sections/${s.orgUnitId}/submit`);
    }
    d = await ok(S.finT, 'GET', `/budgets/${S.budgetId}`);
    for (const s of d.sections.filter((x: any) => x.status === 'IN_APPROVAL')) {
      const tokens: Record<number, string> = { [S.prodHead]: S.prodT, [S.hrHead]: S.hrT, [S.cfo]: S.cfoT, [S.ceo]: S.ceoT };
      for (let i = 0; i < 6; i++) {
        const inst2 = await ok(S.finT, 'GET', `/workflows/instances/${s.workflowInstanceId}`);
        const t = inst2.tasks.find((x: any) => x.status === 'PENDING');
        if (!t) break;
        await ok(tokens[t.assignees[0].userId] ?? S.finT, 'POST', `/workflows/tasks/${t.id}/act`, { action: 'APPROVE' });
      }
    }
    d = await ok(S.finT, 'GET', `/budgets/${S.budgetId}`);
    assert.ok(d.sections.filter((s: any) => s.lineCount > 0).every((s: any) => s.status === 'APPROVED'), JSON.stringify(d.sections.map((s: any) => [s.code, s.status])));
    assert.equal(d.canSubmitVersion, true);
  });

  test('11–12. approve and lock the budget; locked data cannot be edited', async () => {
    let d = await ok(S.finT, 'POST', `/budgets/${S.budgetId}/submit`);
    assert.equal(d.version.status, 'IN_APPROVAL');
    const inst = await ok(S.finT, 'GET', `/workflows/instances/${d.version.workflowInstanceId}`);
    assert.deepEqual(inst.tasks.map((t: any) => t.approverType), ['CFO']);
    await ok(S.cfoT, 'POST', `/workflows/tasks/${inst.tasks[0].id}/act`, { action: 'APPROVE', comment: 'OK' });
    const inst2 = await ok(S.finT, 'GET', `/workflows/instances/${d.version.workflowInstanceId}`);
    const ceoTask = inst2.tasks.find((t: any) => t.status === 'PENDING');
    assert.equal(ceoTask.approverType, 'CEO');
    await ok(S.ceoT, 'POST', `/workflows/tasks/${ceoTask.id}/act`, { action: 'APPROVE' });
    d = await ok(S.finT, 'GET', `/budgets/${S.budgetId}`);
    assert.equal(d.version.status, 'APPROVED');
    d = await ok(S.finT, 'POST', `/budgets/${S.budgetId}/lock`);
    assert.equal(d.version.status, 'LOCKED');
    S.v1 = d.version.id;
    const lines = await ok<any[]>(S.finT, 'GET', `/budgets/${S.budgetId}/lines`);
    S.v1Lines = lines;
    const edit = await call(S.finT, 'PATCH', `/budgets/${S.budgetId}/lines`, { lines: [{ id: lines[0].id, months: months(1) }] });
    assert.equal(edit.data.error.code, 'VERSION_LOCKED');
    // even direct SQL is blocked by database triggers
    assert.throws(() => db.prepare('UPDATE budget_lines SET m1 = 0 WHERE id = ?').run(lines[0].id), /VERSION_LOCKED/);
    assert.throws(() => db.prepare("UPDATE budget_versions SET status = 'DRAFT' WHERE id = ?").run(S.v1), /VERSION_LOCKED/);
  });

  test('13–14. purchase request against an approved cost center with funds check', async () => {
    const check = await ok(S.empT, 'POST', '/requests/budget-check', { costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 3, amount: 5000 });
    assert.equal(check.budget, 27000);
    assert.equal(check.state, 'WITHIN');
    const over = await ok(S.empT, 'POST', '/requests/budget-check', { costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 3, amount: 30000 });
    assert.equal(over.state, 'OVER');
    const near = await ok(S.empT, 'POST', '/requests/budget-check', { costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 3, amount: 25000 });
    assert.equal(near.state, 'NEAR');
    // employees may only raise requests on cost centers of their own unit
    const outside = await call(S.empT, 'POST', '/requests', { title: 'Başqa XM', costCenterId: S.cc['PRD-01'], accountId: S.accounts['701-01'], fiscalYear: Y, month: 3, amount: 100 });
    assert.equal(outside.status, 403);
    S.pr = await ok(S.empT, 'POST', '/requests', { title: 'Konveyer lentinin təmiri', costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 3, amount: 5000, vendor: 'Tekhservis' });
    assert.equal(S.pr.status, 'DRAFT');
  });

  test('15. approval routing by amount: small PR → CC owner only; large PR → owner + finance', async () => {
    const sub = await ok(S.empT, 'POST', `/requests/${S.pr.id}/submit`);
    assert.equal(sub.status, 'IN_APPROVAL');
    assert.equal(sub.budgetState, 'WITHIN');
    const inst = await ok(S.empT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`);
    assert.deepEqual(inst.tasks.map((t: any) => t.approverType), ['COST_CENTER_OWNER']);
    // requests in approval reduce availability
    const check = await ok(S.empT, 'POST', '/requests/budget-check', { costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 3, amount: 0 });
    assert.equal(check.pending, 5000);
    await ok(S.ownerT, 'POST', `/workflows/tasks/${inst.tasks[0].id}/act`, { action: 'APPROVE' });
    assert.equal((await ok(S.empT, 'GET', `/requests/${S.pr.id}`)).status, 'APPROVED');
    // a large one (USD, converted with the company rate) goes through finance too
    await ok(S.admin, 'POST', '/company/exchange-rates', { currency: 'USD', rate: 1.7, validFrom: `${Y - 1}-01-01` });
    const big = await ok(S.ownerT, 'POST', '/requests', { title: 'Xammal partiyası', costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-01'], fiscalYear: Y, month: 4, amount: 7000, currency: 'USD' });
    assert.equal(big.amountBase, 11900);
    const bigSub = await ok(S.ownerT, 'POST', `/requests/${big.id}/submit`);
    const bigInst = await ok(S.ownerT, 'GET', `/workflows/instances/${bigSub.workflowInstanceId}`);
    assert.deepEqual(bigInst.tasks.map((t: any) => [t.approverType, t.status]), [['COST_CENTER_OWNER', 'SKIPPED'], ['FINANCE_MANAGER', 'PENDING']]);
    await ok(S.finT, 'POST', `/workflows/tasks/${bigInst.tasks[1].id}/act`, { action: 'APPROVE' });
    S.big = big;
  });

  test('16–17. record actual spend and calculate budget consumption', async () => {
    let cons = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=costCenter`);
    let row = cons.rows.find((r: any) => r.code === 'PRD-03');
    assert.equal(row.committed, 5000 + 11900);
    assert.equal(row.actual, 0);
    await ok(S.finT, 'POST', `/requests/${S.pr.id}/actuals`, { amount: 4800, month: 3, close: true });
    assert.equal((await ok(S.finT, 'GET', `/requests/${S.pr.id}`)).status, 'CLOSED');
    await ok(S.finT, 'PUT', '/actuals', { year: Y, month: 1, entries: [{ costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-01'], amount: 9500 }] });
    cons = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=costCenter`);
    row = cons.rows.find((r: any) => r.code === 'PRD-03');
    assert.equal(row.actual, 4800 + 9500);
    assert.equal(row.committed, 11900, 'closed request releases its commitment');
    assert.equal(row.annualBudget, 120000 + 27000);
    assert.equal(row.available, row.budget - row.actual - row.committed - row.pending);
    assert.ok(row.consumptionPct > 0);
  });

  test('18–21. change request on the locked budget → approval → revised version, original preserved', async () => {
    const cr = await ok(S.ownerT, 'POST', '/changes', {
      budgetId: S.budgetId, costCenterId: S.cc['PRD-03'], title: 'Əlavə təmir işləri', reason: 'Konveyer xəttinin əsaslı təmiri',
      items: [{ accountId: S.accounts['701-06'], month: 6, requestedAmount: 2250 + 15000 }],
    });
    assert.equal(cr.items[0].currentAmount, 2250);
    assert.equal(cr.totalDifference, 15000);
    const sub = await ok(S.ownerT, 'POST', `/changes/${cr.id}/submit`);
    const inst = await ok(S.ownerT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`);
    // owner step skipped (requester), finance, CFO (≥ 10 000), no CEO (< 100 000)
    assert.deepEqual(inst.tasks.map((t: any) => t.approverType), ['COST_CENTER_OWNER', 'FINANCE_MANAGER']);
    await ok(S.finT, 'POST', `/workflows/tasks/${inst.tasks[1].id}/act`, { action: 'APPROVE' });
    const inst2 = await ok(S.ownerT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`);
    const cfoTask = inst2.tasks.find((t: any) => t.status === 'PENDING');
    assert.equal(cfoTask.approverType, 'CFO');
    await ok(S.cfoT, 'POST', `/workflows/tasks/${cfoTask.id}/act`, { action: 'APPROVE' });
    const done = await ok(S.ownerT, 'GET', `/changes/${cr.id}`);
    assert.equal(done.status, 'APPROVED');
    assert.equal(done.resultVersionNo, 2);
    const d = await ok(S.finT, 'GET', `/budgets/${S.budgetId}`);
    assert.equal(d.version.versionNo, 2);
    assert.equal(d.version.status, 'LOCKED');
    assert.equal(d.versions.find((v: any) => v.versionNo === 1).status, 'SUPERSEDED');
    // the original approved version is untouched
    const v1 = await ok<any[]>(S.finT, 'GET', `/budgets/${S.budgetId}/lines?versionId=${S.v1}`);
    assert.deepEqual(v1.map((l) => l.months), S.v1Lines.map((l: any) => l.months));
    const diff = await ok<any[]>(S.finT, 'GET', `/budgets/${S.budgetId}/compare?a=${S.v1}&b=${d.version.id}`);
    assert.deepEqual(diff.map((x) => [x.costCenterCode, x.accountCode, x.month, x.before, x.after]), [['PRD-03', '701-06', 6, 2250, 17250]]);
    const report = await ok<any[]>(S.finT, 'GET', `/reports/changes?year=${Y}`);
    assert.equal(report[0].change, 15000);
    // consumption now uses the revised budget, while keeping the original for comparison
    const cons = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=costCenter`);
    const row = cons.rows.find((r: any) => r.code === 'PRD-03');
    assert.equal(row.budget - row.originalBudget, 15000);
  });

  test('22–23. dashboard and drill-down company → unit → cost center → account → transactions', async () => {
    const dash = await ok(S.finT, 'GET', `/reports/dashboard?year=${Y}`);
    assert.ok(dash.totals.annualBudget > 0);
    assert.equal(dash.changes.approved, 1);
    assert.ok(dash.capexOpex.length === 2);
    const top = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=unit`);
    const prd = top.rows.find((r: any) => r.code === 'PRD');
    assert.ok(prd && prd.hasChildren);
    const lvl2 = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=unit&parentUnitId=${prd.id}`);
    assert.ok(lvl2.rows.some((r: any) => r.code === 'PRO'));
    assert.equal(lvl2.rows.reduce((s: number, r: any) => s + r.annualBudget, 0), prd.annualBudget, 'children add up to the parent');
    const accRows = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=account&costCenterId=${S.cc['PRD-03']}`);
    const opex = accRows.rows.find((r: any) => r.code === '7');
    const deeper = await ok(S.finT, 'GET', `/reports/consumption?year=${Y}&groupBy=account&costCenterId=${S.cc['PRD-03']}&parentAccountId=${opex.id}`);
    assert.ok(deeper.rows.some((r: any) => r.code === '701'));
    const tx = await ok<any[]>(S.finT, 'GET', `/reports/transactions?year=${Y}&costCenterId=${S.cc['PRD-03']}&accountId=${S.accounts['701-06']}`);
    assert.ok(tx.some((t) => t.kind === 'REQUEST' && t.reference === S.pr.number));
    assert.ok(tx.some((t) => t.kind === 'ACTUAL' && t.amount === 4800));
  });

  test('24. authorization: roles, object scope and tenant isolation are enforced server-side', async () => {
    // employee: no budget access, only own requests
    assert.equal((await call(S.empT, 'GET', '/budgets')).status, 403);
    assert.equal((await call(S.empT, 'GET', `/requests/${S.big.id}`)).status, 403);
    assert.equal((await ok<any[]>(S.empT, 'GET', '/requests')).length, 1);
    // HR head sees only the HR section and HR lines
    const lines = await ok<any[]>(S.hrT, 'GET', `/budgets/${S.budgetId}/lines`);
    assert.ok(lines.length > 0 && lines.every((l) => l.costCenterCode.startsWith('HR')));
    const hrCons = await ok(S.hrT, 'GET', `/reports/consumption?year=${Y}&groupBy=costCenter`);
    assert.ok(hrCons.rows.every((r: any) => r.code.startsWith('HR')));
    assert.deepEqual(await ok(S.hrT, 'GET', `/reports/transactions?year=${Y}&costCenterId=${S.cc['PRD-03']}`), []);
    // the cost-center owner cannot request changes on someone else's cost center
    const foreign = await call(S.ownerT, 'POST', '/changes', { budgetId: S.budgetId, costCenterId: S.cc['HR-01'], title: 'x x x', reason: 'x x x', items: [{ accountId: S.accounts['721-01'], month: 1, requestedAmount: 1 }] });
    assert.equal(foreign.status, 403);
    // only workflow managers can change approval chains
    assert.equal((await call(S.prodT, 'POST', '/workflows/definitions', {})).status, 403);
    // another company cannot see this company's budget (tenant isolation)
    const owner = await login('owner@test.az', 'Owner1234!');
    await ok(owner, 'POST', '/platform/companies', { name: 'Other MMC', plan: 'PILOT', maxUsers: 5, validUntil: `${Y + 1}-12-31`, admin: { fullName: 'Other', email: 'other@test.az', password: PW } });
    const other = await login('other@test.az');
    assert.equal((await call(other, 'GET', `/budgets/${S.budgetId}`)).status, 404);
    assert.equal((await call(other, 'GET', `/requests/${S.pr.id}`)).status, 404);
    // audit trail is append-only
    assert.throws(() => db.prepare('UPDATE audit_logs SET action = ? WHERE id = 1').run('X'), /APPEND_ONLY/);
    assert.throws(() => db.prepare('DELETE FROM workflow_actions WHERE id = 1').run(), /APPEND_ONLY/);
  });
});

describe('workflow engine features', () => {
  test('configured workflow: builder save, preview, SLA escalation and delegation', async () => {
    const def = await ok(S.finT, 'POST', '/workflows/definitions', {
      name: 'Böyük xammal alışları', workflowType: 'PURCHASE_REQUEST', priority: 20,
      conditions: { all: [{ field: 'account', op: 'in', value: ['701-01'] }, { field: 'amount', op: 'gte', value: 50000 }] },
      steps: [
        { name: 'Departament rəhbəri', approverType: 'DEPARTMENT_HEAD', slaHours: 1, escalation: { approverType: 'CFO', config: {} } },
        { name: 'CEO', approverType: 'CEO', condition: { all: [{ field: 'amount', op: 'gte', value: 100000 }] } },
      ],
    });
    assert.equal(def.steps.length, 2);
    const preview = await ok(S.finT, 'POST', '/workflows/preview', { workflowType: 'PURCHASE_REQUEST', amount: 60000, costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-01'] });
    assert.equal(preview.definition.name, 'Böyük xammal alışları');
    assert.deepEqual(preview.steps.map((s: any) => [s.included, s.approvers]), [[true, ['Production head']], [false, []]]);
    // a smaller amount falls back to the generic purchase workflow
    const small = await ok(S.finT, 'POST', '/workflows/preview', { workflowType: 'PURCHASE_REQUEST', amount: 600, costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-01'] });
    assert.equal(small.definition.name, 'Satınalma sorğusu (OPEX)');

    // delegation: the production head delegates to finance; finance sees the task and can act
    const pr = await ok(S.ownerT, 'POST', '/requests', { title: 'Un tədarükü', costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-01'], fiscalYear: Y, month: 5, amount: 60000 });
    const sub = await ok(S.ownerT, 'POST', `/requests/${pr.id}/submit`);
    assert.equal(sub.budgetState, 'WITHIN', 'annual basis: 120 000 budget leaves room for 60 000');
    const today = new Date().toISOString().slice(0, 10);
    await ok(S.prodT, 'POST', '/workflows/delegations', { toUserId: S.cfo, validFrom: today, validTo: today, reason: 'Məzuniyyət' });
    const cfoInbox = await ok<any[]>(S.cfoT, 'GET', '/workflows/inbox');
    assert.ok(cfoInbox.some((i) => i.entityId === pr.id), 'delegate sees the task');

    // SLA: after the due time the escalation approver is added
    setClock(new Date(Date.now() + 2 * 3600_000));
    assert.equal(processEscalations(S.companyId), 1);
    advanceClock(1000);
    assert.equal(processEscalations(S.companyId), 0, 'escalation is applied once');
    setClock(null);
    const inst = await ok(S.finT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`);
    assert.ok(inst.tasks[0].assignees.some((a: any) => a.reason === 'ESCALATION'));
    assert.ok(inst.actions.some((a: any) => a.action === 'ESCALATE'));
    const task = inst.tasks[0];
    await ok(S.cfoT, 'POST', `/workflows/tasks/${task.id}/act`, { action: 'APPROVE', comment: 'Delegated approval' });
    assert.equal((await ok(S.ownerT, 'GET', `/requests/${pr.id}`)).status, 'APPROVED');
    // running instances keep their snapshot when the definition changes
    await ok(S.finT, 'PUT', `/workflows/definitions/${def.id}`, { ...def, steps: [{ name: 'Only CFO', approverType: 'CFO' }] });
    const kept = await ok(S.finT, 'GET', `/workflows/instances/${sub.workflowInstanceId}`);
    assert.equal(kept.tasks[0].stepName, 'Departament rəhbəri');
  });

  test('no matching workflow or unresolvable approver fails fast with a clear error', async () => {
    const defs = await ok<any[]>(S.finT, 'GET', '/workflows/definitions');
    for (const d of defs.filter((x) => x.workflowType === 'EXPENSE_REQUEST')) await ok(S.finT, 'PATCH', `/workflows/definitions/${d.id}/active`, { isActive: false });
    const er = await ok(S.empT, 'POST', '/requests', { requestType: 'EXPENSE', title: 'Taksi xərcləri', costCenterId: S.cc['PRD-03'], accountId: S.accounts['701-06'], fiscalYear: Y, month: 5, amount: 40 });
    assert.equal((await call(S.empT, 'POST', `/requests/${er.id}/submit`)).data.error.code, 'NO_WORKFLOW');
    for (const d of defs.filter((x) => x.workflowType === 'EXPENSE_REQUEST')) await ok(S.finT, 'PATCH', `/workflows/definitions/${d.id}/active`, { isActive: true });
    // the expense workflow's first step is the requester's line manager; without one it cannot start
    await ok(S.admin, 'PATCH', `/users/${S.emp}`, { managerId: null });
    assert.equal((await call(S.empT, 'POST', `/requests/${er.id}/submit`)).data.error.code, 'NO_APPROVER');
  });
});

describe('Excel import', () => {
  test('mapping override, validation, duplicates and import history', async () => {
    const b = await ok(S.finT, 'POST', '/budgets', { fiscalYear: Y + 1, name: `Büdcə ${Y + 1}` });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Plan');
    ws.addRow(['Bölmə', 'XM', 'Hesab', 'Yan', 'Fev', 'Mar']);
    ws.addRow(['PRO', 'PRD-03', '701-01', 1000, 1000, 1000]);
    ws.addRow(['PRO', 'PRD-03', '701-01', 5, 5, 5]); // duplicate
    ws.addRow(['PRO', 'PRD-03', '7', 1, 1, 1]); // group account
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const send = async (extra: Record<string, string>) => {
      const form = new FormData();
      form.append('file', new Blob([buf]), 'plan.xlsx');
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      const r = await fetch(`${base}/budgets/${b.id}/import`, { method: 'POST', headers: { authorization: `Bearer ${S.finT}` }, body: form });
      return { status: r.status, data: (await r.json()) as any };
    };
    // "XM" is not a known header → cost-center column is missing until the user maps it
    let r = await send({ dryRun: 'true' });
    assert.ok(r.data.errors.some((e: any) => /cost center code/.test(e.message)));
    assert.equal(r.data.columns.find((c: any) => c.header === 'XM').field, null);
    r = await send({ dryRun: 'true', mapping: JSON.stringify({ 1: 'departmentCode', 2: 'costCenterCode' }) });
    assert.equal(r.data.rowsValid, 1);
    assert.ok(r.data.errors.some((e: any) => /duplicate of row 2/.test(e.message)));
    assert.ok(r.data.errors.some((e: any) => /group account/.test(e.message)));
    const failed = await send({ dryRun: 'false', mapping: JSON.stringify({ 1: 'departmentCode', 2: 'costCenterCode' }) });
    assert.equal(failed.status, 400, 'nothing is imported while the file has errors');
    assert.equal((await ok<any[]>(S.finT, 'GET', `/budgets/${b.id}/lines`)).length, 0);
    const jobs = await ok<any[]>(S.finT, 'GET', '/audit/imports');
    assert.ok(jobs.length >= 3 && jobs.some((j) => j.status === 'FAILED'));
    // export → import round trip of the locked budget
    const x = await fetch(`${base}/export/budget/${S.budgetId}?lang=en`, { headers: { authorization: `Bearer ${S.finT}` } });
    assert.equal(x.status, 200);
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
    assert.ok(exported.worksheets[0].rowCount >= 6);
    assert.ok(get('SELECT 1 FROM import_jobs LIMIT 1'));
  });
});
