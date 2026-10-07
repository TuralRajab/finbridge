/**
 * Bulk import of master data through the real HTTP API: templates, check runs, upserts,
 * in-file dependencies, validation errors that block the whole file, permissions and audit.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
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
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let admin = '';
let companyId = 0;

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
async function ok<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Builds an .xlsx with the given header row and data rows (first sheet). */
async function xlsx(headers: string[], rows: (string | number | Date | null)[][], sheet = 'Data'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function importFile(token: string, kind: string, file: Buffer, fields: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('file', new Blob([file]), `${kind}.xlsx`);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(`${base}/bulk-import/${kind}?lang=en`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, data: await r.json() };
}

async function template(token: string, kind: string, query = ''): Promise<ExcelJS.Workbook> {
  const r = await fetch(`${base}/bulk-import/${kind}/template?lang=az${query}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await r.arrayBuffer());
  return wb;
}

describe('bulk import', () => {
  test('setup: company from the Sales & distribution template', async () => {
    const owner = await login('owner@test.az', 'Owner1234!');
    const c = await ok(owner, 'POST', '/platform/companies', {
      name: 'Bulk MMC', plan: 'PILOT', maxUsers: 6, validUntil: '2099-12-31', admin: { fullName: 'Bulk Admin', email: 'admin@bulk.az', password: PW },
    });
    companyId = c.id;
    admin = await login('admin@bulk.az');
    await ok(admin, 'POST', '/templates/apply', { industryCode: 'SALES_DISTRIBUTION', structure: true, costCenters: true, workflows: true });
  });

  test('kinds and templates: instructions, reference lists, drop-downs, required markers', async () => {
    const kinds = await ok<any[]>(admin, 'GET', '/bulk-import/kinds?lang=az');
    assert.deepEqual(kinds.map((k) => k.kind), ['ORG_UNITS', 'JOB_FAMILIES', 'USERS', 'POSITIONS', 'ACCOUNTS', 'COST_CENTERS', 'EXCHANGE_RATES']);
    assert.ok(kinds.every((k) => k.canImport && k.columns.length >= 3));
    for (const k of kinds) {
      const wb = await template(admin, k.kind);
      const names = wb.worksheets.map((w) => w.name);
      assert.ok(names.includes('Təlimat'), `${k.kind} has instructions`);
      const data = wb.worksheets[0];
      const headers = (data.getRow(1).values as unknown[]).slice(1).map(String);
      assert.equal(headers.length, k.columns.length);
      assert.ok(headers.some((h) => h.endsWith(' *')), 'required columns are marked');
      assert.equal(data.rowCount, 1, 'the empty template has only the header row');
    }
    const units = await template(admin, 'ORG_UNITS');
    const xml = JSON.stringify((units.worksheets[0] as unknown as { dataValidations: { model: unknown } }).dataValidations.model);
    assert.ok(xml.includes('DEPARTMENT') || xml.includes('Siyahılar'), 'type column has a drop-down');
    assert.ok(units.getWorksheet('Kodlar'), 'reference sheet with unit types and units');
    // prefilled template contains the current data
    const pre = await template(admin, 'ORG_UNITS', '&prefill=1');
    assert.ok(pre.worksheets[0].rowCount > 5);
  });

  test('org units: parents later in the file, check run writes nothing, then import', async () => {
    const file = await xlsx(['Code', 'Name', 'Type', 'Parent code', 'Head e-mail'], [
      ['NORTH-T1', 'Şimal komandası', 'TEAM', 'NORTH', null], // parent appears below
      ['NORTH', 'Şimal satış departamenti', 'DEPARTMENT', 'COM', 'nobody@bulk.az'],
    ]);
    const before = (get<{ n: number }>('SELECT COUNT(*) AS n FROM org_units WHERE company_id = ?', companyId))!.n;
    const check = await importFile(admin, 'ORG_UNITS', file);
    assert.equal(check.status, 200);
    assert.equal(check.data.dryRun, true);
    assert.equal(check.data.errors.length, 0, JSON.stringify(check.data.errors));
    assert.equal(check.data.created, 2);
    assert.ok(check.data.warnings.some((w: any) => /nobody@bulk\.az/.test(w.message)), 'unknown head is a warning');
    assert.equal((get<{ n: number }>('SELECT COUNT(*) AS n FROM org_units WHERE company_id = ?', companyId))!.n, before, 'check run wrote nothing');
    const done = await importFile(admin, 'ORG_UNITS', file, { dryRun: 'false' });
    assert.equal(done.data.applied, true);
    assert.equal((get<{ n: number }>('SELECT COUNT(*) AS n FROM org_units WHERE company_id = ?', companyId))!.n, before + 2);
    // same file again: everything unchanged
    const again = await importFile(admin, 'ORG_UNITS', file, { dryRun: 'false' });
    assert.equal(again.data.unchanged, 2);
    assert.equal(again.data.created, 0);
  });

  test('org units: hierarchy rules and cycles block the whole file', async () => {
    const file = await xlsx(['Kod', 'Ad', 'Növ', 'Yuxarı vahidin kodu'], [
      ['OK-1', 'Düzgün vahid', 'DEPARTMENT', 'COM'],
      ['BAD-1', 'Komanda altında departament', 'DEPARTMENT', 'NORTH-T1'], // TEAM cannot have children
      ['CYC-A', 'A', 'DEPARTMENT', 'CYC-B'],
      ['CYC-B', 'B', 'DEPARTMENT', 'CYC-A'],
      ['X', '', 'NOPE', 'COM'],
    ]);
    const r = await importFile(admin, 'ORG_UNITS', file, { dryRun: 'false' });
    assert.equal(r.data.applied, false);
    const rows = new Set(r.data.errors.map((e: any) => e.row));
    for (const row of [3, 4, 5, 6]) assert.ok(rows.has(row), `row ${row} has an error: ${JSON.stringify(r.data.errors)}`);
    assert.ok(!get("SELECT 1 FROM org_units WHERE code = 'OK-1'"), 'nothing written when any row fails');
  });

  test('org units: moving a unit under its own child is rejected', async () => {
    const file = await xlsx(['Code', 'Name', 'Type', 'Parent code'], [['NORTH', 'Şimal', 'DEPARTMENT', 'NORTH-T1']]);
    const r = await importFile(admin, 'ORG_UNITS', file);
    assert.ok(r.data.errors.length >= 1);
  });

  test('accounts: new group with children, parent conversion, OPEX/CAPEX', async () => {
    const file = await xlsx(['Account code', 'Name', 'Parent code', 'Account type', 'Expense class', 'Group account'], [
      ['790-01', 'Yeni xərc 1', '790', 'EXPENSE', null, 'No'],
      ['790', 'Digər əməliyyat xərcləri', '7', 'EXPENSE', 'OPEX', 'Yes'],
      ['790-02', 'Avadanlıq', '790', 'CAPEX', 'CAPEX', 'Xeyr'],
    ]);
    const r = await importFile(admin, 'ACCOUNTS', file, { dryRun: 'false' });
    assert.equal(r.data.applied, true, JSON.stringify(r.data.errors));
    assert.equal(r.data.created, 3);
    const accs = await ok<any[]>(admin, 'GET', '/accounts');
    const g = accs.find((a) => a.code === '790');
    assert.ok(g.isGroup);
    assert.equal(accs.find((a) => a.code === '790-01').parentId, g.id);
    // a leaf with postings cannot become a group — here: a leaf without postings becomes one, with a warning
    const r2 = await importFile(admin, 'ACCOUNTS', await xlsx(['Account code', 'Name', 'Parent code', 'Account type'], [['790-01-A', 'Alt', '790-01', 'EXPENSE']]), { dryRun: 'false' });
    assert.equal(r2.data.applied, true);
    assert.ok(r2.data.warnings.some((w: any) => /790-01/.test(w.message)));
  });

  test('users: manager in the same file, initial password, seat limit, own role protected', async () => {
    const headers = ['E-mail', 'Full name', 'Role', 'Org unit code', 'Manager e-mail', 'Language'];
    const file = await xlsx(headers, [
      ['emp1@bulk.az', 'Əməkdaş Bir', 'EMPLOYEE', 'NORTH', 'boss@bulk.az', 'az'],
      ['boss@bulk.az', 'Rəhbər', 'DEPARTMENT_MANAGER', 'NORTH', null, 'en'],
    ]);
    const noPw = await importFile(admin, 'USERS', file);
    assert.ok(noPw.data.errors.some((e: any) => /initial password/i.test(e.message)));
    const r = await importFile(admin, 'USERS', file, { dryRun: 'false', initialPassword: 'Welcome2026' });
    assert.equal(r.data.applied, true, JSON.stringify(r.data.errors));
    const emp = get<{ manager_id: number; language: string }>("SELECT manager_id, language FROM users WHERE email = 'emp1@bulk.az'")!;
    assert.equal(emp.manager_id, get<{ id: number }>("SELECT id FROM users WHERE email = 'boss@bulk.az'")!.id);
    await login('boss@bulk.az', 'Welcome2026');
    // licence has 6 seats: admin + 2 = 3 used; 4 more → the 4th fails and blocks the file
    const many = await xlsx(headers, [1, 2, 3, 4].map((i) => [`u${i}@bulk.az`, `User ${i}`, 'VIEWER', null, null, null]));
    const seat = await importFile(admin, 'USERS', many, { dryRun: 'false', initialPassword: 'Welcome2026' });
    assert.equal(seat.data.applied, false);
    assert.ok(seat.data.errors.some((e: any) => /licen/i.test(e.message)));
    assert.ok(!get("SELECT 1 FROM users WHERE email = 'u1@bulk.az'"));
    // an admin cannot demote themselves through a file
    const self = await importFile(admin, 'USERS', await xlsx(['E-mail', 'Full name', 'Role'], [['admin@bulk.az', 'Bulk Admin', 'VIEWER']]));
    assert.ok(self.data.errors.length === 1);
  });

  test('job families and positions', async () => {
    const jf = await importFile(admin, 'JOB_FAMILIES', await xlsx(['Code', 'Name', 'Owner e-mail'], [['SALES', 'Satış', 'boss@bulk.az']]), { dryRun: 'false' });
    assert.equal(jf.data.applied, true, JSON.stringify(jf.data.errors));
    const pos = await importFile(admin, 'POSITIONS', await xlsx(['Code', 'Title', 'Org unit code', 'Holder e-mail'], [['POS-NORTH', 'Şimal rəhbəri', 'NORTH', 'boss@bulk.az']]), { dryRun: 'false' });
    assert.equal(pos.data.applied, true, JSON.stringify(pos.data.errors));
    assert.ok(get("SELECT 1 FROM positions WHERE code = 'POS-NORTH' AND holder_user_id IS NOT NULL"));
  });

  test('cost centers: unit, owner, allowed accounts; group accounts rejected; "-" clears', async () => {
    const r = await importFile(admin, 'COST_CENTERS', await xlsx(['Code', 'Name', 'Org unit code', 'Owner e-mail', 'Allowed accounts', 'Valid from'], [
      ['NORTH-01', 'Şimal satış', 'NORTH', 'boss@bulk.az', '790-02, 711-07', '01.01.2027'],
    ]), { dryRun: 'false' });
    assert.equal(r.data.applied, true, JSON.stringify(r.data.errors));
    const cc = (await ok<any[]>(admin, 'GET', '/cost-centers')).find((c) => c.code === 'NORTH-01');
    assert.equal(cc.allowedAccountIds.length, 2);
    assert.equal(cc.validFrom, '2027-01-01');
    assert.equal(cc.sectionName, 'Şimal satış departamenti');
    const bad = await importFile(admin, 'COST_CENTERS', await xlsx(['Code', 'Name', 'Org unit code', 'Allowed accounts'], [['NORTH-02', 'X', 'NORTH', '790']]));
    assert.ok(bad.data.errors.some((e: any) => /group/i.test(e.message)));
    const clear = await importFile(admin, 'COST_CENTERS', await xlsx(['Code', 'Name', 'Allowed accounts'], [['NORTH-01', 'Şimal satış', '-']]), { dryRun: 'false' });
    assert.equal(clear.data.updated, 1);
    assert.equal((await ok<any[]>(admin, 'GET', '/cost-centers')).find((c) => c.code === 'NORTH-01').allowedAccountIds.length, 0);
  });

  test('exchange rates: create, update, base currency not allowed, decimal comma', async () => {
    const r = await importFile(admin, 'EXCHANGE_RATES', await xlsx(['Valyuta', 'Məzənnə', 'Tarixdən etibarən'], [['USD', '1,7', '2027-01-01'], ['EUR', 1.86, '2027-01-01']]), { dryRun: 'false' });
    assert.equal(r.data.applied, true, JSON.stringify(r.data.errors));
    assert.equal(get<{ rate: number }>("SELECT rate FROM exchange_rates WHERE currency = 'USD'")!.rate, 1.7);
    const u = await importFile(admin, 'EXCHANGE_RATES', await xlsx(['Currency', 'Rate', 'Valid from'], [['USD', 1.71, '2027-01-01']]), { dryRun: 'false' });
    assert.equal(u.data.updated, 1);
    const bad = await importFile(admin, 'EXCHANGE_RATES', await xlsx(['Currency', 'Rate', 'Valid from'], [['AZN', 1, '2027-01-01']]));
    assert.ok(bad.data.errors.length === 1);
  });

  test('round trip: the prefilled template re-imports with no changes', async () => {
    for (const kind of ['ORG_UNITS', 'JOB_FAMILIES', 'USERS', 'POSITIONS', 'ACCOUNTS', 'COST_CENTERS', 'EXCHANGE_RATES']) {
      const wb = await template(admin, kind, '&prefill=1');
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const r = await importFile(admin, kind, buf);
      assert.equal(r.data.errors.length, 0, `${kind}: ${JSON.stringify(r.data.errors.slice(0, 3))}`);
      assert.equal(r.data.created + r.data.updated, 0, `${kind}: ${JSON.stringify(r.data.rows.filter((x: any) => x.action !== 'UNCHANGED').slice(0, 3))}`);
    }
  });

  test('file problems, permissions, history and audit', async () => {
    const wrong = await importFile(admin, 'COST_CENTERS', await xlsx(['Foo', 'Bar'], [['a', 'b']]));
    assert.ok(wrong.data.errors[0].message.includes('Required columns'));
    const garbage = await importFile(admin, 'ACCOUNTS', Buffer.from('not an excel file'));
    assert.ok(garbage.data.errors.length === 1);
    const viewerFile = await xlsx(['E-mail', 'Full name', 'Role'], [['viewer@bulk.az', 'Viewer', 'VIEWER']]);
    await importFile(admin, 'USERS', viewerFile, { dryRun: 'false', initialPassword: 'Welcome2026' });
    const viewer = await login('viewer@bulk.az', 'Welcome2026');
    const denied = await importFile(viewer, 'ORG_UNITS', await xlsx(['Code', 'Name'], [['A', 'B']]));
    assert.equal(denied.status, 403);
    const jobs = await ok<any[]>(admin, 'GET', '/audit/imports');
    assert.ok(jobs.some((j) => j.kind === 'ORG_UNITS' && j.status === 'APPLIED' && j.createdCount === 2));
    assert.ok(jobs.some((j) => j.status === 'FAILED'));
    assert.ok(get("SELECT 1 FROM audit_logs WHERE action = 'BULK_IMPORTED'"));
    assert.ok(get(`SELECT 1 FROM audit_logs WHERE entity_type = 'ORG_UNIT' AND action = 'CREATED' AND changes LIKE '%EXCEL_BULK%'`));
  });
});
