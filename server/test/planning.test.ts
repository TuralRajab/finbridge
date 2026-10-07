/**
 * Planning comparison (prior years' budget / actual vs the plan being drafted) over the HTTP API, on an in-memory
 * database filled by the demo seed (Xəzər: Y-2 and Y-1 complete, Y partial, Y+1 draft in collection).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { PlanningComparisonDto, PlanningMonthlyDto, PlanningRow } from '@finbridge/shared';
import { createApp } from '../src/app';
import { all, get, openDatabase, useDatabase } from '../src/db/database';
import { DEMO_PASSWORD, seedDemo } from '../src/db/seed';
import { setClock } from '../src/lib/clock';

useDatabase(openDatabase(':memory:'));
seedDemo();

const Y = new Date().getFullYear();
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const tokens: Record<string, string> = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const email of ['finance@demo.az', 'marketing.manager@demo.az']) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
    assert.equal(r.status, 200);
    tokens[email] = ((await r.json()) as { token: string }).token;
  }
});
after(() => { server.close(); setClock(null); });

async function call<T>(who: string, path: string): Promise<{ status: number; data: T }> {
  const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } });
  return { status: r.status, data: (await r.json()) as T };
}
async function ok<T>(who: string, path: string): Promise<T> {
  const r = await call<T>(who, path);
  assert.equal(r.status, 200, `${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

const FIN = 'finance@demo.az';
const MKT = 'marketing.manager@demo.az';
const company = () => get<{ id: number }>("SELECT id FROM companies WHERE name = 'Xəzər Distribusiya MMC'")!.id;
const budgetOf = (year: number) => get<{ id: number; current_version_id: number; approved_version_id: number | null }>('SELECT * FROM budgets WHERE company_id = ? AND fiscal_year = ?', company(), year)!;
const SUM = Array.from({ length: 12 }, (_, i) => `m${i + 1}`).join(' + ');
const versionTotal = (vid: number) => get<{ t: number }>(`SELECT ROUND(SUM(${SUM}), 2) AS t FROM budget_lines WHERE version_id = ?`, vid)!.t;
const actualTotal = (year: number, through = 12) => get<{ t: number }>('SELECT ROUND(SUM(amount), 2) AS t FROM actuals WHERE company_id = ? AND fiscal_year = ? AND month <= ?', company(), year, through)!.t;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.05, `${a} ≈ ${b}`);
const sumRows = (rows: PlanningRow[], f: (r: PlanningRow) => number) => rows.reduce((s, r) => s + f(r), 0);

describe('planning comparison', () => {
  test('history rows: prior years with original / final budget and actuals, totals', async () => {
    const next = budgetOf(Y + 1);
    const d = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?years=3`);
    assert.equal(d.fiscalYear, Y + 1);
    assert.equal(d.versionStatus, 'DRAFT');
    assert.deepEqual(d.years.map((y) => y.year), [Y, Y - 1, Y - 2]);
    assert.ok(d.companyWide);
    // Y-1 and Y-2 are complete, approved and locked
    for (const info of d.years.slice(1)) {
      assert.equal(info.complete, true);
      assert.equal(info.monthsWithActuals, 12);
      assert.equal(info.versionStatus, 'LOCKED');
      assert.ok(info.approvedVersionId);
    }
    const prev = budgetOf(Y - 1);
    const t1 = d.totals.years[1];
    close(t1.finalBudget, versionTotal(prev.current_version_id));
    close(t1.originalBudget, versionTotal(prev.approved_version_id!));
    assert.ok(t1.finalBudget > t1.originalBudget, 'Y-1 change request raised the final budget');
    close(t1.actual, actualTotal(Y - 1));
    assert.equal(t1.fullYear, t1.actual);
    assert.equal(t1.isForecast, false);
    close(d.totals.plan, versionTotal(next.current_version_id));
    // rows add up to the totals
    assert.ok(d.rows.length >= 6);
    close(sumRows(d.rows, (r) => r.plan), d.totals.plan);
    close(sumRows(d.rows, (r) => r.years[2].actual), d.totals.years[2].actual);
    // deltas
    const r = d.rows.find((x) => x.code === 'SAL')!;
    close(r.vsLastActual.abs, r.plan - r.years[0].fullYear);
    close(r.vsLastBudget.abs, r.plan - r.years[0].finalBudget);
    assert.equal(r.vsLastActual.pct, Math.round(((r.plan - r.years[0].fullYear) / r.years[0].fullYear) * 1000) / 10);
  });

  test('partial-year forecast: actual + remaining budget, or run-rate', async () => {
    const next = budgetOf(Y + 1);
    const cur = budgetOf(Y);
    const d = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?years=1`);
    const info = d.years[0];
    assert.equal(info.year, Y);
    assert.equal(info.complete, false);
    const last = info.monthsWithActuals;
    assert.ok(last >= 1 && last < 12);
    const remaining = get<{ t: number }>(`SELECT ROUND(SUM(${Array.from({ length: 12 - last }, (_, i) => `m${last + 1 + i}`).join(' + ')}), 2) AS t FROM budget_lines WHERE version_id = ?`, cur.current_version_id)!.t;
    const ytd = actualTotal(Y, last);
    const t = d.totals.years[0];
    assert.equal(t.isForecast, true);
    close(t.actual, ytd);
    close(t.fullYear, ytd + remaining);
    assert.equal(d.forecastMethod, 'budget');
    const rr = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?years=1&forecast=run_rate`);
    assert.equal(rr.forecastMethod, 'run_rate');
    close(rr.totals.years[0].fullYear, Math.round((ytd / last) * 12 * 100) / 100);
  });

  test('drill-down: section → cost centers → accounts adds up; lines carry last-year months', async () => {
    const next = budgetOf(Y + 1);
    const top = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning`);
    const sal = top.rows.find((r) => r.code === 'SAL')!;
    const ccs = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?groupBy=costCenter&unitId=${sal.id}`);
    assert.ok(ccs.rows.every((r) => r.kind === 'costCenter' && r.code.startsWith('SAL')));
    assert.equal(ccs.path[0].level, 'section');
    close(ccs.totals.plan, sal.plan);
    close(ccs.totals.years[0].fullYear, sal.years[0].fullYear);
    const cc = ccs.rows[0];
    const accs = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?groupBy=account&unitId=${sal.id}&costCenterId=${cc.id}`);
    assert.equal(accs.path.length, 2);
    close(sumRows(accs.rows, (r) => r.years[1].actual), cc.years[1].actual);
    const lines = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?groupBy=line&costCenterId=${cc.id}`);
    for (const l of lines.rows) {
      assert.equal(l.lastYearMonths?.length, 12);
      close(l.lastYearMonths!.reduce((s, v) => s + v, 0), l.years[0].fullYear);
    }
  });

  test('object scope: a department head only sees their own department', async () => {
    const next = budgetOf(Y + 1);
    const mine = await ok<PlanningComparisonDto>(MKT, `/budgets/${next.id}/planning`);
    assert.equal(mine.companyWide, false);
    assert.deepEqual(mine.rows.map((r) => r.code), ['MKT']);
    const ccs = await ok<PlanningComparisonDto>(MKT, `/budgets/${next.id}/planning?groupBy=costCenter`);
    assert.ok(ccs.rows.length > 0 && ccs.rows.every((r) => r.code.startsWith('MKT')));
    const all_ = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning`);
    const mktRow = all_.rows.find((r) => r.code === 'MKT')!;
    close(mine.totals.plan, mktRow.plan);
    close(mine.totals.years[0].actual, mktRow.years[0].actual);
    // drilling into someone else's department or cost center is refused
    const sal = all_.rows.find((r) => r.code === 'SAL')!;
    assert.equal((await call(MKT, `/budgets/${next.id}/planning?groupBy=costCenter&unitId=${sal.id}`)).status, 403);
    const salCc = all<{ id: number }>("SELECT id FROM cost_centers WHERE company_id = ? AND code = 'SAL-01'", company())[0].id;
    assert.equal((await call(MKT, `/budgets/${next.id}/planning/monthly?costCenterId=${salCc}`)).status, 403);
  });

  test('monthly series per prior year and the plan for a selected row', async () => {
    const next = budgetOf(Y + 1);
    const top = await ok<PlanningComparisonDto>(FIN, `/budgets/${next.id}/planning?years=2`);
    const mkt = top.rows.find((r) => r.code === 'MKT')!;
    const m = await ok<PlanningMonthlyDto>(FIN, `/budgets/${next.id}/planning/monthly?years=2&unitId=${mkt.id}`);
    assert.equal(m.plan.length, 12);
    assert.deepEqual(m.years.map((y) => y.year), [Y, Y - 1]);
    close(m.plan.reduce((s, v) => s + v, 0), mkt.plan);
    const cur = m.years[0];
    assert.equal(cur.actual.filter((v) => v !== null).length, cur.monthsWithActuals);
    assert.equal(cur.actual[11], null);
    close(m.years[1].actual.reduce<number>((s, v) => s + (v ?? 0), 0), mkt.years[1].actual);
    close(m.years[1].budget.reduce((s, v) => s + v, 0), mkt.years[1].finalBudget);
    // marketing is seasonal: Q4 above Q1 in last year's actuals
    const a = m.years[1].actual as number[];
    assert.ok(a[9] + a[10] + a[11] > a[0] + a[1] + a[2]);
  });

  test('validation: years 1..3 and known groupBy', async () => {
    const next = budgetOf(Y + 1);
    assert.equal((await call(FIN, `/budgets/${next.id}/planning?years=4`)).status, 400);
    assert.equal((await call(FIN, `/budgets/${next.id}/planning?groupBy=foo`)).status, 400);
  });
});
