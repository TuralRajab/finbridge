/** Pure budget maths shared by the API and the web app. All amounts are in the company currency (AZN). */

export const MONTHS_IN_YEAR = 12;

export function emptyMonths(): number[] {
  return Array.from({ length: MONTHS_IN_YEAR }, () => 0);
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of the first `throughMonth` months (1–12). */
export function sumMonths(months: readonly number[], throughMonth = MONTHS_IN_YEAR): number {
  let total = 0;
  for (let i = 0; i < Math.min(throughMonth, months.length); i++) total += months[i] ?? 0;
  return roundMoney(total);
}

export interface VarianceResult {
  variance: number;
  /** null when the budget is zero (percentage is undefined). */
  variancePct: number | null;
}

/** Variance = Actual − Budget. Positive means overspend, negative means saving. */
export function computeVariance(budget: number, actual: number): VarianceResult {
  const variance = roundMoney(actual - budget);
  const variancePct = budget === 0 ? null : Math.round((variance / budget) * 1000) / 10;
  return { variance, variancePct };
}

export type VarianceState = 'over' | 'under' | 'on';

export function varianceState(variance: number, tolerance = 0.005): VarianceState {
  if (variance > tolerance) return 'over';
  if (variance < -tolerance) return 'under';
  return 'on';
}

export type ForecastMethod = 'budget' | 'run_rate';

/**
 * Full-year forecast.
 *  - budget:   actuals to date + remaining budget months
 *  - run_rate: average monthly actual × 12
 */
export function forecastFullYear(
  actualYtd: number,
  budgetMonths: readonly number[],
  throughMonth: number,
  method: ForecastMethod = 'budget',
): number {
  if (throughMonth <= 0) return sumMonths(budgetMonths);
  if (method === 'run_rate') return roundMoney((actualYtd / throughMonth) * MONTHS_IN_YEAR);
  const remaining = sumMonths(budgetMonths) - sumMonths(budgetMonths, throughMonth);
  return roundMoney(actualYtd + remaining);
}

/** Adds `pct` percent to every month (used when a new budget is copied from last year). */
export function applyUplift(months: readonly number[], pct: number): number[] {
  return months.map((m) => roundMoney(m * (1 + pct / 100)));
}

/* ------------------------------------------------------------------ budget consumption */

/** Amounts for one slice (cost center × account × period), all in base currency. */
export interface ConsumptionInput {
  budget: number;
  actual: number;
  /** Approved requests not yet turned into actuals. */
  committed: number;
  /** Requests still in approval. */
  pending: number;
}

export interface ConsumptionResult extends ConsumptionInput {
  available: number;
  variance: number;
  variancePct: number | null;
  /** (actual + committed) / budget × 100 */
  consumptionPct: number | null;
}

export function consumption(i: ConsumptionInput, includePending = true): ConsumptionResult {
  const available = roundMoney(i.budget - i.actual - i.committed - (includePending ? i.pending : 0));
  const { variance, variancePct } = computeVariance(i.budget, i.actual);
  const consumptionPct = i.budget === 0 ? null : Math.round(((i.actual + i.committed) / i.budget) * 1000) / 10;
  return { ...i, available, variance, variancePct, consumptionPct };
}

export interface BudgetCheckResult {
  state: 'WITHIN' | 'NEAR' | 'OVER';
  budget: number;
  used: number;
  available: number;
  requested: number;
  availableAfter: number;
  usagePctAfter: number | null;
}

/**
 * Funds check for a new request.
 * `used` = actual + committed (+ pending when configured), excluding the request itself.
 * OVER when the request exceeds what is available (or nothing is budgeted),
 * NEAR when usage after the request reaches `nearLimitPct`.
 */
export function budgetCheck(budget: number, used: number, requested: number, nearLimitPct = 90): BudgetCheckResult {
  const available = roundMoney(budget - used);
  const availableAfter = roundMoney(available - requested);
  const usagePctAfter = budget > 0 ? Math.round(((used + requested) / budget) * 1000) / 10 : null;
  let state: BudgetCheckResult['state'] = 'WITHIN';
  if (budget <= 0 || availableAfter < -0.005) state = 'OVER';
  else if (usagePctAfter !== null && usagePctAfter >= nearLimitPct) state = 'NEAR';
  return { state, budget: roundMoney(budget), used: roundMoney(used), available, requested: roundMoney(requested), availableAfter, usagePctAfter };
}

/** Converts a transaction amount to base currency with `rate` = base units per 1 transaction unit. */
export function toBase(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}
