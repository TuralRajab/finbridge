import type { CompanyDto, UserDto, Lang, Role } from '@finbridge/shared';
import { toLicenseDto, type CompanyRow } from './license';

export interface UserRow {
  id: number;
  company_id: number | null;
  email: string;
  full_name: string;
  password_hash: string;
  role: Role;
  department_id: number | null;
  language: Lang;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    companyId: u.company_id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    departmentId: u.department_id,
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
    baseCurrency: c.base_currency,
    license: toLicenseDto(c),
    createdAt: c.created_at,
  };
}
