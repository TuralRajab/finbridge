import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n';
import { money, parseAmount, signedMoney } from '../../lib/format';
import { errorText } from '../../components/ui';

/** Inline amount cell: shows formatted money, edits raw number; Enter commits, Escape reverts. */
export function AmountInput({ value, onChange, label, placeholder, min0 }: {
  value: number | null; onChange: (v: number | null) => void; label: string; placeholder?: string; min0?: boolean;
}) {
  const { locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const parsed = text === null ? null : parseAmount(text);
  const invalid = text !== null && text.trim() !== '' && (parsed === null || (min0 && parsed < 0));
  return (
    <input
      className={`cell-input${invalid ? ' invalid' : ''}`}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={text ?? (value === null ? '' : money(value, locale, value % 1 ? 2 : 0))}
      onFocus={(e) => { setText(value === null ? '' : String(value)); const el = e.target; requestAnimationFrame(() => el.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null) {
          if (text.trim() === '' && value !== null && placeholder !== undefined) onChange(null);
          else {
            const n = parseAmount(text);
            if (n !== null && !(min0 && n < 0) && n !== value) onChange(n);
          }
        }
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
      }}
    />
  );
}

/** Neutral budget delta: ▲ increase / ▼ decrease with sign; not judged as good or bad. */
export function Delta({ value, strong }: { value: number; strong?: boolean }) {
  const { locale } = useI18n();
  const r = Math.round(value * 100) / 100;
  const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'zero';
  return (
    <span className={`delta delta-${dir}${strong ? ' delta-strong' : ''}`}>
      {dir !== 'zero' && <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>}
      {signedMoney(r, locale)}
    </span>
  );
}

/** Error text that keeps the server's specific message for validation / import errors. */
export function DetailedError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const base = errorText(error, t);
  const extra = error instanceof ApiError && (error.code === 'VALIDATION_ERROR' || error.code === 'IMPORT_FAILED' || error.code === 'SECTIONS_NOT_APPROVED') && error.message && error.message !== base
    ? error.message : null;
  return (
    <div className="alert alert-error" role="alert">
      {base}
      {extra && <div className="small">{extra}</div>}
    </div>
  );
}

export const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
