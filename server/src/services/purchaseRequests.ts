import { userCan } from '../lib/permissions';
import {
  can, REQUEST_EDITABLE, toBase,
  type PurchaseRequestDto, type RequestStatus, type RequestType,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { getScope, type Scope } from '../lib/scope';
import { AccountIndex } from './accounts';
import { findBudgetByYear } from './budgets';
import { checkBudget } from './consumption';
import { rateFor } from './currency';
import { OrgIndex } from './org';
import { companyRow } from './settings';
import { cancelInstance, isParticipant, registerHandler, startWorkflow, type InstanceRow } from './workflowEngine';

export interface PrRow {
  id: number; company_id: number; number: string; request_type: RequestType; title: string; description: string | null; vendor: string | null;
  cost_center_id: number; account_id: number; budget_id: number | null; fiscal_year: number; month: number; amount: number; currency: string;
  exchange_rate: number; amount_base: number; status: RequestStatus; budget_state: PurchaseRequestDto['budgetState']; available_at_submit: number | null;
  workflow_instance_id: number | null; requested_by: number; created_at: string; updated_at: string; submitted_at: string | null; decided_at: string | null;
}

export interface PrInput {
  requestType: RequestType;
  title: string;
  description: string | null;
  vendor: string | null;
  costCenterId: number;
  accountId: number;
  fiscalYear: number;
  month: number;
  amount: number;
  currency: string;
}

function nextNumber(companyId: number, prefix: string, year: number, table: 'purchase_requests' | 'budget_change_requests'): string {
  const n = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND number LIKE ?`, companyId, `${prefix}-${year}-%`)?.n ?? 0;
  return `${prefix}-${year}-${String(n + 1).padStart(4, '0')}`;
}
export { nextNumber };

export function loadPr(companyId: number, id: number): PrRow {
  const p = get<PrRow>('SELECT * FROM purchase_requests WHERE id = ? AND company_id = ?', id, companyId);
  if (!p) throw notFound('Request');
  return p;
}

export function canViewPr(user: UserRow, pr: PrRow, scope: Scope): boolean {
  if (scope.all) return true;
  if (pr.requested_by === user.id) return true;
  if (!scope.ownRequestsOnly && scope.costCenterIds.has(pr.cost_center_id)) return true;
  return pr.workflow_instance_id !== null && all<{ id: number }>('SELECT id FROM workflow_instances WHERE entity_type = ? AND entity_id = ?', 'PURCHASE_REQUEST', pr.id)
    .some((i) => isParticipant(user.id, i.id));
}

function validate(user: UserRow, input: PrInput, scope: Scope): { rate: number } {
  if (!userCan(user, 'request.create')) throw forbidden();
  const org = OrgIndex.load(user.company_id!);
  const cc = org.cc(input.costCenterId);
  if (!cc.isActive) throw badRequest('VALIDATION_ERROR', 'Cost center is inactive');
  if (!scope.all && !scope.requestCostCenterIds.has(cc.id)) throw forbidden('You cannot raise requests on this cost center');
  AccountIndex.load(user.company_id!).assertUsable(input.accountId, cc.id, 'request');
  return { rate: rateFor(user.company_id!, input.currency) };
}

export function createPr(user: UserRow, input: PrInput): PrRow {
  const companyId = user.company_id!;
  const scope = getScope(user);
  const { rate } = validate(user, input, scope);
  return tx(() => {
    const ts = nowIso();
    const budget = findBudgetByYear(companyId, input.fiscalYear);
    const id = run(
      `INSERT INTO purchase_requests (company_id, number, request_type, title, description, vendor, cost_center_id, account_id, budget_id, fiscal_year, month,
         amount, currency, exchange_rate, amount_base, status, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
      companyId, nextNumber(companyId, input.requestType === 'EXPENSE' ? 'ER' : 'PR', input.fiscalYear, 'purchase_requests'), input.requestType,
      input.title, input.description, input.vendor, input.costCenterId, input.accountId, budget?.id ?? null, input.fiscalYear, input.month,
      input.amount, input.currency, rate, toBase(input.amount, rate), user.id, ts, ts,
    ).lastInsertRowid;
    audit(companyId, user.id, 'PURCHASE_REQUEST', id, 'CREATED', { ...input });
    return loadPr(companyId, id);
  });
}

