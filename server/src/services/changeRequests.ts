import { can, REQUEST_EDITABLE, roundMoney, type ChangeRequestDto, type RequestStatus } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { getScope } from '../lib/scope';
import { AccountIndex } from './accounts';
import { createRevisedVersion, loadBudget, loadVersion } from './budgets';
import { OrgIndex } from './org';
import { nextNumber } from './purchaseRequests';
import { companyRow } from './settings';
import { cancelInstance, isParticipant, registerHandler, startWorkflow, type InstanceRow } from './workflowEngine';

export interface CrRow {
  id: number; company_id: number; number: string; budget_id: number; base_version_id: number; result_version_id: number | null; cost_center_id: number;
  title: string; reason: string; status: RequestStatus; workflow_instance_id: number | null; requested_by: number; created_at: string;
  submitted_at: string | null; decided_at: string | null;
}

export interface CrInput {
  budgetId: number;
  costCenterId: number;
  title: string;
  reason: string;
  items: { accountId: number; month: number; requestedAmount: number }[];
}

export function loadCr(companyId: number, id: number): CrRow {
  const c = get<CrRow>('SELECT * FROM budget_change_requests WHERE id = ? AND company_id = ?', id, companyId);
  if (!c) throw notFound('Change request');
  return c;
}

function currentAmount(versionId: number, ccId: number, accId: number, month: number): number {
  return roundMoney(get<{ v: number | null }>(`SELECT SUM(m${month}) AS v FROM budget_lines WHERE version_id = ? AND cost_center_id = ? AND account_id = ?`, versionId, ccId, accId)?.v ?? 0);
}

function writeItems(cr: { id: number }, versionId: number, ccId: number, items: CrInput['items']): number {
  run('DELETE FROM budget_change_items WHERE change_request_id = ?', cr.id);
  let n = 0;
  for (const it of items) {
    const current = currentAmount(versionId, ccId, it.accountId, it.month);
    if (roundMoney(it.requestedAmount) === current) continue;
    run('INSERT INTO budget_change_items (change_request_id, account_id, month, current_amount, requested_amount) VALUES (?, ?, ?, ?, ?)',
      cr.id, it.accountId, it.month, current, roundMoney(it.requestedAmount));
    n++;
  }
  if (!n) throw badRequest('VALIDATION_ERROR', 'No item changes the current approved amount');
  return n;
}

function validate(user: UserRow, input: CrInput) {
  if (!can(user.role, 'change.create')) throw forbidden();
  const budget = loadBudget(user.company_id!, input.budgetId);
  const version = loadVersion(budget);
  if (version.status !== 'LOCKED') throw new HttpError(409, 'INVALID_TRANSITION', 'Change requests are raised against the locked (approved) budget. Edit the draft directly instead.');
  const org = OrgIndex.load(user.company_id!);
  const cc = org.cc(input.costCenterId);
  const scope = getScope(user, org);
  if (!scope.all && !scope.costCenterIds.has(cc.id)) throw forbidden('You cannot request changes on this cost center');
  const accs = AccountIndex.load(user.company_id!);
  for (const it of input.items) accs.assertUsable(it.accountId, cc.id, 'budget');
  const seen = new Set<string>();
  for (const it of input.items) {
    const k = `${it.accountId}:${it.month}`;
    if (seen.has(k)) throw badRequest('VALIDATION_ERROR', 'Each account / month may appear only once');
    seen.add(k);
  }
  return { budget, version };
}

