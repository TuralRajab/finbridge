/**
 * Demo data: one platform operator and one licensed company with 5 departments,
 * 15 cost centers, a locked 2026 budget with Jan–Aug actuals, and a 2027 budget in collection.
 *
 *   npm run db:seed            # seeds an empty database
 *   npm run db:reset           # wipes the database and seeds again
 */
import { hashPassword } from '../auth/password';
import { MONTH_COLS } from '../services/budgets';
import { get, getDb, run, tx } from './database';

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

const DEPARTMENTS = [
  { code: 'HR', name: 'İnsan resursları', manager: 'hr' },
  { code: 'IT', name: 'İnformasiya texnologiyaları', manager: 'it' },
  { code: 'SAL', name: 'Satış', manager: 'sales' },
  { code: 'OPS', name: 'Əməliyyatlar', manager: 'ops' },
  { code: 'MKT', name: 'Marketinq', manager: 'marketing' },
] as const;

const COST_CENTERS = [
  { code: 'HR-01', dept: 'HR', name: 'İşə qəbul', accounts: ['6110', '6320', '6710'] },
  { code: 'HR-02', dept: 'HR', name: 'Təlim və inkişaf', accounts: ['6320', '6310'] },
  { code: 'HR-03', dept: 'HR', name: 'Əmək haqqı administrasiyası', accounts: ['6110', '6120'] },
  { code: 'IT-01', dept: 'IT', name: 'İnfrastruktur', accounts: ['6420', '6220', '1210'] },
  { code: 'IT-02', dept: 'IT', name: 'Proqram təminatı lisenziyaları', accounts: ['6410'] },
  { code: 'IT-03', dept: 'IT', name: 'İstifadəçi dəstəyi', accounts: ['6110', '6120', '6710'] },
  { code: 'SAL-01', dept: 'SAL', name: 'Sahə satışları', accounts: ['6110', '6120', '6310', '6610'] },
  { code: 'SAL-02', dept: 'SAL', name: 'Əsas müştərilər', accounts: ['6110', '6310'] },
  { code: 'SAL-03', dept: 'SAL', name: 'Satış dəstəyi', accounts: ['6110', '6710'] },
  { code: 'OPS-01', dept: 'OPS', name: 'Anbar', accounts: ['6210', '6220', '6110', '1230'] },
  { code: 'OPS-02', dept: 'OPS', name: 'Logistika', accounts: ['6610', '6110'] },
  { code: 'OPS-03', dept: 'OPS', name: 'Avtopark', accounts: ['6610', '1220'] },
  { code: 'MKT-01', dept: 'MKT', name: 'Rəqəmsal marketinq', accounts: ['6510'] },
  { code: 'MKT-02', dept: 'MKT', name: 'Tədbirlər', accounts: ['6510', '6310'] },
  { code: 'MKT-03', dept: 'MKT', name: 'Brend', accounts: ['6510', '6110'] },
] as const;

const ACCOUNTS: { code: string; name: string; type: 'OPEX' | 'CAPEX'; base: number }[] = [
  { code: '6110', name: 'Əmək haqqı', type: 'OPEX', base: 14000 },
  { code: '6120', name: 'Sosial ayırmalar', type: 'OPEX', base: 3000 },
  { code: '6210', name: 'İcarə', type: 'OPEX', base: 6500 },
  { code: '6220', name: 'Kommunal xərclər', type: 'OPEX', base: 1800 },
  { code: '6310', name: 'Ezamiyyə xərcləri', type: 'OPEX', base: 2600 },
  { code: '6320', name: 'Təlim xərcləri', type: 'OPEX', base: 1500 },
  { code: '6410', name: 'Proqram təminatı və lisenziyalar', type: 'OPEX', base: 5200 },
  { code: '6420', name: 'İT xidmətləri', type: 'OPEX', base: 3200 },
  { code: '6510', name: 'Reklam və marketinq', type: 'OPEX', base: 4800 },
  { code: '6610', name: 'Yanacaq və nəqliyyat', type: 'OPEX', base: 3900 },
  { code: '6710', name: 'Ofis ləvazimatları', type: 'OPEX', base: 600 },
  { code: '1210', name: 'Kompüter avadanlığı', type: 'CAPEX', base: 4000 },
  { code: '1220', name: 'Nəqliyyat vasitələri', type: 'CAPEX', base: 9000 },
  { code: '1230', name: 'Anbar avadanlığı', type: 'CAPEX', base: 5000 },
];

