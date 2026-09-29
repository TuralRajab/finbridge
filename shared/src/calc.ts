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
