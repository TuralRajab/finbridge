/**
 * Planning comparison: when the budget for year Y is prepared, the planner sees the previous years'
 * original budget, final budget (after change requests) and actuals next to the plan being drafted.
 */
import type { VersionStatus } from './workflow';

/** `line` = cost center × account (used by the budget-lines grid for reference columns). */
export type PlanningGroupBy = 'section' | 'costCenter' | 'account' | 'line';

/**
 * Full-year forecast for a prior year that is not complete yet:
 *  - budget:   actuals for the closed months + the final budget of the remaining months
 *  - run_rate: average monthly actual × 12
 */
export type PlanningForecastMethod = 'budget' | 'run_rate';

export interface PlanningYearInfo {
  year: number;
  budgetId: number | null;
  /** Version used as "final budget" (the budget's current version). */
  versionId: number | null;
  versionNo: number | null;
  versionStatus: VersionStatus | null;
  /** The originally approved version (null if never approved). */
  approvedVersionId: number | null;
  /** Number of months that have actuals (0–12). */
  monthsWithActuals: number;
  /** All 12 months have actuals. */
  complete: boolean;
}

export interface PlanningYearValues {
  year: number;
  /** Original approved budget (falls back to the current version if never approved). */
  originalBudget: number;
  /** Final budget = current version, after approved change requests. */
  finalBudget: number;
  /** Actuals of the months recorded so far. */
  actual: number;
  /** Full-year expectation: equals `actual` when the year is complete; forecast otherwise. */
  fullYear: number;
  /** True when `fullYear` is a forecast (partial year). */
  isForecast: boolean;
}

export interface PlanningDelta {
  abs: number;
  /** null when the base is zero. */
  pct: number | null;
}

export interface PlanningRow {
  key: string;
  kind: 'section' | 'costCenter' | 'account' | 'line' | 'total';
  id: number;
  code: string;
  name: string;
  /** English name where the master data has one. */
  nameEn: string | null;
  /** Section for cost centers, account group for accounts, cost center for lines. */
  parentName: string | null;
  /** Ids for drill-down / line matching. */
  costCenterId: number | null;
  accountId: number | null;
  sectionUnitId: number | null;
  /** The row can be drilled into (section → cost centers → accounts). */
  hasChildren: boolean;
  /** Prior years, most recent first (Y-1, Y-2, …). */
  years: PlanningYearValues[];
  /** Annual plan of the selected version. */
  plan: number;
  /** Plan − last year's full-year actual (or forecast when partial). */
  vsLastActual: PlanningDelta;
  /** Plan − last year's final budget. */
  vsLastBudget: PlanningDelta;
  /** Only for groupBy=line: last year's months (actual for closed months, forecast basis for the rest). */
  lastYearMonths?: number[];
  /** Only for groupBy=line: last year's final budget months. */
  lastBudgetMonths?: number[];
}

export interface PlanningCrumb {
  level: 'section' | 'costCenter' | 'account';
  id: number;
  label: string;
}

export interface PlanningComparisonDto {
  budgetId: number;
  fiscalYear: number;
  versionId: number;
  versionNo: number;
  versionStatus: VersionStatus;
  currency: string;
  groupBy: PlanningGroupBy;
  forecastMethod: PlanningForecastMethod;
  /** Prior years, most recent first. */
  years: PlanningYearInfo[];
  /** Applied drill-down filters, outermost first. */
  path: PlanningCrumb[];
  rows: PlanningRow[];
  totals: PlanningRow;
  /** False when the user only sees part of the company (department head, cost-center owner). */
  companyWide: boolean;
}

export interface PlanningMonthlyYear {
  year: number;
  complete: boolean;
  monthsWithActuals: number;
  originalBudget: number[];
  budget: number[];
  /** null for months without actuals yet. */
  actual: (number | null)[];
}

export interface PlanningMonthlyDto {
  budgetId: number;
  fiscalYear: number;
  versionId: number;
  currency: string;
  path: PlanningCrumb[];
  /** Most recent first. */
  years: PlanningMonthlyYear[];
  plan: number[];
}
