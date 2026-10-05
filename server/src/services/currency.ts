import { get } from '../db/database';
import { today } from '../lib/clock';
import { badRequest } from '../lib/errors';
import { companyRow } from './settings';

/** Base-currency units per 1 unit of `currency` on `date` (latest rate on or before the date). */
export function rateFor(companyId: number, currency: string, date = today()): number {
  const base = companyRow(companyId).base_currency;
  if (currency === base) return 1;
  const r = get<{ rate: number }>(
    'SELECT rate FROM exchange_rates WHERE company_id = ? AND currency = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1',
    companyId, currency, date,
  );
  if (!r) throw badRequest('VALIDATION_ERROR', `No exchange rate for ${currency} → ${base}. Add one under Currencies.`);
  return r.rate;
}
