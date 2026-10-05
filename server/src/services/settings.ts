import type { CompanySettingsDto } from '@finbridge/shared';
import { get } from '../db/database';

export function getSettings(companyId: number): CompanySettingsDto {
  const s = get<{ near_limit_pct: number; availability_basis: 'ANNUAL' | 'YTD'; include_pending_in_available: number; block_over_budget: number; auto_lock_on_approval: number }>(
    'SELECT * FROM company_settings WHERE company_id = ?', companyId,
  );
  return {
    nearLimitPct: s?.near_limit_pct ?? 90,
    availabilityBasis: s?.availability_basis ?? 'ANNUAL',
    includePendingInAvailable: (s?.include_pending_in_available ?? 1) === 1,
    blockOverBudget: (s?.block_over_budget ?? 0) === 1,
    autoLockOnApproval: (s?.auto_lock_on_approval ?? 0) === 1,
  };
}

export function companyRow(companyId: number): { base_currency: string; industry_code: string | null; name: string } {
  return get<{ base_currency: string; industry_code: string | null; name: string }>('SELECT base_currency, industry_code, name FROM companies WHERE id = ?', companyId)!;
}