const USERS = [
  { key: 'admin', email: 'admin@demo.az', name: 'Rəşad Məmmədov', role: 'ADMIN' },
  { key: 'cfo', email: 'cfo@demo.az', name: 'Elçin Quliyev', role: 'CFO' },
  { key: 'finance', email: 'finance@demo.az', name: 'Leyla Hüseynova', role: 'FINANCE_MANAGER' },
  { key: 'hr', email: 'hr.manager@demo.az', name: 'Nigar Əliyeva', role: 'DEPARTMENT_MANAGER', dept: 'HR' },
  { key: 'it', email: 'it.manager@demo.az', name: 'Tural Babayev', role: 'DEPARTMENT_MANAGER', dept: 'IT' },
  { key: 'sales', email: 'sales.manager@demo.az', name: 'Kamran İsmayılov', role: 'DEPARTMENT_MANAGER', dept: 'SAL' },
  { key: 'ops', email: 'ops.manager@demo.az', name: 'Orxan Həsənov', role: 'DEPARTMENT_MANAGER', dept: 'OPS' },
  { key: 'marketing', email: 'marketing.manager@demo.az', name: 'Aysel Rzayeva', role: 'DEPARTMENT_MANAGER', dept: 'MKT' },
  { key: 'ccowner', email: 'field.sales@demo.az', name: 'Samir Novruzov', role: 'COST_CENTER_OWNER', dept: 'SAL' },
  { key: 'viewer', email: 'viewer@demo.az', name: 'Günel Kərimova', role: 'VIEWER' },
] as const;

