import { Router } from 'express';
import { z } from 'zod';
import type { CurrencyDto, ExchangeRateDto } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { audit, diff } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { conflict, notFound } from '../lib/errors';
import type { CompanyRow } from '../lib/license';
import { toCompanyDto } from '../lib/mappers';
import { toId } from '../lib/params';
import { getSettings } from '../services/settings';

export const companyRouter = Router();

companyRouter.get('/', (req, res) => {
  res.json(toCompanyDto(get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyIdOf(req))!));
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  taxId: z.string().trim().max(20).nullable().optional(),
  baseCurrency: z.string().length(3).optional(),
  defaultLanguage: z.enum(['az', 'en']).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

companyRouter.patch('/', requirePermission('company.manage'), (req, res) => {
  const id = companyIdOf(req);
  const b = updateSchema.parse(req.body);
  const c = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id)!;
  if (b.baseCurrency && b.baseCurrency !== c.base_currency) {
    if (!get('SELECT 1 FROM currencies WHERE code = ?', b.baseCurrency)) throw notFound('Currency');
    if (get('SELECT 1 FROM budgets WHERE company_id = ? LIMIT 1', id)) {
      throw conflict('CONFLICT', 'The base currency cannot change once budgets exist');
    }
  }
  run('UPDATE companies SET name = ?, tax_id = ?, base_currency = ?, default_language = ?, fiscal_year_start_month = ? WHERE id = ?',
    b.name ?? c.name, b.taxId === undefined ? c.tax_id : b.taxId, b.baseCurrency ?? c.base_currency, b.defaultLanguage ?? c.default_language,
    b.fiscalYearStartMonth ?? c.fiscal_year_start_month, id);
  audit(id, currentUser(req).id, 'COMPANY', id, 'UPDATED', diff({ name: c.name, taxId: c.tax_id, baseCurrency: c.base_currency }, b));
  res.json(toCompanyDto(get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id)!));
});

/* ------------------------------------------------------------------ settings */

companyRouter.get('/settings', (req, res) => { res.json(getSettings(companyIdOf(req))); });

const settingsSchema = z.object({
  nearLimitPct: z.number().min(1).max(100).optional(),
  availabilityBasis: z.enum(['ANNUAL', 'YTD']).optional(),
  includePendingInAvailable: z.boolean().optional(),
  blockOverBudget: z.boolean().optional(),
  autoLockOnApproval: z.boolean().optional(),
});

companyRouter.patch('/settings', requirePermission('company.manage'), (req, res) => {
  const id = companyIdOf(req);
  const before = getSettings(id);
  const b = { ...before, ...settingsSchema.parse(req.body) };
  run(`UPDATE company_settings SET near_limit_pct = ?, availability_basis = ?, include_pending_in_available = ?, block_over_budget = ?,
         auto_lock_on_approval = ?, updated_at = ? WHERE company_id = ?`,
    b.nearLimitPct, b.availabilityBasis, b.includePendingInAvailable ? 1 : 0, b.blockOverBudget ? 1 : 0, b.autoLockOnApproval ? 1 : 0, nowIso(), id);
  audit(id, currentUser(req).id, 'SETTINGS', id, 'UPDATED', diff(before as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>));
  res.json(getSettings(id));
});

/* ------------------------------------------------------------------ currencies & rates */

companyRouter.get('/currencies', (_req, res) => {
  res.json(all<{ code: string; name_az: string; name_en: string; symbol: string; decimals: number }>('SELECT * FROM currencies ORDER BY code')
    .map((c): CurrencyDto => ({ code: c.code, nameAz: c.name_az, nameEn: c.name_en, symbol: c.symbol, decimals: c.decimals })));
});

companyRouter.get('/exchange-rates', (req, res) => {
  res.json(all<{ id: number; currency: string; rate: number; valid_from: string }>(
    'SELECT * FROM exchange_rates WHERE company_id = ? ORDER BY currency, valid_from DESC', companyIdOf(req),
  ).map((r): ExchangeRateDto => ({ id: r.id, currency: r.currency, rate: r.rate, validFrom: r.valid_from })));
});

const rateSchema = z.object({ currency: z.string().length(3), rate: z.number().positive().max(1e6), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

companyRouter.post('/exchange-rates', requirePermission('coa.manage'), (req, res) => {
  const id = companyIdOf(req);
  const b = rateSchema.parse(req.body);
  if (!get('SELECT 1 FROM currencies WHERE code = ?', b.currency)) throw notFound('Currency');
  const rid = run('INSERT INTO exchange_rates (company_id, currency, rate, valid_from, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, currency, valid_from) DO UPDATE SET rate = excluded.rate',
    id, b.currency, b.rate, b.validFrom, nowIso()).lastInsertRowid;
  audit(id, currentUser(req).id, 'EXCHANGE_RATE', rid, 'SAVED', b);
  res.status(201).json({ ok: true });
});

companyRouter.delete('/exchange-rates/:id', requirePermission('coa.manage'), (req, res) => {
  const id = companyIdOf(req);
  const r = run('DELETE FROM exchange_rates WHERE id = ? AND company_id = ?', toId(req.params.id), id);
  if (!r.changes) throw notFound('Exchange rate');
  audit(id, currentUser(req).id, 'EXCHANGE_RATE', toId(req.params.id), 'DELETED', null);
  res.status(204).end();
});
