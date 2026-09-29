import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canEditBudgetLines, canRunBudgetAction, canRunDeptAction, computeVariance, fieldFromHeader, forecastFullYear,
  monthFromHeader, sumMonths, can,
} from '@finbridge/shared';

test('variance is actual minus budget, percentage vs budget', () => {
  assert.deepEqual(computeVariance(500_000, 540_000), { variance: 40_000, variancePct: 8 });
  assert.deepEqual(computeVariance(250_000, 230_000), { variance: -20_000, variancePct: -8 });
  assert.equal(computeVariance(0, 100).variancePct, null);
});

test('year-to-date sums and forecast', () => {
  const months = Array.from({ length: 12 }, () => 100);
  assert.equal(sumMonths(months, 8), 800);
  assert.equal(forecastFullYear(900, months, 8, 'budget'), 1300);
  assert.equal(forecastFullYear(900, months, 8, 'run_rate'), 1350);
  assert.equal(forecastFullYear(0, months, 0), 1200);
});

test('role permissions follow the MVP matrix', () => {
  assert.ok(can('CFO', 'budget.approve'));
  assert.ok(!can('FINANCE_MANAGER', 'budget.approve'));
  assert.ok(!can('VIEWER', 'budget.edit'));
  assert.ok(!can('COST_CENTER_OWNER', 'budget.submit'));
  assert.ok(can('DEPARTMENT_MANAGER', 'budget.submit'));
});

test('workflow transitions', () => {
  assert.ok(canRunBudgetAction('FINANCE_MANAGER', 'DRAFT', 'open'));
  assert.ok(!canRunBudgetAction('FINANCE_MANAGER', 'CFO_REVIEW', 'approve'));
  assert.ok(canRunBudgetAction('CFO', 'CFO_REVIEW', 'approve'));
  assert.ok(canRunDeptAction('DEPARTMENT_MANAGER', 'COLLECTING', 'CHANGES_REQUESTED', 'submit'));
  assert.ok(!canRunDeptAction('DEPARTMENT_MANAGER', 'COLLECTING', 'SUBMITTED', 'review'));
});

test('who may edit lines when', () => {
  assert.ok(canEditBudgetLines('FINANCE_MANAGER', 'DRAFT', null));
  assert.ok(!canEditBudgetLines('DEPARTMENT_MANAGER', 'DRAFT', null));
  assert.ok(canEditBudgetLines('DEPARTMENT_MANAGER', 'COLLECTING', 'CHANGES_REQUESTED'));
  assert.ok(!canEditBudgetLines('DEPARTMENT_MANAGER', 'COLLECTING', 'SUBMITTED'));
  assert.ok(!canEditBudgetLines('FINANCE_MANAGER', 'LOCKED', 'REVIEWED'));
});

test('Excel header auto-mapping (AZ + EN)', () => {
  assert.equal(fieldFromHeader('CC code'), 'costCenterCode');
  assert.equal(fieldFromHeader('Xərc mərkəzi kodu'), 'costCenterCode');
  assert.equal(fieldFromHeader('GL account'), 'accountCode');
  assert.equal(fieldFromHeader('Dept'), 'departmentCode');
  assert.equal(monthFromHeader('Jan'), 1);
  assert.equal(monthFromHeader('Dekabr'), 12);
  assert.equal(monthFromHeader('İyun'), 6);
  assert.equal(monthFromHeader('M03'), 3);
  assert.equal(monthFromHeader('Total'), null);
});