export function seedDemo(): { companyId: number } {
  getDb();
  return tx(() => {
    const random = rng(2026);
    const nextYear = new Date().getFullYear() + 1;
    run(
      "INSERT INTO users (company_id, email, full_name, password_hash, role) VALUES (NULL, ?, 'FinBridge Operator', ?, 'SUPER_ADMIN')",
      PLATFORM_ADMIN.email, hashPassword(PLATFORM_ADMIN.password),
    );
    const companyId = run(
      "INSERT INTO companies (name, tax_id, license_plan, license_max_users, license_valid_until) VALUES ('Xəzər Distribusiya MMC', '1400000000', 'BUSINESS', 25, ?)",
      `${nextYear}-12-31`,
    ).lastInsertRowid;

    const pw = hashPassword(DEMO_PASSWORD);
    const userIds: Record<string, number> = {};
    for (const u of USERS) {
      userIds[u.key] = run(
        'INSERT INTO users (company_id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        companyId, u.email, u.name, pw, u.role,
      ).lastInsertRowid;
    }
    const deptIds: Record<string, number> = {};
    for (const d of DEPARTMENTS) {
      deptIds[d.code] = run('INSERT INTO departments (company_id, code, name, manager_id) VALUES (?, ?, ?, ?)', companyId, d.code, d.name, userIds[d.manager]).lastInsertRowid;
    }
    for (const u of USERS) {
      if ('dept' in u) run('UPDATE users SET department_id = ? WHERE id = ?', deptIds[u.dept], userIds[u.key]);
    }
    const accIds: Record<string, number> = {};
    for (const a of ACCOUNTS) accIds[a.code] = run('INSERT INTO accounts (company_id, code, name, type) VALUES (?, ?, ?, ?)', companyId, a.code, a.name, a.type).lastInsertRowid;
    const ccIds: Record<string, number> = {};
    for (const c of COST_CENTERS) {
      ccIds[c.code] = run(
        'INSERT INTO cost_centers (company_id, department_id, code, name, owner_id) VALUES (?, ?, ?, ?, ?)',
        companyId, deptIds[c.dept], c.code, c.name, c.code === 'SAL-01' ? userIds.ccowner : null,
      ).lastInsertRowid;
    }

    const insertLine = `INSERT INTO budget_lines (budget_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, updated_by)
                        VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?)`;

    // ---- current year: approved and locked, actuals Jan–Aug
    const year = nextYear - 1;
    const b1 = run(
      "INSERT INTO budgets (company_id, year, name, status, created_by, approved_by, approved_at, locked_at) VALUES (?, ?, ?, 'LOCKED', ?, ?, ?, ?)",
      companyId, year, `Büdcə ${year}`, userIds.finance, userIds.cfo, `${year - 1}-12-20 10:00:00`, `${year - 1}-12-22 09:00:00`,
    ).lastInsertRowid;
    const planned: { cc: string; acc: string; months: number[] }[] = [];
    for (const c of COST_CENTERS) {
      for (const accCode of c.accounts) {
        const acc = ACCOUNTS.find((a) => a.code === accCode)!;
        const base = Math.round(acc.base * (0.6 + random() * 0.9));
        const months = MONTH_COLS.map((_, i) => {
          if (acc.type === 'CAPEX') return i === 2 || i === 8 ? base * 3 : 0;
          const season = accCode === '6510' ? [0.7, 0.8, 1.1, 1.2, 1.1, 0.9, 0.8, 0.8, 1.1, 1.2, 1.3, 1.5][i] : 1;
          return Math.round(base * season);
        });
        planned.push({ cc: c.code, acc: accCode, months });
        run(insertLine, b1, ccIds[c.code], accIds[accCode], acc.name, ...months, userIds.finance);
      }
    }
    for (const d of Object.values(deptIds)) {
      run("INSERT INTO budget_departments (budget_id, department_id, status, submitted_at, reviewed_at) VALUES (?, ?, 'REVIEWED', ?, ?)",
        b1, d, `${year - 1}-11-25 12:00:00`, `${year - 1}-12-05 12:00:00`);
    }
    const event = 'INSERT INTO budget_events (budget_id, department_id, user_id, action, from_status, to_status, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    run(event, b1, null, userIds.finance, 'created', null, 'DRAFT', null, `${year - 1}-10-01 09:00:00`);
    run(event, b1, null, userIds.finance, 'open', 'DRAFT', 'COLLECTING', null, `${year - 1}-10-02 09:00:00`);
    run(event, b1, null, userIds.finance, 'submit_to_cfo', 'COLLECTING', 'CFO_REVIEW', null, `${year - 1}-12-10 09:00:00`);
    run(event, b1, null, userIds.cfo, 'approve', 'CFO_REVIEW', 'APPROVED', 'Təsdiq edildi.', `${year - 1}-12-20 10:00:00`);
    run(event, b1, null, userIds.finance, 'lock', 'APPROVED', 'LOCKED', null, `${year - 1}-12-22 09:00:00`);

    // Actuals: Sales and HR overspend, IT saves — so Plan vs Actual has a story.
    const drift: Record<string, number> = { HR: 1.07, IT: 0.92, SAL: 1.08, OPS: 1.01, MKT: 0.97 };
    const upsert = "INSERT INTO actuals (company_id, year, month, cost_center_id, account_id, amount, source, updated_by) VALUES (?, ?, ?, ?, ?, ?, 'excel', ?)";
    for (const p of planned) {
      const dept = COST_CENTERS.find((c) => c.code === p.cc)!.dept;
      for (let m = 1; m <= 8; m++) {
        const planMonth = p.months[m - 1];
        if (!planMonth) continue;
        const amount = Math.round(planMonth * drift[dept] * (0.94 + random() * 0.12));
        run(upsert, companyId, year, m, ccIds[p.cc], accIds[p.acc], amount, userIds.finance);
      }
    }

    // ---- next year: in collection, departments at different steps
    const b2 = run("INSERT INTO budgets (company_id, year, name, status, created_by) VALUES (?, ?, ?, 'COLLECTING', ?)",
      companyId, nextYear, `Büdcə ${nextYear}`, userIds.finance).lastInsertRowid;
    for (const p of planned) {
      const months = p.months.map((m) => Math.round(m * 1.05));
      run(insertLine, b2, ccIds[p.cc], accIds[p.acc], ACCOUNTS.find((a) => a.code === p.acc)!.name, ...months, userIds.finance);
    }
    const status: Record<string, string> = { HR: 'REVIEWED', IT: 'SUBMITTED', SAL: 'CHANGES_REQUESTED', OPS: 'IN_PROGRESS', MKT: 'NOT_STARTED' };
    for (const [code, s] of Object.entries(status)) {
      run('INSERT INTO budget_departments (budget_id, department_id, status, submitted_at) VALUES (?, ?, ?, ?)',
        b2, deptIds[code], s, ['SUBMITTED', 'REVIEWED', 'CHANGES_REQUESTED'].includes(s) ? `${year}-09-20 11:00:00` : null);
    }
    run(event, b2, null, userIds.finance, 'created', null, 'DRAFT', `Copied from ${year} (+5%)`, `${year}-09-01 09:00:00`);
    run(event, b2, null, userIds.finance, 'open', 'DRAFT', 'COLLECTING', null, `${year}-09-02 09:00:00`);
    run(event, b2, deptIds.HR, userIds.hr, 'submit', 'IN_PROGRESS', 'SUBMITTED', null, `${year}-09-15 11:00:00`);
    run(event, b2, deptIds.HR, userIds.finance, 'review', 'SUBMITTED', 'REVIEWED', null, `${year}-09-18 11:00:00`);
    run(event, b2, deptIds.IT, userIds.it, 'submit', 'IN_PROGRESS', 'SUBMITTED', null, `${year}-09-20 11:00:00`);
    run(event, b2, deptIds.SAL, userIds.sales, 'submit', 'IN_PROGRESS', 'SUBMITTED', null, `${year}-09-19 11:00:00`);
    run(event, b2, deptIds.SAL, userIds.finance, 'request_changes', 'SUBMITTED', 'CHANGES_REQUESTED',
      'Ezamiyyə xərclərini 5% azaltmaq mümkündürmü? Bu il Satış büdcəni artıq keçib.', `${year}-09-21 11:00:00`);
    return { companyId };
  });
}

// Run as a script: `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  const existing = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  if (existing > 0) {
    console.log('Database already has data — skipping seed. Use "npm run db:reset" to start over.');
  } else {
    seedDemo();
    console.log('Demo data created.');
    console.log(`  Platform operator: ${PLATFORM_ADMIN.email} / ${PLATFORM_ADMIN.password}`);
    console.log(`  Company users (password ${DEMO_PASSWORD}):`);
    for (const u of USERS) console.log(`    ${u.role.padEnd(20)} ${u.email}`);
  }
}
