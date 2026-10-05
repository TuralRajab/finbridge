/**
 * Demo data, produced through the real services and workflow engine (not raw inserts), with a controlled clock:
 *
 *  1. Xəzər Distribusiya MMC (Sales & Distribution) — full story: approved & locked budget for the current year,
 *     actuals, purchase / expense requests in every state, an approved and a pending budget change request,
 *     and next year's budget in collection with sections at different steps.
 *  2. Qafqaz Qida İstehsalat ASC (Manufacturing) — template applied, structure, draft budget.
 *  3. Yeni Şirkət MMC — licence only; its admin starts in the setup wizard.
 *
 *   npm run db:seed     seeds an empty database
 *   npm run db:reset    wipes the database and seeds again
 */
import { hashPassword } from '../auth/password';
import { nowIso, setClock } from '../lib/clock';
import type { UserRow } from '../lib/mappers';
import { createCompany } from '../routes/platform';
import { addLine, createBudget, loadBudget, lockVersion, submitSection, submitVersion, updateLines, listLines } from '../services/budgets';
import { createCr, submitCr } from '../services/changeRequests';
import { upsertActualCell } from '../services/excel';
import { createPr, recordPrActual, submitPr } from '../services/purchaseRequests';
import { applyTemplate, syncTemplates } from '../services/templates';
import { actOnTask } from '../services/workflowEngine';
import { all, get, getDb, run, tx } from './database';

export const DEMO_PASSWORD = 'Demo1234!';
export const PLATFORM_ADMIN = { email: 'owner@finbridge.az', password: 'Admin1234!' };

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const at = (y: number, m: number, d: number, h = 10) => `${y}-${pad(m)}-${pad(d)}T${pad(h)}:00:00.000Z`;

function user(id: number): UserRow {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
}

function addUser(companyId: number, email: string, name: string, role: string, extra: { unit?: number; manager?: number; title?: string; lang?: 'az' | 'en' } = {}): number {
  return run(
    'INSERT INTO users (company_id, email, full_name, password_hash, role, org_unit_id, manager_id, job_title, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    companyId, email, name, hashPassword(DEMO_PASSWORD), role, extra.unit ?? null, extra.manager ?? null, extra.title ?? null, extra.lang ?? 'az', nowIso(),
  ).lastInsertRowid;
}

const unitId = (companyId: number, code: string) => get<{ id: number }>('SELECT id FROM org_units WHERE company_id = ? AND code = ?', companyId, code)!.id;
const ccId = (companyId: number, code: string) => get<{ id: number }>('SELECT id FROM cost_centers WHERE company_id = ? AND code = ?', companyId, code)!.id;
const accId = (companyId: number, code: string) => get<{ id: number }>('SELECT id FROM accounts WHERE company_id = ? AND code = ?', companyId, code)!.id;

/** Acts on the pending task of an instance as its first assignee; repeats `times` steps. */
function act(instanceId: number, action: 'APPROVE' | 'REJECT' | 'RETURN', comment: string | null = null, times = 1, hours = 20): void {
  for (let i = 0; i < times; i++) {
    const t = get<{ id: number; activated_at: string }>("SELECT id, activated_at FROM workflow_tasks WHERE instance_id = ? AND status = 'PENDING' ORDER BY seq LIMIT 1", instanceId);
    if (!t) return;
    const a = get<{ user_id: number }>('SELECT user_id FROM workflow_task_assignees WHERE task_id = ? ORDER BY reason, user_id LIMIT 1', t.id)!;
    setClock(new Date(new Date(t.activated_at).getTime() + hours * 3600_000));
    actOnTask(user(a.user_id), t.id, action, comment);
  }
}

function approveAll(instanceId: number, hours = 20): void {
  for (let i = 0; i < 10; i++) {
    if (!get("SELECT 1 FROM workflow_tasks WHERE instance_id = ? AND status = 'PENDING'", instanceId)) return;
    act(instanceId, 'APPROVE', null, 1, hours);
  }
}

