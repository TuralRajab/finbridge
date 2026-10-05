/**
 * Rules engine used by workflow definitions (which workflow applies) and workflow steps
 * (whether a step is included). Conditions are plain JSON so they can be stored and edited in the UI.
 *
 *   { "all": [ { "field": "amount", "op": "gte", "value": 10000 },
 *              { "field": "orgUnit", "op": "in", "value": ["HR"] } ] }
 */

export const CONDITION_FIELDS = [
  'amount', // number, company base currency
  'orgUnit', // codes of the subject unit and all its ancestors
  'department', // code of the nearest DEPARTMENT-type ancestor
  'branch', // code of the nearest BRANCH-type ancestor
  'costCenter', // cost center code(s)
  'account', // account code(s) incl. parent groups
  'expenseClass', // OPEX / CAPEX
  'requestType', // PURCHASE / EXPENSE
  'budgetKind', // INITIAL / REVISED / FORECAST / MANAGEMENT
  'industry', // company industry code
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const NUMERIC_FIELDS: readonly ConditionField[] = ['amount'];

export interface Rule {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | (string | number)[];
}

export type Condition = Rule | { all: Condition[] } | { any: Condition[] } | { not: Condition };

/** Values describing the item being routed. Multi-valued fields (codes) are arrays. */
export type RuleContext = Partial<Record<ConditionField, string | number | (string | number)[] | null>>;

function asArray(v: unknown): (string | number)[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v as string | number];
}

const norm = (v: string | number) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

function evalRule(rule: Rule, ctx: RuleContext): boolean {
  const actual = ctx[rule.field];
  if (NUMERIC_FIELDS.includes(rule.field) || ['gt', 'gte', 'lt', 'lte'].includes(rule.op)) {
    const a = Number(actual);
    const b = Number(Array.isArray(rule.value) ? rule.value[0] : rule.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (rule.op) {
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'eq': return a === b;
      case 'neq': return a !== b;
      default: return false;
    }
  }
  const have = asArray(actual).map(norm);
  const want = asArray(rule.value).map(norm);
  const anyMatch = have.some((h) => want.includes(h));
  switch (rule.op) {
    case 'eq':
    case 'in': return anyMatch;
    case 'neq':
    case 'notIn': return !anyMatch;
    default: return false;
  }
}

/** Empty / missing condition means "always". */
export function evaluateCondition(cond: Condition | null | undefined, ctx: RuleContext): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ('any' in cond) return cond.any.length === 0 || cond.any.some((c) => evaluateCondition(c, ctx));
  if ('not' in cond) return !evaluateCondition(cond.not, ctx);
  return evalRule(cond, ctx);
}

/** Number of rules — used to prefer more specific workflow definitions. */
export function conditionWeight(cond: Condition | null | undefined): number {
  if (!cond) return 0;
  if ('all' in cond) return cond.all.reduce((s, c) => s + conditionWeight(c), 0);
  if ('any' in cond) return cond.any.reduce((s, c) => s + conditionWeight(c), 0);
  if ('not' in cond) return conditionWeight(cond.not);
  return 1;
}

/** Flat list of rules for simple editors ({ all: [rule, …] }). */
export function rulesOf(cond: Condition | null | undefined): Rule[] {
  if (!cond) return [];
  if ('all' in cond) return cond.all.flatMap((c) => rulesOf(c));
  if ('field' in cond) return [cond];
  return [];
}
