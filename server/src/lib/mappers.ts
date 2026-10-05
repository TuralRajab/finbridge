import type { CompanyDto, Lang, Role, UserDto } from '@finbridge/shared';
import { get } from '../db/database';
import { toLicenseDto, type CompanyRow } from './license';

export interface UserRow {
  id: number;
  company_id: number | null;
  email: string;
  full_name: string;
  password_hash: string;
  role: Role;
  org_unit_id: number | null;
  manager_id: number | null;
  job_family_id: number | null;
  job_title: string | null;
  language: Lang;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export function toUserDto(u: UserRow, orgUnitName?: string | null): UserDto {
  const unitName = orgUnitName !== undefined ? orgUnitName
    : u.org_unit_id ? get<{ name: string }>('SELECT name FROM org_units WHERE id = ?', u.org_unit_id)?.name ?? null : null;
  return {
    id: u.id,
    companyId: u.company_id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    orgUnitId: u.org_unit_id,
    orgUnitName: unitName,
    managerId: u.manager_id,
    jobFamilyId: u.job_family_id,
    jobTitle: u.job_title,
    language: u.language,
    isActive: u.is_active === 1,
    lastLoginAt: u.last_login_at,
  };
}

export function toCompanyDto(c: CompanyRow): CompanyDto {
  return {
    id: c.id,
    name: c.name,
    taxId: c.tax_id,
    industryCode: c.industry_code,
    baseCurrency: c.base_currency,
    defaultLanguage: c.default_language,
    fiscalYearStartMonth: c.fiscal_year_start_month,
    setupCompleted: c.setup_completed_at !== null,
    license: toLicenseDto(c),
    createdAt: c.created_at,
  };
}

export const bool = (v: unknown): boolean => v === 1 || v === true;
export const int = (b: boolean | undefined, fallback: number): number => (b === undefined ? fallback : b ? 1 : 0);
