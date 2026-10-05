import { Router } from 'express';
import { z } from 'zod';
import type { AccountDto, CostCenterDto } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { audit, diff } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, conflict, notFound } from '../lib/errors';
import { toId } from '../lib/params';
import { AccountIndex } from '../services/accounts';
import { OrgIndex } from '../services/org';

const code = z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N}_\-.]+$/u, 'Letters, digits, - _ . only');
const name = z.string().trim().min(1).max(200);
const optUser = z.number().int().positive().nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

/* ------------------------------------------------------------------ cost centers */

export const costCentersRouter = Router();

export function listCostCenters(companyId: number): CostCenterDto[] {
  const org = OrgIndex.load(companyId);
  const users = new Map(all<{ id: number; full_name: string }>('SELECT id, full_name FROM users WHERE company_id = ?', companyId).map((u) => [u.id, u.full_name]));
  const restr = new Map<number, number[]>();
  for (const r of all<{ cost_center_id: number; account_id: number }>('SELECT ca.* FROM cost_center_accounts ca JOIN cost_centers c ON c.id = ca.cost_center_id WHERE c.company_id = ?', companyId)) {
    restr.set(r.cost_center_id, [...(restr.get(r.cost_center_id) ?? []), r.account_id]);
  }
  return all<{ id: number; code: string; name: string; description: string | null; org_unit_id: number; owner_user_id: number | null; responsible_user_id: number | null; currency: string; valid_from: string | null; valid_to: string | null; is_active: number }>(
    'SELECT * FROM cost_centers WHERE company_id = ? ORDER BY code', companyId,
  ).map((c) => {
    const section = org.sectionOf(c.org_unit_id);
    return {
      id: c.id, code: c.code, name: c.name, description: c.description, orgUnitId: c.org_unit_id, orgUnitName: org.units.get(c.org_unit_id)?.name ?? '—',
      departmentName: org.nearestOfType(c.org_unit_id, 'DEPARTMENT')?.name ?? null, branchName: org.nearestOfType(c.org_unit_id, 'BRANCH')?.name ?? null,
      sectionUnitId: section.id, sectionName: section.name,
      ownerUserId: c.owner_user_id, ownerName: c.owner_user_id ? users.get(c.owner_user_id) ?? null : null,
      responsibleUserId: c.responsible_user_id, responsibleName: c.responsible_user_id ? users.get(c.responsible_user_id) ?? null : null,
      currency: c.currency, validFrom: c.valid_from, validTo: c.valid_to, isActive: c.is_active === 1, allowedAccountIds: restr.get(c.id) ?? [],
    };
  });
}

costCentersRouter.get('/', requirePermission('masterdata.view'), (req, res) => { res.json(listCostCenters(companyIdOf(req))); });

const ccSchema = z.object({
  code, name, description: z.string().trim().max(500).nullable().optional(), orgUnitId: z.number().int().positive(),
  ownerUserId: optUser, responsibleUserId: optUser, currency: z.string().length(3).optional(), validFrom: date, validTo: date,
  isActive: z.boolean().default(true), allowedAccountIds: z.array(z.number().int().positive()).optional(),
});

