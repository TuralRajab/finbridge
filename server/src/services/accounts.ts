import type { RuleContext } from '@finbridge/shared';
import { all } from '../db/database';
import { badRequest, notFound } from '../lib/errors';

export interface AccountNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  nameEn: string | null;
  accountType: string;
  expenseClass: 'OPEX' | 'CAPEX' | null;
  category: string | null;
  isGroup: boolean;
  allowBudgeting: boolean;
  allowRequests: boolean;
  isActive: boolean;
  sortOrder: number;
}

export class AccountIndex {
  readonly accounts = new Map<number, AccountNode>();
  readonly byCode = new Map<string, AccountNode>();
  readonly children = new Map<number | null, number[]>();
  /** cost center id → allowed account ids (only for restricted cost centers) */
  readonly ccRestrictions = new Map<number, Set<number>>();

  static load(companyId: number): AccountIndex {
    const idx = new AccountIndex();
    for (const r of all<{
      id: number; parent_id: number | null; code: string; name: string; name_en: string | null; account_type: string;
      expense_class: 'OPEX' | 'CAPEX' | null; category: string | null; is_group: number; allow_budgeting: number;
      allow_requests: number; is_active: number; sort_order: number;
    }>('SELECT * FROM accounts WHERE company_id = ? ORDER BY sort_order, code', companyId)) {
      const node: AccountNode = {
        id: r.id, parentId: r.parent_id, code: r.code, name: r.name, nameEn: r.name_en, accountType: r.account_type,
        expenseClass: r.expense_class, category: r.category, isGroup: r.is_group === 1, allowBudgeting: r.allow_budgeting === 1,
        allowRequests: r.allow_requests === 1, isActive: r.is_active === 1, sortOrder: r.sort_order,
      };
      idx.accounts.set(r.id, node);
      idx.byCode.set(r.code.toUpperCase(), node);
      const list = idx.children.get(r.parent_id) ?? [];
      list.push(r.id);
      idx.children.set(r.parent_id, list);
    }
    for (const r of all<{ cost_center_id: number; account_id: number }>(
      'SELECT ca.cost_center_id, ca.account_id FROM cost_center_accounts ca JOIN cost_centers c ON c.id = ca.cost_center_id WHERE c.company_id = ?', companyId,
    )) {
      const s = idx.ccRestrictions.get(r.cost_center_id) ?? new Set<number>();
      s.add(r.account_id);
      idx.ccRestrictions.set(r.cost_center_id, s);
    }
    return idx;
  }

  get(id: number): AccountNode {
    const a = this.accounts.get(id);
    if (!a) throw notFound('Account');
    return a;
  }

  ancestors(id: number, includeSelf = true): AccountNode[] {
    const out: AccountNode[] = [];
    const seen = new Set<number>();
    let cur = this.accounts.get(id);
    if (cur && !includeSelf) cur = cur.parentId ? this.accounts.get(cur.parentId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.parentId ? this.accounts.get(cur.parentId) : undefined;
    }
    return out;
  }

  level(id: number): number {
    return this.ancestors(id).length - 1;
  }

  descendants(id: number): Set<number> {
    const out = new Set<number>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      stack.push(...(this.children.get(cur) ?? []));
    }
    return out;
  }

  /** Expense class is inherited from the nearest ancestor that defines one. */
  expenseClassOf(id: number): 'OPEX' | 'CAPEX' | null {
    return this.ancestors(id).find((a) => a.expenseClass)?.expenseClass ?? null;
  }

  ruleContext(id: number): RuleContext {
    return { account: this.ancestors(id).map((a) => a.code), expenseClass: this.expenseClassOf(id) };
  }

  /** Throws unless the account can be used on the cost center for the given purpose. */
  assertUsable(accountId: number, costCenterId: number, purpose: 'budget' | 'request'): AccountNode {
    const a = this.get(accountId);
    if (!a.isActive) throw badRequest('ACCOUNT_NOT_ALLOWED', `Account ${a.code} is inactive`);
    if (a.isGroup) throw badRequest('ACCOUNT_NOT_ALLOWED', `Account ${a.code} is a group account; use one of its sub-accounts`);
    if (purpose === 'budget' && !a.allowBudgeting) throw badRequest('ACCOUNT_NOT_ALLOWED', `Account ${a.code} does not allow budgeting`);
    if (purpose === 'request' && !a.allowRequests) throw badRequest('ACCOUNT_NOT_ALLOWED', `Account ${a.code} does not allow purchase/expense requests`);
    const restriction = this.ccRestrictions.get(costCenterId);
    if (restriction && restriction.size > 0 && !restriction.has(accountId)) {
      throw badRequest('ACCOUNT_NOT_ALLOWED', `Account ${a.code} is not allowed on this cost center`);
    }
    return a;
  }
}