const sectionInstance = (budgetId: number, unit: number) =>
  get<{ workflow_instance_id: number }>('SELECT s.workflow_instance_id FROM budget_sections s JOIN budgets b ON b.current_version_id = s.version_id WHERE b.id = ? AND s.org_unit_id = ?', budgetId, unit)!.workflow_instance_id;

/* ===================================================================== company 1 */

type Plan = [cc: string, acc: string, monthly: number, months?: number[]];

const XEZER_PLAN: Plan[] = [
  ['EXE-01', '721-01', 18000], ['EXE-01', '721-02', 4000], ['EXE-01', '721-09', 3000],
  ['FIN-01', '721-01', 22000], ['FIN-01', '721-02', 4800], ['FIN-01', '721-09', 2500], ['FIN-01', '721-11', 900],
  ['SAL-01', '711-01', 26000], ['SAL-01', '711-02', 6000], ['SAL-01', '711-07', 4200], ['SAL-01', '711-11', 1500],
  ['SAL-02', '711-01', 15000], ['SAL-02', '711-02', 3500], ['SAL-02', '711-07', 3000], ['SAL-02', '711-11', 1200],
  ['SAL-03', '711-01', 12000], ['SAL-03', '711-02', 4000], ['SAL-03', '711-04', 5000],
  ['MKT-01', '711-03', 9000], ['MKT-01', '721-07', 800],
  ['MKT-02', '711-05', 6000], ['MKT-02', '711-04', 4000],
  ['LOG-01', '711-06', 14000], ['LOG-01', '711-07', 7000],
  ['LOG-02', '711-08', 4500], ['LOG-02', '113-01', 60000, [3, 9]],
  ['WH-01', '711-09', 11000], ['WH-01', '711-10', 6500], ['WH-01', '113-02', 25000, [4]],
  ['HR-01', '721-01', 6000], ['HR-01', '721-03', 1500],
  ['HR-02', '721-04', 4000],
  ['HR-03', '721-01', 5000], ['HR-03', '721-02', 9000], ['HR-03', '721-03', 3500],
  ['IT-01', '721-08', 6000], ['IT-01', '113-03', 18000, [2, 8]],
  ['IT-02', '721-07', 8500],
];
const SEASON_MKT = [0.7, 0.8, 1.1, 1.2, 1.1, 0.9, 0.8, 0.8, 1.1, 1.2, 1.3, 1.5];
const DRIFT: Record<string, number> = { EXE: 1.0, FIN: 0.99, SAL: 1.07, MKT: 0.98, LOG: 1.04, WH: 1.0, HR: 1.06, IT: 0.93 };

function monthsFor(p: Plan): number[] {
  const [cc, , base, only] = p;
  return Array.from({ length: 12 }, (_, i) => {
    if (only) return only.includes(i + 1) ? base : 0;
    return Math.round(base * (cc.startsWith('MKT') ? SEASON_MKT[i] : 1));
  });
}

