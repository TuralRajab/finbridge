import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetCheck, can, computeVariance, consumption, evaluateCondition, fieldFromHeader, monthFromHeader, toBase, type Condition } from '@finbridge/shared';
import { TEMPLATES } from '../src/templates/data';

test('rules engine: thresholds, membership and nesting', () => {
  const gte10k: Condition = { all: [{ field: 'amount', op: 'gte', value: 10000 }] };
  assert.equal(evaluateCondition(gte10k, { amount: 9999.99 }), false);
  assert.equal(evaluateCondition(gte10k, { amount: 10000 }), true);
  const hr: Condition = { all: [{ field: 'department', op: 'in', value: ['HR'] }] };
  assert.equal(evaluateCondition(hr, { department: 'hr' }), true, 'codes are case-insensitive');
  assert.equal(evaluateCondition(hr, { department: 'IT' }), false);
  const under: Condition = { all: [{ field: 'orgUnit', op: 'in', value: ['SUP'] }] };
  assert.equal(evaluateCondition(under, { orgUnit: ['HR', 'SUP', 'ROOT'] }), true, 'matches any ancestor');
  const capexBig: Condition = { all: [{ field: 'expenseClass', op: 'eq', value: 'CAPEX' }, { any: [{ field: 'amount', op: 'gt', value: 50000 }, { field: 'branch', op: 'eq', value: 'BR-GNC' }] }] };
  assert.equal(evaluateCondition(capexBig, { expenseClass: 'CAPEX', amount: 1000, branch: 'BR-GNC' }), true);
  assert.equal(evaluateCondition(capexBig, { expenseClass: 'OPEX', amount: 90000 }), false);
  assert.equal(evaluateCondition(null, {}), true, 'no condition = always');
  assert.equal(evaluateCondition({ not: hr }, { department: 'IT' }), true);
});

test('funds check: within / near / over', () => {
  assert.equal(budgetCheck(100000, 75000, 20000).state, 'NEAR'); // 95% ≥ 90%
  assert.equal(budgetCheck(100000, 50000, 20000).state, 'WITHIN');
  assert.equal(budgetCheck(100000, 75000, 30000).state, 'OVER');
  assert.equal(budgetCheck(0, 0, 10).state, 'OVER', 'unbudgeted spend is over budget');
  const r = budgetCheck(100000, 75000, 20000, 96);
  assert.equal(r.state, 'WITHIN');
  assert.equal(r.available, 25000);
  assert.equal(r.availableAfter, 5000);
});

test('consumption measures', () => {
  const c = consumption({ budget: 1_000_000, actual: 600_000, committed: 150_000, pending: 0 });
  assert.equal(c.available, 250_000);
  assert.equal(c.consumptionPct, 75);
  assert.deepEqual(computeVariance(500_000, 540_000), { variance: 40_000, variancePct: 8 });
  assert.equal(toBase(12000, 1.7), 20400);
});

test('roles: approval is not a role permission; employees only raise requests', () => {
  assert.ok(can('EMPLOYEE', 'request.create'));
  assert.ok(!can('EMPLOYEE', 'budget.view'));
  assert.ok(!can('VIEWER', 'budget.edit'));
  assert.ok(!can('CFO', 'budget.edit'));
  assert.ok(can('FINANCE_MANAGER', 'workflow.manage'));
  assert.ok(!can('DEPARTMENT_MANAGER', 'workflow.manage'));
});

test('Excel header auto-mapping (AZ + EN)', () => {
  assert.equal(fieldFromHeader('CC code'), 'costCenterCode');
  assert.equal(fieldFromHeader('Xərc mərkəzi kodu'), 'costCenterCode');
  assert.equal(fieldFromHeader('GL account'), 'accountCode');
  assert.equal(monthFromHeader('İyun'), 6);
  assert.equal(monthFromHeader('Dec'), 12);
  assert.equal(monthFromHeader('Total'), null);
});

test('industry templates: ~40 realistic, unique, well-formed accounts each', () => {
  const required = ['BANKING', 'SALES_DISTRIBUTION', 'INDUSTRY', 'MANUFACTURING', 'AGRICULTURE', 'SERVICES'];
  for (const code of required) {
    const t = TEMPLATES.find((x) => x.code === code)!;
    assert.ok(t, code);
    const leaves = t.accounts.filter((a) => !a.isGroup);
    assert.ok(leaves.length >= 38 && leaves.length <= 48, `${code}: ${leaves.length} leaf accounts`);
    const codes = new Set(t.accounts.map((a) => a.code));
    assert.equal(codes.size, t.accounts.length, `${code}: duplicate codes`);
    for (const a of t.accounts) {
      if (a.parentCode) assert.ok(codes.has(a.parentCode), `${code}: ${a.code} has unknown parent`);
      assert.doesNotMatch(a.nameEn, /^Account \d+$/);
    }
    assert.ok(t.accounts.some((a) => a.accountType === 'CAPEX'), `${code}: has CAPEX`);
    assert.ok(t.content.costCenters.every((c) => t.content.units.some((u) => u.code === c.unit)), `${code}: cost centers reference template units`);
  }
});