export function updatePr(user: UserRow, pr: PrRow, input: PrInput): PrRow {
  if (pr.requested_by !== user.id) throw forbidden('Only the requester can edit');
  if (!REQUEST_EDITABLE.includes(pr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'Only draft or returned requests can be edited');
  const { rate } = validate(user, input, getScope(user));
  const budget = findBudgetByYear(pr.company_id, input.fiscalYear);
  run(`UPDATE purchase_requests SET request_type = ?, title = ?, description = ?, vendor = ?, cost_center_id = ?, account_id = ?, budget_id = ?, fiscal_year = ?,
         month = ?, amount = ?, currency = ?, exchange_rate = ?, amount_base = ?, updated_at = ? WHERE id = ?`,
    input.requestType, input.title, input.description, input.vendor, input.costCenterId, input.accountId, budget?.id ?? null, input.fiscalYear,
    input.month, input.amount, input.currency, rate, toBase(input.amount, rate), nowIso(), pr.id);
  audit(pr.company_id, user.id, 'PURCHASE_REQUEST', pr.id, 'UPDATED', { amount: [pr.amount, input.amount], currency: [pr.currency, input.currency] });
  return loadPr(pr.company_id, pr.id);
}

export function submitPr(user: UserRow, pr: PrRow): PrRow {
  if (pr.requested_by !== user.id) throw forbidden('Only the requester can submit');
  if (!REQUEST_EDITABLE.includes(pr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'Only draft or returned requests can be submitted');
  // refresh currency conversion at submission
  const rate = rateFor(pr.company_id, pr.currency);
  const amountBase = toBase(pr.amount, rate);
  const check = checkBudget(pr.company_id, pr.cost_center_id, pr.account_id, pr.fiscal_year, pr.month, amountBase, pr.id);
  if (check.state === 'OVER' && check.blockOverBudget) {
    throw new HttpError(409, 'OVER_BUDGET', `Request exceeds the available budget (${check.available} ${check.currency})`, check);
  }
  const org = OrgIndex.load(pr.company_id);
  const accs = AccountIndex.load(pr.company_id);
  const cc = org.cc(pr.cost_center_id);
  return tx(() => {
    run('UPDATE purchase_requests SET exchange_rate = ?, amount_base = ?, budget_state = ?, available_at_submit = ? WHERE id = ?', rate, amountBase, check.state, check.available, pr.id);
    const inst = startWorkflow({
      companyId: pr.company_id, type: pr.request_type === 'EXPENSE' ? 'EXPENSE_REQUEST' : 'PURCHASE_REQUEST', entityType: 'PURCHASE_REQUEST', entityId: pr.id,
      subject: { orgUnitId: cc.orgUnitId, costCenterIds: [cc.id], requesterId: user.id },
      context: {
        ...org.ruleContextForUnit(cc.orgUnitId), ...accs.ruleContext(pr.account_id), amount: amountBase, costCenter: [cc.code],
        requestType: pr.request_type, industry: companyRow(pr.company_id).industry_code,
      },
    });
    const fresh = loadPr(pr.company_id, pr.id);
    if (fresh.status === 'DRAFT' || fresh.status === 'RETURNED') {
      run("UPDATE purchase_requests SET status = 'IN_APPROVAL', submitted_at = ?, workflow_instance_id = ?, updated_at = ? WHERE id = ?", nowIso(), inst.id, nowIso(), pr.id);
    } else {
      run('UPDATE purchase_requests SET submitted_at = ?, workflow_instance_id = ? WHERE id = ?', nowIso(), inst.id, pr.id);
    }
    audit(pr.company_id, user.id, 'PURCHASE_REQUEST', pr.id, 'SUBMITTED', { amountBase, budgetState: check.state, available: check.available });
    return loadPr(pr.company_id, pr.id);
  });
}

export function cancelPr(user: UserRow, pr: PrRow, comment: string | null): void {
  if (pr.requested_by !== user.id) throw forbidden('Only the requester can cancel');
  if (pr.status === 'IN_APPROVAL' && pr.workflow_instance_id) { cancelInstance(user, pr.workflow_instance_id, comment); return; }
  if (!REQUEST_EDITABLE.includes(pr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'This request cannot be cancelled');
  run("UPDATE purchase_requests SET status = 'CANCELLED', decided_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), pr.id);
  audit(pr.company_id, user.id, 'PURCHASE_REQUEST', pr.id, 'CANCELLED', { comment });
}

/** Records spend against an approved request. Fully spent requests close and release their commitment. */
export function recordPrActual(user: UserRow, pr: PrRow, input: { amount: number; month: number; description: string | null; close: boolean }): void {
  if (!userCan(user, 'actuals.manage')) throw forbidden();
  if (pr.status !== 'APPROVED') throw new HttpError(409, 'INVALID_TRANSITION', 'Actuals can only be recorded on approved requests');
  tx(() => {
    const ts = nowIso();
    if (input.amount > 0) {
      run(`INSERT INTO actuals (company_id, fiscal_year, month, cost_center_id, account_id, amount, source, purchase_request_id, description, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'REQUEST', ?, ?, ?, ?, ?)`,
        pr.company_id, pr.fiscal_year, input.month, pr.cost_center_id, pr.account_id, Math.round(input.amount * 100) / 100, pr.id,
        input.description ?? pr.title, user.id, ts, ts);
    }
    const spent = get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM actuals WHERE purchase_request_id = ?', pr.id)!.s;
    if (input.close || spent >= pr.amount_base - 0.005) {
      run("UPDATE purchase_requests SET status = 'CLOSED', updated_at = ? WHERE id = ?", ts, pr.id);
    }
    audit(pr.company_id, user.id, 'PURCHASE_REQUEST', pr.id, 'ACTUAL_RECORDED', { amount: input.amount, month: input.month, spent, closed: input.close || spent >= pr.amount_base });
  });
}

export function prDto(user: UserRow, pr: PrRow): PurchaseRequestDto {
  const cc = get<{ code: string; name: string }>('SELECT code, name FROM cost_centers WHERE id = ?', pr.cost_center_id)!;
  const acc = get<{ code: string; name: string }>('SELECT code, name FROM accounts WHERE id = ?', pr.account_id)!;
  const requester = get<{ full_name: string }>('SELECT full_name FROM users WHERE id = ?', pr.requested_by)?.full_name ?? '—';
  const actual = get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM actuals WHERE purchase_request_id = ?', pr.id)!.s;
  const own = pr.requested_by === user.id;
  return {
    id: pr.id, number: pr.number, requestType: pr.request_type, title: pr.title, description: pr.description, vendor: pr.vendor,
    costCenterId: pr.cost_center_id, costCenterCode: cc.code, costCenterName: cc.name, accountId: pr.account_id, accountCode: acc.code, accountName: acc.name,
    fiscalYear: pr.fiscal_year, month: pr.month, amount: pr.amount, currency: pr.currency, exchangeRate: pr.exchange_rate, amountBase: pr.amount_base,
    actualBase: Math.round(actual * 100) / 100, status: pr.status, budgetState: pr.budget_state, availableAtSubmit: pr.available_at_submit,
    requestedBy: requester, requestedById: pr.requested_by, createdAt: pr.created_at, submittedAt: pr.submitted_at, decidedAt: pr.decided_at,
    workflowInstanceId: pr.workflow_instance_id,
    canEdit: own && REQUEST_EDITABLE.includes(pr.status),
    canSubmit: own && REQUEST_EDITABLE.includes(pr.status),
    canCancel: own && (REQUEST_EDITABLE.includes(pr.status) || pr.status === 'IN_APPROVAL'),
    canRecordActual: pr.status === 'APPROVED' && userCan(user, 'actuals.manage'),
  };
}

export function listPrs(user: UserRow, filter: { year?: number; status?: string; mine?: boolean }): PurchaseRequestDto[] {
  const scope = getScope(user);
  const rows = all<PrRow>(
    `SELECT * FROM purchase_requests WHERE company_id = ?${filter.year ? ' AND fiscal_year = ?' : ''}${filter.status ? ' AND status = ?' : ''} ORDER BY id DESC`,
    user.company_id!, ...(filter.year ? [filter.year] : []), ...(filter.status ? [filter.status] : []),
  );
  return rows.filter((p) => (filter.mine ? p.requested_by === user.id : canViewPr(user, p, scope))).map((p) => prDto(user, p));
}

registerHandler('PURCHASE_REQUEST', {
  onApproved(inst: InstanceRow) { run("UPDATE purchase_requests SET status = 'APPROVED', decided_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), inst.entity_id); },
  onRejected(inst: InstanceRow) { run("UPDATE purchase_requests SET status = 'REJECTED', decided_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), inst.entity_id); },
  onReturned(inst: InstanceRow) { run("UPDATE purchase_requests SET status = 'RETURNED', updated_at = ? WHERE id = ?", nowIso(), inst.entity_id); },
  onCancelled(inst: InstanceRow) { run("UPDATE purchase_requests SET status = 'CANCELLED', decided_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), inst.entity_id); },
  describe(companyId: number, id: number) {
    const p = get<PrRow & { cc: string }>('SELECT p.*, c.code AS cc FROM purchase_requests p JOIN cost_centers c ON c.id = p.cost_center_id WHERE p.id = ? AND p.company_id = ?', id, companyId);
    return p
      ? { title: `${p.number} · ${p.title}`, subtitle: `${p.request_type} · ${p.cc}`, amount: p.amount, currency: p.currency, link: `/requests/${p.id}` }
      : { title: `#${id}`, subtitle: '', amount: null, currency: null, link: '/requests' };
  },
});