function seedXezer(Y: number, M: number): void {
  setClock(at(Y - 1, 11, 3, 8));
  const companyId = createCompany({
    name: 'Xəzər Distribusiya MMC', taxId: '1403456781', baseCurrency: 'AZN', defaultLanguage: 'az', plan: 'BUSINESS', maxUsers: 25,
    validUntil: `${Y + 1}-12-31`, admin: { fullName: 'Rəşad Məmmədov', email: 'admin@demo.az', password: DEMO_PASSWORD },
  }, null);
  const adminId = get<{ id: number }>("SELECT id FROM users WHERE email = 'admin@demo.az'")!.id;
  applyTemplate(companyId, adminId, 'SALES_DISTRIBUTION', { accounts: true, excludedAccountCodes: [], structure: true, costCenters: true, workflows: true, language: 'az' });
  const U = (c: string) => unitId(companyId, c);

  const ceo = addUser(companyId, 'ceo@demo.az', 'Anar Məmmədli', 'CEO', { unit: U('EXEC'), title: 'Baş icraçı direktor' });
  const cfo = addUser(companyId, 'cfo@demo.az', 'Elçin Quliyev', 'CFO', { unit: U('FIN'), manager: ceo, title: 'Maliyyə direktoru' });
  const fin = addUser(companyId, 'finance@demo.az', 'Leyla Hüseynova', 'FINANCE_MANAGER', { unit: U('FIN'), manager: cfo, title: 'Maliyyə meneceri' });
  const sales = addUser(companyId, 'sales.manager@demo.az', 'Kamran İsmayılov', 'DEPARTMENT_MANAGER', { unit: U('SAL'), manager: ceo, title: 'Kommersiya direktoru' });
  const mkt = addUser(companyId, 'marketing.manager@demo.az', 'Aysel Rzayeva', 'DEPARTMENT_MANAGER', { unit: U('MKT'), manager: sales, title: 'Marketinq rəhbəri' });
  const ops = addUser(companyId, 'ops.manager@demo.az', 'Orxan Həsənov', 'DEPARTMENT_MANAGER', { unit: U('OPD'), manager: ceo, title: 'Əməliyyatlar direktoru' });
  const hr = addUser(companyId, 'hr.manager@demo.az', 'Nigar Əliyeva', 'DEPARTMENT_MANAGER', { unit: U('HR'), manager: cfo, title: 'HR rəhbəri' });
  const it = addUser(companyId, 'it.manager@demo.az', 'Tural Babayev', 'DEPARTMENT_MANAGER', { unit: U('IT'), manager: cfo, title: 'İT rəhbəri' });
  const people = addUser(companyId, 'people.director@demo.az', 'Fərid Cəfərov', 'COST_CENTER_OWNER', { unit: U('HR'), manager: ceo, title: 'İnsan kapitalı direktoru' });
  const field = addUser(companyId, 'field.sales@demo.az', 'Samir Novruzov', 'COST_CENTER_OWNER', { unit: U('BR-BAK'), manager: sales, title: 'Bakı filialının satış rəhbəri' });
  const hrbp = addUser(companyId, 'hr.bp@demo.az', 'Sevinc Abbasova', 'COST_CENTER_OWNER', { unit: U('HR'), manager: hr, title: 'HR biznes tərəfdaşı' });
  const emp = addUser(companyId, 'employee@demo.az', 'Murad Qasımov', 'EMPLOYEE', { unit: U('BR-BAK'), manager: field, title: 'Satış nümayəndəsi' });
  addUser(companyId, 'viewer@demo.az', 'Günel Kərimova', 'VIEWER', { title: 'Audit komitəsi' });

  tx(() => {
    const heads: [string, number][] = [['ROOT', ceo], ['EXEC', ceo], ['FIN', cfo], ['COM', sales], ['SAL', sales], ['BR-BAK', field], ['BR-GNC', field], ['MKT', mkt],
      ['OPD', ops], ['LOG', ops], ['WH', ops], ['SUP', cfo], ['HR', hr], ['IT', it]];
    for (const [c, u] of heads) run('UPDATE org_units SET head_user_id = ? WHERE company_id = ? AND code = ?', u, companyId, c);
    const owners: [string, number, number | null][] = [
      ['EXE-01', ceo, null], ['FIN-01', cfo, fin], ['SAL-01', sales, field], ['SAL-02', sales, field], ['SAL-03', sales, null], ['MKT-01', mkt, null], ['MKT-02', mkt, null],
      ['LOG-01', ops, null], ['LOG-02', ops, null], ['WH-01', ops, null], ['HR-01', hr, hrbp], ['HR-02', hr, hrbp], ['HR-03', people, hrbp], ['IT-01', it, null], ['IT-02', it, null],
    ];
    for (const [c, o, r] of owners) run('UPDATE cost_centers SET owner_user_id = ?, responsible_user_id = ? WHERE company_id = ? AND code = ?', o, r, companyId, c);
    run("UPDATE job_families SET owner_user_id = ? WHERE company_id = ? AND code = 'HR'", people, companyId);
    run("UPDATE job_families SET owner_user_id = ? WHERE company_id = ? AND code = 'FIN'", cfo, companyId);
    run("UPDATE job_families SET owner_user_id = ? WHERE company_id = ? AND code = 'IT'", it, companyId);
    run("UPDATE users SET job_family_id = (SELECT id FROM job_families WHERE company_id = ? AND code = 'HR') WHERE id IN (?, ?, ?)", companyId, hr, hrbp, people);
    run("INSERT INTO positions (company_id, code, title, org_unit_id, holder_user_id) VALUES (?, 'POS-CHRO', 'İnsan kapitalı direktoru', ?, ?)", companyId, U('HR'), people);
    run("INSERT INTO positions (company_id, code, title, org_unit_id, holder_user_id) VALUES (?, 'POS-CFO', 'Maliyyə direktoru', ?, ?)", companyId, U('FIN'), cfo);
    for (const [cur, rate] of [['USD', 1.7], ['EUR', 1.86], ['TRY', 0.042]] as const) {
      run('INSERT INTO exchange_rates (company_id, currency, rate, valid_from, created_at) VALUES (?, ?, ?, ?, ?)', companyId, cur, rate, `${Y}-01-01`, nowIso());
    }
    run("INSERT INTO user_delegations (company_id, from_user_id, to_user_id, workflow_type, valid_from, valid_to, reason, created_by, created_at) VALUES (?, ?, ?, 'PURCHASE_REQUEST', ?, ?, 'Məzuniyyət', ?, ?)",
      companyId, cfo, fin, `${Y}-12-22`, `${Y}-12-31`, cfo, nowIso());
  });
  const C = (c: string) => ccId(companyId, c);
  const A = (c: string) => accId(companyId, c);

  // ---------------------------------------------------------------- current-year budget: plan → sections → approval → lock
  setClock(at(Y - 1, 11, 10, 9));
  let budget = createBudget(user(fin), { fiscalYear: Y, name: `Büdcə ${Y}`, upliftPct: 0 });
  for (const p of XEZER_PLAN) addLine(user(fin), budget, { costCenterId: C(p[0]), accountId: A(p[1]), description: '', months: monthsFor(p) });
  const submitters: [string, number][] = [['ROOT', fin], ['FIN', fin], ['SAL', sales], ['MKT', mkt], ['LOG', ops], ['WH', ops], ['HR', hr], ['IT', it]];
  let day = 12;
  for (const [code, who] of submitters) {
    setClock(at(Y - 1, 11, day++, 9));
    submitSection(user(who), budget, U(code));
    approveAll(sectionInstance(budget.id, U(code)), 26);
  }
  setClock(at(Y - 1, 12, 8, 9));
  budget = loadBudget(companyId, budget.id);
  submitVersion(user(fin), budget);
  approveAll(get<{ workflow_instance_id: number }>('SELECT workflow_instance_id FROM budget_versions WHERE id = ?', budget.current_version_id!)!.workflow_instance_id, 40);
  setClock(at(Y - 1, 12, 20, 15));
  lockVersion(fin, loadBudget(companyId, budget.id));

  // ---------------------------------------------------------------- actuals (Excel uploads), months 1..M-1
  const random = rng(Y);
  for (let m = 1; m < M; m++) {
    setClock(at(Y, m + 1, 4, 11));
    for (const p of XEZER_PLAN) {
      const plan = monthsFor(p)[m - 1];
      if (!plan) continue;
      const drift = DRIFT[p[0].split('-')[0]] ?? 1;
      upsertActualCell(companyId, Y, m, C(p[0]), A(p[1]), Math.round(plan * drift * (0.95 + random() * 0.1)), 'EXCEL', fin);
    }
  }

  // ---------------------------------------------------------------- purchase & expense requests
  const pr = (who: number, when: string, input: Parameters<typeof createPr>[1]) => { setClock(when); return createPr(user(who), input); };
  // a. expense request, approved and closed with an actual
  const a = pr(emp, at(Y, M - 1, 3), { requestType: 'EXPENSE', title: 'Gəncə müştəriləri ilə görüş — ezamiyyə', description: '2 günlük ezamiyyə: yol, mehmanxana, gündəlik', vendor: null, costCenterId: C('SAL-01'), accountId: A('711-11'), fiscalYear: Y, month: M - 1, amount: 850, currency: 'AZN' });
  const aSub = submitPr(user(emp), a);
  approveAll(aSub.workflow_instance_id!, 6);
  setClock(at(Y, M - 1, 12));
  recordPrActual(user(fin), get('SELECT * FROM purchase_requests WHERE id = ?', a.id)!, { amount: 812, month: M - 1, description: 'Avans hesabatı', close: true });
  // b. purchase request approved — commitment
  const b = pr(field, at(Y, M, 1), { requestType: 'PURCHASE', title: 'Bakı filialı üçün yanacaq kartları', description: 'Oktyabr–noyabr üçün 6 avtomobil', vendor: 'Azpetrol', costCenterId: C('SAL-01'), accountId: A('711-07'), fiscalYear: Y, month: M, amount: 3500, currency: 'AZN' });
  approveAll(submitPr(user(field), b).workflow_instance_id!, 5);
  // c. in approval at Finance (≥ 10 000)
  const c = pr(mkt, at(Y, M, 2), { requestType: 'PURCHASE', title: 'Bakı Food Expo sərgi stendi', description: 'Stend dizaynı, quraşdırma və 4 günlük icarə', vendor: 'Expo Group MMC', costCenterId: C('MKT-02'), accountId: A('711-05'), fiscalYear: Y, month: Math.min(12, M + 1), amount: 18000, currency: 'AZN' });
  submitPr(user(mkt), c);
  // d. USD licences approved, partly invoiced
  const d = pr(it, at(Y, M - 2 > 0 ? M - 2 : 1, 5), { requestType: 'PURCHASE', title: 'Microsoft 365 lisenziyalarının yenilənməsi', description: '120 istifadəçi, 12 ay', vendor: 'Softline Azerbaijan', costCenterId: C('IT-02'), accountId: A('721-07'), fiscalYear: Y, month: Math.max(1, M - 2), amount: 12000, currency: 'USD' });
  approveAll(submitPr(user(it), d).workflow_instance_id!, 12);
  setClock(at(Y, Math.max(1, M - 1), 2));
  recordPrActual(user(fin), get('SELECT * FROM purchase_requests WHERE id = ?', d.id)!, { amount: 10200, month: Math.max(1, M - 1), description: 'Hesab-faktura №1 (50%)', close: false });
  // e. CAPEX: approved by finance, waiting for the CFO
  const e = pr(ops, at(Y, M, 3), { requestType: 'PURCHASE', title: 'Yük avtomobili (Ford Transit, soyuducu)', description: 'Logistika parkının yenilənməsi', vendor: 'Improtex Motors', costCenterId: C('LOG-02'), accountId: A('113-01'), fiscalYear: Y, month: Math.min(12, M + 1), amount: 72000, currency: 'AZN' });
  act(submitPr(user(ops), e).workflow_instance_id!, 'APPROVE', 'Büdcədə nəzərdə tutulub.', 1, 18);
  // f. rejected by the cost-center owner
  const f = pr(hrbp, at(Y, M - 1, 15), { requestType: 'PURCHASE', title: 'Liderlik təlimi — xarici təlimçi', description: '15 menecer üçün 3 günlük proqram', vendor: 'Leadership Academy', costCenterId: C('HR-02'), accountId: A('721-04'), fiscalYear: Y, month: M - 1, amount: 9500, currency: 'AZN' });
  act(submitPr(user(hrbp), f).workflow_instance_id!, 'REJECT', 'Bu il üçün təlim büdcəsi artıq bölüşdürülüb, növbəti ilin planına daxil edin.', 1, 8);
  // g. draft
  pr(emp, at(Y, M, 4), { requestType: 'EXPENSE', title: 'Sumqayıt — müştəri ziyarəti', description: null, vendor: null, costCenterId: C('SAL-01'), accountId: A('711-11'), fiscalYear: Y, month: M, amount: 120, currency: 'AZN' });

  // ---------------------------------------------------------------- budget change requests on the locked budget
  setClock(at(Y, M - 1, 20));
  const cur = (cc: string, acc: string, m: number) => listLines(user(fin), loadBudget(companyId, budget.id), null).filter((l) => l.costCenterCode === cc && l.accountCode === acc).reduce((s, l) => s + l.months[m - 1], 0);
  const m1 = Math.min(12, M);
  const cr1 = createCr(user(it), { budgetId: budget.id, costCenterId: C('IT-02'), title: 'Əlavə proqram lisenziyaları', reason: 'Yeni ERP modulu və 40 əlavə istifadəçi üçün lisenziyalar tələb olunur.', items: [{ accountId: A('721-07'), month: m1, requestedAmount: cur('IT-02', '721-07', m1) + 25000 }] });
  approveAll(submitCr(user(it), cr1).workflow_instance_id!, 22);
  setClock(at(Y, M, 3));
  const m2 = Math.min(12, M + 1);
  const cr2 = createCr(user(mkt), { budgetId: budget.id, costCenterId: C('MKT-02'), title: 'Noyabr sərgisi üçün əlavə büdcə', reason: 'Bakı Food Expo-da iştirak üçün stend və promo materiallar.', items: [{ accountId: A('711-05'), month: m2, requestedAmount: cur('MKT-02', '711-05', m2) + 15000 }] });
  act(submitCr(user(mkt), cr2).workflow_instance_id!, 'APPROVE', 'Maliyyə tərəfindən yoxlanıldı.', 1, 6);

  // ---------------------------------------------------------------- next-year budget in collection
  setClock(at(Y, M - 1 > 0 ? M - 1 : 1, 25, 9));
  const next = createBudget(user(fin), { fiscalYear: Y + 1, name: `Büdcə ${Y + 1}`, copyFromBudgetId: budget.id, upliftPct: 5 });
  setClock(at(Y, M - 1 > 0 ? M - 1 : 1, 26, 9));
  submitSection(user(hr), next, U('HR'));
  approveAll(sectionInstance(next.id, U('HR')), 20);
  setClock(at(Y, M, 1, 9));
  submitSection(user(it), next, U('IT'));
  setClock(at(Y, M, 1, 11));
  submitSection(user(sales), next, U('SAL'));
  act(sectionInstance(next.id, U('SAL')), 'RETURN', 'Ezamiyyə və yanacaq xərclərini ən azı 5% azaldın — bu il Satış büdcəni keçir.', 1, 26);
  setClock(at(Y, M, 2, 14));
  const logLine = listLines(user(ops), next, null).find((l) => l.costCenterCode === 'LOG-01' && l.accountCode === '711-07');
  if (logLine) updateLines(user(ops), next, [{ id: logLine.id, months: logLine.months.map((v) => Math.round(v * 1.08)) }]);
  void cfo;
}

