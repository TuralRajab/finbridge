import type { LicenseDto, LicensePlan } from '@finbridge/shared';
import { get } from '../db/database';
import { HttpError } from './errors';
import { today } from './clock';

export interface CompanyRow {
  id: number;
  name: string;
  tax_id: string | null;
  base_currency: string;
  industry_code: string | null;
  default_language: 'az' | 'en';
  fiscal_year_start_month: number;
  setup_completed_at: string | null;
  license_plan: LicensePlan;
  license_max_users: number;
  license_valid_until: string;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
}

export function isLicenseValid(c: CompanyRow): boolean {
  return c.status === 'ACTIVE' && c.license_valid_until >= today();
}

/** Throws when the company's licence does not allow access. */
export function assertLicense(c: CompanyRow): void {
  if (c.status === 'SUSPENDED') throw new HttpError(403, 'LICENSE_SUSPENDED', 'The company licence is suspended');
  if (c.license_valid_until < today()) throw new HttpError(403, 'LICENSE_EXPIRED', 'The company licence has expired');
}

export function countActiveUsers(companyId: number): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND is_active = 1', companyId)?.n ?? 0;
}

/** Throws when activating one more user would exceed the licensed seats. */
export function assertSeatAvailable(companyId: number): void {
  const c = get<CompanyRow>('SELECT * FROM companies WHERE id = ?', companyId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  if (countActiveUsers(companyId) >= c.license_max_users) {
    throw new HttpError(409, 'LICENSE_SEAT_LIMIT', `The licence allows ${c.license_max_users} active users`);
  }
}

export function toLicenseDto(c: CompanyRow): LicenseDto {
  return {
    plan: c.license_plan,
    maxUsers: c.license_max_users,
    usedUsers: countActiveUsers(c.id),
    validUntil: c.license_valid_until,
    status: c.status,
    isValid: isLicenseValid(c),
  };
}