function validateCc(companyId: number, b: Partial<z.infer<typeof ccSchema>>): void {
  if (b.orgUnitId) {
    const u = OrgIndex.load(companyId).units.get(b.orgUnitId);
    if (!u) throw notFound('Org unit');
    if (!u.isActive) throw badRequest('INVALID_HIERARCHY', 'The org unit is inactive');
  }
  for (const uid of [b.ownerUserId, b.responsibleUserId]) if (uid && !get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', uid, companyId)) throw notFound('User');
  if (b.currency && !get('SELECT 1 FROM currencies WHERE code = ?', b.currency)) throw notFound('Currency');
  if (b.validFrom && b.validTo && b.validTo < b.validFrom) throw badRequest('VALIDATION_ERROR', 'End date is before start date');
  if (b.allowedAccountIds) {
    const accs = AccountIndex.load(companyId);
    for (const a of b.allowedAccountIds) if (!accs.accounts.has(a) || accs.get(a).isGroup) throw badRequest('VALIDATION_ERROR', 'Account restrictions must reference postable accounts');
  }
}

function saveRestrictions(ccId: number, ids?: number[]): void {
  if (!ids) return;
  run('DELETE FROM cost_center_accounts WHERE cost_center_id = ?', ccId);
  for (const a of new Set(ids)) run('INSERT INTO cost_center_accounts (cost_center_id, account_id) VALUES (?, ?)', ccId, a);
}

costCentersRouter.post('/', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = ccSchema.parse(req.body);
  validateCc(companyId, b);
  const id = tx(() => {
    const ts = nowIso();
    const base = get<{ base_currency: string }>('SELECT base_currency FROM companies WHERE id = ?', companyId)!.base_currency;
    const cid = run(`INSERT INTO cost_centers (company_id, org_unit_id, code, name, description, owner_user_id, responsible_user_id, currency, valid_from, valid_to, is_active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      companyId, b.orgUnitId, b.code, b.name, b.description ?? null, b.ownerUserId ?? null, b.responsibleUserId ?? null, b.currency ?? base,
      b.validFrom ?? null, b.validTo ?? null, +b.isActive, ts, ts).lastInsertRowid;
    saveRestrictions(cid, b.allowedAccountIds);
    audit(companyId, currentUser(req).id, 'COST_CENTER', cid, 'CREATED', b);
    return cid;
  });
  res.status(201).json(listCostCenters(companyId).find((c) => c.id === id));
});

costCentersRouter.patch('/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = ccSchema.partial().parse(req.body);
  const c = listCostCenters(companyId).find((x) => x.id === id);
  if (!c) throw notFound('Cost center');
  validateCc(companyId, b);
  tx(() => {
    run(`UPDATE cost_centers SET code = ?, name = ?, description = ?, org_unit_id = ?, owner_user_id = ?, responsible_user_id = ?, currency = ?, valid_from = ?, valid_to = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      b.code ?? c.code, b.name ?? c.name, b.description !== undefined ? b.description : c.description, b.orgUnitId ?? c.orgUnitId,
      b.ownerUserId !== undefined ? b.ownerUserId : c.ownerUserId, b.responsibleUserId !== undefined ? b.responsibleUserId : c.responsibleUserId,
      b.currency ?? c.currency, b.validFrom !== undefined ? b.validFrom : c.validFrom, b.validTo !== undefined ? b.validTo : c.validTo,
      b.isActive === undefined ? +c.isActive : +b.isActive, nowIso(), id);
    saveRestrictions(id, b.allowedAccountIds);
    audit(companyId, currentUser(req).id, 'COST_CENTER', id, 'UPDATED', diff(c as unknown as Record<string, unknown>, b));
  });
  res.json(listCostCenters(companyId).find((x) => x.id === id));
});

costCentersRouter.delete('/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  if (get('SELECT 1 FROM budget_lines WHERE cost_center_id = ? UNION SELECT 1 FROM actuals WHERE cost_center_id = ? UNION SELECT 1 FROM purchase_requests WHERE cost_center_id = ? LIMIT 1', id, id, id)) {
    throw conflict('IN_USE', 'The cost center has financial data — deactivate it instead');
  }
  const r = run('DELETE FROM cost_centers WHERE id = ? AND company_id = ?', id, companyId);
  if (!r.changes) throw notFound('Cost center');
  audit(companyId, currentUser(req).id, 'COST_CENTER', id, 'DELETED', null);
  res.status(204).end();
});

/* ------------------------------------------------------------------ chart of accounts */

export const accountsRouter = Router();

export function listAccounts(companyId: number): AccountDto[] {
  const idx = AccountIndex.load(companyId);
  const restr = new Map<number, number[]>();
  for (const [cc, set] of idx.ccRestrictions) for (const a of set) restr.set(a, [...(restr.get(a) ?? []), cc]);
  const rows = all<{ id: number; description: string | null; currency: string | null; expense_class: 'OPEX' | 'CAPEX' | null }>('SELECT id, description, currency, expense_class FROM accounts WHERE company_id = ?', companyId);
  const extra = new Map(rows.map((r) => [r.id, r]));
  // depth-first order so the client can render the tree directly
  const out: AccountDto[] = [];
  const walk = (parent: number | null, level: number) => {
    for (const id of idx.children.get(parent) ?? []) {
      const a = idx.get(id);
      const e = extra.get(id)!;
      out.push({
        id: a.id, parentId: a.parentId, code: a.code, name: a.name, nameEn: a.nameEn, description: e.description, accountType: a.accountType as AccountDto['accountType'],
        category: a.category, expenseClass: e.expense_class, isGroup: a.isGroup, allowBudgeting: a.allowBudgeting, allowRequests: a.allowRequests,
        currency: e.currency, isActive: a.isActive, sortOrder: a.sortOrder, level, allowedCostCenterIds: restr.get(a.id) ?? [],
      });
      walk(id, level + 1);
    }
  };
  walk(null, 0);
  return out;
}

accountsRouter.get('/', requirePermission('masterdata.view'), (req, res) => { res.json(listAccounts(companyIdOf(req))); });

const accSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(), code, name, nameEn: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(), accountType: z.enum(['REVENUE', 'EXPENSE', 'CAPEX', 'OTHER']),
  category: z.string().trim().max(60).nullable().optional(), expenseClass: z.enum(['OPEX', 'CAPEX']).nullable().optional(),
  isGroup: z.boolean().default(false), allowBudgeting: z.boolean().default(true), allowRequests: z.boolean().default(true),
  currency: z.string().length(3).nullable().optional(), isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
});

function hasPostings(id: number): boolean {
  return !!get('SELECT 1 FROM budget_lines WHERE account_id = ? UNION SELECT 1 FROM actuals WHERE account_id = ? UNION SELECT 1 FROM purchase_requests WHERE account_id = ? LIMIT 1', id, id, id);
}

accountsRouter.post('/', requirePermission('coa.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = accSchema.parse(req.body);
  if (b.parentId) {
    const idx = AccountIndex.load(companyId);
    const p = idx.get(b.parentId);
    if (!p.isGroup) {
      if (hasPostings(p.id)) throw badRequest('VALIDATION_ERROR', `Account ${p.code} has postings and cannot become a group`);
      run('UPDATE accounts SET is_group = 1, updated_at = ? WHERE id = ?', nowIso(), p.id);
    }
  }
  const ts = nowIso();
  const id = run(`INSERT INTO accounts (company_id, parent_id, code, name, name_en, description, account_type, category, expense_class, is_group, allow_budgeting, allow_requests, currency, is_active, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, b.parentId ?? null, b.code, b.name, b.nameEn ?? null, b.description ?? null, b.accountType, b.category ?? null, b.expenseClass ?? null,
    +b.isGroup, +b.allowBudgeting, +b.allowRequests, b.currency ?? null, +b.isActive, b.sortOrder, ts, ts).lastInsertRowid;
  audit(companyId, currentUser(req).id, 'ACCOUNT', id, 'CREATED', b);
  res.status(201).json(listAccounts(companyId).find((a) => a.id === id));
});

accountsRouter.patch('/:id', requirePermission('coa.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = accSchema.partial().parse(req.body);
  const idx = AccountIndex.load(companyId);
  const a = listAccounts(companyId).find((x) => x.id === id);
  if (!a) throw notFound('Account');
  if (b.parentId !== undefined && b.parentId !== a.parentId && b.parentId !== null) {
    if (idx.descendants(id).has(b.parentId)) throw badRequest('INVALID_HIERARCHY', 'An account cannot be moved under itself or its sub-accounts');
    idx.get(b.parentId);
  }
  if (b.isGroup === true && !a.isGroup && hasPostings(id)) throw badRequest('VALIDATION_ERROR', 'An account with postings cannot become a group');
  if (b.isGroup === false && a.isGroup && (idx.children.get(id)?.length ?? 0) > 0) throw badRequest('VALIDATION_ERROR', 'Move or remove its sub-accounts first');
  run(`UPDATE accounts SET parent_id = ?, code = ?, name = ?, name_en = ?, description = ?, account_type = ?, category = ?, expense_class = ?, is_group = ?,
         allow_budgeting = ?, allow_requests = ?, currency = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    b.parentId !== undefined ? b.parentId : a.parentId, b.code ?? a.code, b.name ?? a.name, b.nameEn !== undefined ? b.nameEn : a.nameEn,
    b.description !== undefined ? b.description : a.description, b.accountType ?? a.accountType, b.category !== undefined ? b.category : a.category,
    b.expenseClass !== undefined ? b.expenseClass : a.expenseClass, +(b.isGroup ?? a.isGroup), +(b.allowBudgeting ?? a.allowBudgeting), +(b.allowRequests ?? a.allowRequests),
    b.currency !== undefined ? b.currency : a.currency, +(b.isActive ?? a.isActive), b.sortOrder ?? a.sortOrder, nowIso(), id);
  audit(companyId, currentUser(req).id, 'ACCOUNT', id, 'UPDATED', diff(a as unknown as Record<string, unknown>, b));
  res.json(listAccounts(companyId).find((x) => x.id === id));
});

accountsRouter.delete('/:id', requirePermission('coa.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  if (hasPostings(id)) throw conflict('IN_USE', 'The account has financial data — deactivate it instead');
  if (get('SELECT 1 FROM accounts WHERE parent_id = ? LIMIT 1', id)) throw conflict('IN_USE', 'The account has sub-accounts');
  const r = run('DELETE FROM accounts WHERE id = ? AND company_id = ?', id, companyId);
  if (!r.changes) throw notFound('Account');
  audit(companyId, currentUser(req).id, 'ACCOUNT', id, 'DELETED', null);
  res.status(204).end();
});
