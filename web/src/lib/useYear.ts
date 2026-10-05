import { useEffect, useState } from 'react';
import type { BudgetDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const KEY = 'finbridge.year';

/** Selected fiscal year (shared between dashboard, Plan vs Actual and actuals) plus the years that have budgets. */
export function useYear() {
  const current = new Date().getFullYear();
  const [year, setYearState] = useState<number>(() => {
    try { return Number(sessionStorage.getItem(KEY)) || current; } catch { return current; }
  });
  const [years, setYears] = useState<number[]>([current]);
  const { can } = useAuth();
  const canSeeBudgets = can('budget.view');
  useEffect(() => {
    // employees cannot list budgets; they get the current year ± 1 to pick from
    if (!canSeeBudgets) { setYears([current + 1, current, current - 1]); return; }
    api<BudgetDto[]>('GET', '/budgets')
      .then((b) => setYears([...new Set([current, ...b.map((x) => x.fiscalYear)])].sort((a, c) => c - a)))
      .catch(() => undefined);
  }, [current, canSeeBudgets]);
  const setYear = (y: number) => {
    setYearState(y);
    try { sessionStorage.setItem(KEY, String(y)); } catch { /* ignore */ }
  };
  return { year, setYear, years };
}