/* ===================================================================== company 2 */

function seedQafqaz(Y: number): void {
  setClock(at(Y - 1, 12, 1, 9));
  const companyId = createCompany({
    name: 'Qafqaz Qida İstehsalat ASC', taxId: '1701234567', baseCurrency: 'AZN', defaultLanguage: 'az', plan: 'BUSINESS', maxUsers: 20,
    validUntil: `${Y + 1}-06-30`, admin: { fullName: 'Tamerlan Vəliyev', email: 'admin@qafqazqida.az', password: DEMO_PASSWORD },
  }, null);
  const adminId = get<{ id: number }>("SELECT id FROM users WHERE email = 'admin@qafqazqida.az'")!.id;
  applyTemplate(companyId, adminId, 'MANUFACTURING', { accounts: true, excludedAccountCodes: [], structure: true, costCenters: true, workflows: true, language: 'az' });
  const U = (c: string) => unitId(companyId, c);
  const ceo = addUser(companyId, 'ceo@qafqazqida.az', 'Vüqar Səfərov', 'CEO', { unit: U('EXEC') });
  const cfo = addUser(companyId, 'cfo@qafqazqida.az', 'Lalə Nəsirova', 'CFO', { unit: U('FIN'), manager: ceo });
  const fin = addUser(companyId, 'finance@qafqazqida.az', 'Kənan Əhmədov', 'FINANCE_MANAGER', { unit: U('FIN'), manager: cfo });
  const prod = addUser(companyId, 'production@qafqazqida.az', 'Ramin Hüseynli', 'DEPARTMENT_MANAGER', { unit: U('PRO'), manager: ceo, title: 'İstehsalat direktoru' });
  for (const [c, u] of [['ROOT', ceo], ['EXEC', ceo], ['FIN', cfo], ['PRD', prod], ['PRO', prod], ['MNT', prod], ['QC', prod]] as const) {
    run('UPDATE org_units SET head_user_id = ? WHERE company_id = ? AND code = ?', u, companyId, c);
  }
  run("UPDATE cost_centers SET owner_user_id = ? WHERE company_id = ? AND code IN ('PRD-01', 'PRD-02', 'PRD-09', 'MNT-01', 'QC-01')", prod, companyId);
  run("UPDATE cost_centers SET owner_user_id = ? WHERE company_id = ? AND owner_user_id IS NULL", cfo, companyId);
  const plan: Plan[] = [
    ['PRD-01', '701-01', 210000], ['PRD-01', '701-02', 38000], ['PRD-01', '701-03', 46000], ['PRD-01', '701-04', 21000],
    ['PRD-02', '701-01', 160000], ['PRD-02', '701-02', 29000], ['PRD-02', '701-03', 38000], ['PRD-02', '701-04', 17000],
    ['MNT-01', '701-06', 14000], ['MNT-01', '701-07', 9000], ['QC-01', '701-08', 7500], ['PRD-09', '113-01', 240000, [5]],
    ['WH-01', '711-04', 12000], ['SAL-01', '711-01', 18000], ['SAL-02', '711-03', 15000], ['MKT-01', '711-02', 11000],
    ['HR-01', '721-01', 9000], ['IT-01', '721-07', 4500], ['FIN-01', '721-01', 14000], ['FIN-01', '721-09', 3000],
  ];
  const budget = createBudget(user(fin), { fiscalYear: Y + 1, name: `Büdcə ${Y + 1}`, upliftPct: 0 });
  for (const p of plan) addLine(user(fin), budget, { costCenterId: ccId(companyId, p[0]), accountId: accId(companyId, p[1]), description: '', months: monthsFor(p) });
}