export function createCr(user: UserRow, input: CrInput): CrRow {
  const { budget, version } = validate(user, input);
  return tx(() => {
    const id = run(
      `INSERT INTO budget_change_requests (company_id, number, budget_id, base_version_id, cost_center_id, title, reason, status, requested_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      user.company_id!, nextNumber(user.company_id!, 'BCR', budget.fiscal_year, 'budget_change_requests'), budget.id, version.id, input.costCenterId,
      input.title, input.reason, user.id, nowIso(),
    ).lastInsertRowid;
    writeItems({ id }, version.id, input.costCenterId, input.items);
    audit(user.company_id, user.id, 'CHANGE_REQUEST', id, 'CREATED', { ...input });
    return loadCr(user.company_id!, id);
  });
}

export function updateCr(user: UserRow, cr: CrRow, input: CrInput): CrRow {
  if (cr.requested_by !== user.id) throw forbidden('Only the requester can edit');
  if (!REQUEST_EDITABLE.includes(cr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'Only draft or returned change requests can be edited');
  const { version } = validate(user, { ...input, budgetId: cr.budget_id });
  tx(() => {
    run('UPDATE budget_change_requests SET cost_center_id = ?, title = ?, reason = ?, base_version_id = ? WHERE id = ?', input.costCenterId, input.title, input.reason, version.id, cr.id);
    writeItems(cr, version.id, input.costCenterId, input.items);
    audit(cr.company_id, user.id, 'CHANGE_REQUEST', cr.id, 'UPDATED', { ...input });
  });
  return loadCr(cr.company_id, cr.id);
}

function items(crId: number) {
  return all<{ id: number; account_id: number; month: number; current_amount: number; requested_amount: number }>('SELECT * FROM budget_change_items WHERE change_request_id = ? ORDER BY account_id, month', crId);
}

/** Size of a change for routing thresholds: the larger of total increases and total decreases. */
function changeMagnitude(crId: number): number {
  let up = 0;
  let down = 0;
  for (const i of items(crId)) {
    const d = i.requested_amount - i.current_amount;
    if (d > 0) up += d; else down -= d;
  }
  return roundMoney(Math.max(up, down));
}

export function submitCr(user: UserRow, cr: CrRow): CrRow {
  if (cr.requested_by !== user.id) throw forbidden('Only the requester can submit');
  if (!REQUEST_EDITABLE.includes(cr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'Only draft or returned change requests can be submitted');
  const budget = loadBudget(cr.company_id, cr.budget_id);
  if (loadVersion(budget).status !== 'LOCKED') throw new HttpError(409, 'INVALID_TRANSITION', 'The budget is not locked');
  const org = OrgIndex.load(cr.company_id);
  const accs = AccountIndex.load(cr.company_id);
  const cc = org.cc(cr.cost_center_id);
  const accountCtx = items(cr.id).flatMap((i) => accs.ancestors(i.account_id).map((a) => a.code));
  const classes = [...new Set(items(cr.id).map((i) => accs.expenseClassOf(i.account_id)).filter(Boolean))] as string[];
  return tx(() => {
    const inst = startWorkflow({
      companyId: cr.company_id, type: 'BUDGET_CHANGE', entityType: 'CHANGE_REQUEST', entityId: cr.id,
      subject: { orgUnitId: cc.orgUnitId, costCenterIds: [cc.id], requesterId: user.id },
      context: {
        ...org.ruleContextForUnit(cc.orgUnitId), amount: changeMagnitude(cr.id), costCenter: [cc.code], account: [...new Set(accountCtx)],
        expenseClass: classes, budgetKind: 'REVISED', industry: companyRow(cr.company_id).industry_code,
      },
    });
    const fresh = loadCr(cr.company_id, cr.id);
    if (REQUEST_EDITABLE.includes(fresh.status)) {
      run("UPDATE budget_change_requests SET status = 'IN_APPROVAL', submitted_at = ?, workflow_instance_id = ? WHERE id = ?", nowIso(), inst.id, cr.id);
    } else {
      run('UPDATE budget_change_requests SET submitted_at = ?, workflow_instance_id = ? WHERE id = ?', nowIso(), inst.id, cr.id);
    }
    audit(cr.company_id, user.id, 'CHANGE_REQUEST', cr.id, 'SUBMITTED', { magnitude: changeMagnitude(cr.id) });
    return loadCr(cr.company_id, cr.id);
  });
}

export function cancelCr(user: UserRow, cr: CrRow, comment: string | null): void {
  if (cr.requested_by !== user.id) throw forbidden('Only the requester can cancel');
  if (cr.status === 'IN_APPROVAL' && cr.workflow_instance_id) { cancelInstance(user, cr.workflow_instance_id, comment); return; }
  if (!REQUEST_EDITABLE.includes(cr.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'This change request cannot be cancelled');
  run("UPDATE budget_change_requests SET status = 'CANCELLED', decided_at = ? WHERE id = ?", nowIso(), cr.id);
}

export function canViewCr(user: UserRow, cr: CrRow): boolean {
  const scope = getScope(user);
  if (scope.all || cr.requested_by === user.id || scope.costCenterIds.has(cr.cost_center_id)) return true;
  return all<{ id: number }>("SELECT id FROM workflow_instances WHERE entity_type = 'CHANGE_REQUEST' AND entity_id = ?", cr.id).some((i) => isParticipant(user.id, i.id));
}

export function crDto(user: UserRow, cr: CrRow): ChangeRequestDto {
  const cc = get<{ code: string; name: string }>('SELECT code, name FROM cost_centers WHERE id = ?', cr.cost_center_id)!;
  const b = get<{ fiscal_year: number }>('SELECT fiscal_year FROM budgets WHERE id = ?', cr.budget_id)!;
  const vno = (id: number | null) => (id ? get<{ version_no: number }>('SELECT version_no FROM budget_versions WHERE id = ?', id)?.version_no ?? null : null);
  const accs = new Map(all<{ id: number; code: string; name: string }>('SELECT id, code, name FROM accounts WHERE company_id = ?', cr.company_id).map((a) => [a.id, a]));
  const its = items(cr.id).map((i) => ({
    id: i.id, accountId: i.account_id, accountCode: accs.get(i.account_id)?.code ?? '?', accountName: accs.get(i.account_id)?.name ?? '?',
    month: i.month, currentAmount: i.current_amount, requestedAmount: i.requested_amount, difference: roundMoney(i.requested_amount - i.current_amount),
  }));
  const own = cr.requested_by === user.id;
  return {
    id: cr.id, number: cr.number, budgetId: cr.budget_id, fiscalYear: b.fiscal_year, baseVersionId: cr.base_version_id, baseVersionNo: vno(cr.base_version_id)!,
    resultVersionId: cr.result_version_id, resultVersionNo: vno(cr.result_version_id), costCenterId: cr.cost_center_id, costCenterCode: cc.code, costCenterName: cc.name,
    title: cr.title, reason: cr.reason, status: cr.status,
    totalCurrent: roundMoney(its.reduce((s, i) => s + i.currentAmount, 0)), totalRequested: roundMoney(its.reduce((s, i) => s + i.requestedAmount, 0)),
    totalDifference: roundMoney(its.reduce((s, i) => s + i.difference, 0)),
    requestedBy: get<{ full_name: string }>('SELECT full_name FROM users WHERE id = ?', cr.requested_by)?.full_name ?? '—', requestedById: cr.requested_by,
    createdAt: cr.created_at, submittedAt: cr.submitted_at, decidedAt: cr.decided_at, workflowInstanceId: cr.workflow_instance_id, items: its,
    canEdit: own && REQUEST_EDITABLE.includes(cr.status), canSubmit: own && REQUEST_EDITABLE.includes(cr.status),
    canCancel: own && (REQUEST_EDITABLE.includes(cr.status) || cr.status === 'IN_APPROVAL'),
  };
}

export function listCrs(user: UserRow, filter: { budgetId?: number; year?: number }): ChangeRequestDto[] {
  const rows = all<CrRow & { fiscal_year: number }>(
    `SELECT c.*, b.fiscal_year FROM budget_change_requests c JOIN budgets b ON b.id = c.budget_id WHERE c.company_id = ?
       ${filter.budgetId ? 'AND c.budget_id = ?' : ''}${filter.year ? ' AND b.fiscal_year = ?' : ''} ORDER BY c.id DESC`,
    user.company_id!, ...(filter.budgetId ? [filter.budgetId] : []), ...(filter.year ? [filter.year] : []),
  );
  return rows.filter((c) => canViewCr(user, c)).map((c) => crDto(user, c));
}

registerHandler('CHANGE_REQUEST', {
  onApproved(inst: InstanceRow, actorId: number) {
    const cr = loadCr(inst.company_id, inst.entity_id);
    const deltas = items(cr.id).map((i) => ({ ccId: cr.cost_center_id, accId: i.account_id, month: i.month, delta: roundMoney(i.requested_amount - i.current_amount) }));
    const vid = createRevisedVersion(inst.company_id, cr.budget_id, cr.id, deltas, actorId);
    run("UPDATE budget_change_requests SET status = 'APPROVED', decided_at = ?, result_version_id = ? WHERE id = ?", nowIso(), vid, cr.id);
  },
  onRejected(inst: InstanceRow) { run("UPDATE budget_change_requests SET status = 'REJECTED', decided_at = ? WHERE id = ?", nowIso(), inst.entity_id); },
  onReturned(inst: InstanceRow) { run("UPDATE budget_change_requests SET status = 'RETURNED' WHERE id = ?", inst.entity_id); },
  onCancelled(inst: InstanceRow) { run("UPDATE budget_change_requests SET status = 'CANCELLED', decided_at = ? WHERE id = ?", nowIso(), inst.entity_id); },
  describe(companyId: number, id: number) {
    const c = get<CrRow & { cc: string }>('SELECT r.*, c.code AS cc FROM budget_change_requests r JOIN cost_centers c ON c.id = r.cost_center_id WHERE r.id = ? AND r.company_id = ?', id, companyId);
    if (!c) return { title: `#${id}`, subtitle: '', amount: null, currency: null, link: '/changes' };
    const diff = roundMoney(items(id).reduce((s, i) => s + i.requested_amount - i.current_amount, 0));
    return { title: `${c.number} · ${c.title}`, subtitle: `BUDGET_CHANGE · ${c.cc}`, amount: diff, currency: companyRow(companyId).base_currency, link: `/changes/${c.id}` };
  },
});
