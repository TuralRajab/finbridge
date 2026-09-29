import { MONTH_SHORT, type Lang } from '@finbridge/shared';

const MINUS = '−';
const NBSP = ' ';

/**
 * Number formatting that does not depend on the browser's ICU data:
 * az → 1 234 567,89 (space groups, comma decimals), en → 1,234,567.89.
 */
function formatNumber(n: number, locale: string, min: number, max: number): string {
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max }).format(n);
  if (!locale.startsWith('az')) return s;
  return s.replace(/,/g, NBSP).replace('.', ',');
}

export function money(n: number | null | undefined, locale: string, digits = 0): string {
  if (n === null || n === undefined) return '—';
  const s = formatNumber(Math.abs(n), locale, digits, digits);
  return n < 0 ? MINUS + s : s;
}

export function signedMoney(n: number, locale: string): string {
  if (Math.round(n) === 0) return '0';
  return (n > 0 ? '+' : MINUS) + money(Math.abs(n), locale);
}

/** Compact amount for KPI tiles: 1.2M / 845K. */
export function compact(n: number, locale: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  const f = (v: number, d: number) => formatNumber(v, locale, d, d);
  if (abs >= 1_000_000) return `${sign}${f(abs / 1_000_000, 2)}M`;
  if (abs >= 10_000) return `${sign}${f(abs / 1000, 0)}K`;
  return sign + f(abs, 0);
}

export function pct(n: number | null | undefined, locale: string, signed = true): string {
  if (n === null || n === undefined) return '—';
  const s = formatNumber(Math.abs(n), locale, 1, 1);
  if (!signed) return `${s}%`;
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${s}%`;
}

export function date(iso: string | null | undefined, locale: string, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.length === 10 ? `${iso}T00:00:00` : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (v: number) => String(v).padStart(2, '0');
  const time = withTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  if (locale.startsWith('az')) return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}${time}`;
  return `${pad(d.getDate())} ${MONTH_SHORT.en[d.getMonth()]} ${d.getFullYear()}${time}`;
}

export function periodLabel(through: number, lang: Lang): string {
  if (!through) return '—';
  const m = MONTH_SHORT[lang];
  return through === 1 ? m[0] : `${m[0]}–${m[through - 1]}`;
}

/** Parses user input like "12 500", "12,500.50" or "12500,5". */
export function parseAmount(input: string): number | null {
  const t = input.trim().replace(/\s/g, '');
  if (!t) return 0;
  const normalised = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