/* ===================================================================== company 3 */

function seedNew(Y: number): void {
  setClock(at(Y, 9, 1, 9));
  createCompany({
    name: 'Yeni Şirkət MMC', taxId: null, baseCurrency: 'AZN', defaultLanguage: 'az', plan: 'PILOT', maxUsers: 10,
    validUntil: `${Y + 1}-03-31`, admin: { fullName: 'Aynur Quliyeva', email: 'setup@demo.az', password: DEMO_PASSWORD },
  }, null);
}

export function seedDemo(): void {
  getDb();
  syncTemplates();
  const real = new Date();
  const Y = real.getFullYear();
  const M = Math.max(3, real.getMonth() + 1);
  try {
    run("INSERT INTO users (company_id, email, full_name, password_hash, role, created_at) VALUES (NULL, ?, 'FinBridge Operator', ?, 'SUPER_ADMIN', ?)",
      PLATFORM_ADMIN.email, hashPassword(PLATFORM_ADMIN.password), new Date().toISOString());
    seedXezer(Y, M);
    seedQafqaz(Y);
    seedNew(Y);
  } finally {
    setClock(null);
  }
}

// Run as a script: `npm run db:seed`
if (process.argv[1]?.endsWith('seed.ts')) {
  getDb();
  const existing = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  if (existing > 0) {
    console.log('Database already has data — skipping seed. Use "npm run db:reset" to start over.');
  } else {
    seedDemo();
    console.log('Demo data created (password for all demo users: Demo1234!).');
    console.log(`  Platform operator: ${PLATFORM_ADMIN.email} / ${PLATFORM_ADMIN.password}`);
    for (const c of all<{ name: string; id: number }>('SELECT id, name FROM companies ORDER BY id')) {
      console.log(`  ${c.name}`);
      for (const u of all<{ email: string; role: string }>('SELECT email, role FROM users WHERE company_id = ? ORDER BY id', c.id)) console.log(`    ${u.role.padEnd(20)} ${u.email}`);
    }
  }
}
