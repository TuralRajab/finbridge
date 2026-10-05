import type { Lang } from './months';
import { MONTH_NAMES, MONTH_SHORT } from './months';

/**
 * Column headers FinBridge recognises when importing Excel files.
 * Headers are normalised (lower case, no spaces/punctuation) before matching,
 * so "CC code", "cc_code" and "CC-Code" all match.
 */
export const IMPORT_HEADER_ALIASES = {
  departmentCode: ['dept', 'department', 'departmentcode', 'deptcode', 'departament', 'departamentkodu', 'şöbə', 'şöbəkodu'],
  departmentName: ['departmentname', 'deptname', 'departamentadı', 'şöbəadı'],
  costCenterCode: ['cc', 'cccode', 'costcenter', 'costcentercode', 'xərcmərkəzi', 'xərcmərkəzikodu', 'xmkodu'],
  costCenterName: ['costcentername', 'ccname', 'xərcmərkəziadı'],
  accountCode: ['gl', 'glaccount', 'account', 'accountcode', 'glcode', 'hesab', 'hesabkodu'],
  accountName: ['accountname', 'glname', 'hesabadı'],
  accountType: ['type', 'capexopex', 'accounttype', 'növ', 'tip'],
  description: ['description', 'comment', 'təsvir', 'açıqlama', 'qeyd'],
  month: ['month', 'ay'],
  amount: ['amount', 'actual', 'value', 'məbləğ', 'fakt', 'faktiki'],
} as const;

export type ImportField = keyof typeof IMPORT_HEADER_ALIASES;

export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLocaleLowerCase('az')
    .replace(/[\s_\-./()]+/g, '')
    .trim();
}

/** Returns the month number (1–12) if the header is a month name in AZ or EN, e.g. "Jan", "Yanvar", "M01". */
export function monthFromHeader(h: unknown): number | null {
  const n = normalizeHeader(h);
  if (!n) return null;
  for (const lang of ['az', 'en'] as Lang[]) {
    for (let i = 0; i < 12; i++) {
      if (n === normalizeHeader(MONTH_NAMES[lang][i]) || n === normalizeHeader(MONTH_SHORT[lang][i])) return i + 1;
    }
  }
  const m = /^m0?(\d{1,2})$/.exec(n);
  if (m) {
    const v = Number(m[1]);
    if (v >= 1 && v <= 12) return v;
  }
  return null;
}

export function fieldFromHeader(h: unknown): ImportField | null {
  const n = normalizeHeader(h);
  for (const [field, aliases] of Object.entries(IMPORT_HEADER_ALIASES)) {
    if ((aliases as readonly string[]).includes(n)) return field as ImportField;
  }
  return null;
}

/** Localised headers used in exported files and templates. */
export const EXPORT_HEADERS: Record<Lang, Record<string, string>> = {
  az: {
    departmentCode: 'Departament kodu',
    departmentName: 'Departament',
    costCenterCode: 'Xərc mərkəzi kodu',
    costCenterName: 'Xərc mərkəzi',
    accountCode: 'Hesab kodu',
    accountName: 'Hesab',
    accountType: 'Növ',
    description: 'Təsvir',
    total: 'Cəmi',
    month: 'Ay',
    amount: 'Məbləğ',
    code: 'Kod',
    name: 'Ad',
    manager: 'Menecer',
    owner: 'Məsul şəxs',
    status: 'Status',
    annualBudget: 'İllik büdcə',
    budgetYtd: 'Büdcə (dövr)',
    actualYtd: 'Fakt (dövr)',
    variance: 'Fərq',
    variancePct: 'Fərq %',
    forecast: 'Proqnoz (il)',
    budget: 'Büdcə',
    email: 'E-poçt',
    fullName: 'Ad, soyad',
    role: 'Rol',
    active: 'Aktiv',
    orgUnit: 'Struktur vahidi',
    section: 'Büdcə bölməsi',
    committed: 'Öhdəlik',
    pending: 'Təsdiqdə',
    actual: 'Fakt',
    available: 'Mövcud qalıq',
    consumptionPct: 'İstifadə %',
    originalBudget: 'İlkin büdcə',
    parentCode: 'Üst hesab',
    expenseClass: 'OPEX/CAPEX',
    category: 'Kateqoriya',
  },
  en: {
    departmentCode: 'Department code',
    departmentName: 'Department',
    costCenterCode: 'Cost center code',
    costCenterName: 'Cost center',
    accountCode: 'Account code',
    accountName: 'Account',
    accountType: 'Type',
    description: 'Description',
    total: 'Total',
    month: 'Month',
    amount: 'Amount',
    code: 'Code',
    name: 'Name',
    manager: 'Manager',
    owner: 'Owner',
    status: 'Status',
    annualBudget: 'Annual budget',
    budgetYtd: 'Budget (period)',
    actualYtd: 'Actual (period)',
    variance: 'Variance',
    variancePct: 'Variance %',
    forecast: 'Forecast (FY)',
    budget: 'Budget',
    email: 'Email',
    fullName: 'Full name',
    role: 'Role',
    active: 'Active',
    orgUnit: 'Org unit',
    section: 'Budget section',
    committed: 'Committed',
    pending: 'In approval',
    actual: 'Actual',
    available: 'Available',
    consumptionPct: 'Consumption %',
    originalBudget: 'Original budget',
    parentCode: 'Parent account',
    expenseClass: 'OPEX/CAPEX',
    category: 'Category',
  },
};
