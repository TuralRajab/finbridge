import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { varianceState, type BudgetStatus, type DeptStatus, type ErrorCode } from '@finbridge/shared';
import { ApiError, download } from '../api/client';
import { useI18n, type TKey } from '../i18n';
import { pct, signedMoney } from '../lib/format';

/* ------------------------------------------------------------------ basics */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export function Button({ variant = 'secondary', size, busy, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`}>
      {busy && <span className="spinner-sm" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = '', flush }:
  { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'card-body'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="loading"><span className="spinner" aria-hidden="true" />{label ?? t('common.loading')}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function errorText(err: unknown, t: (k: TKey) => string): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}` as TKey;
    const translated = t(key);
    return translated === key ? err.message : translated;
  }
  return t('errors.INTERNAL_ERROR');
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return <div className="alert alert-error" role="alert">{errorText(error, t)}</div>;
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'success' | 'error'; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[] }) {
  return (
    <select {...props} className={`input select ${props.className ?? ''}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmation dialog with optional / required comment used by every workflow action. */
export function ActionDialog({ title, hint, commentRequired, confirmLabel, danger, onConfirm, onClose }: {
  title: string; hint: string; commentRequired?: boolean; confirmLabel: string; danger?: boolean;
  onConfirm: (comment: string) => Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(comment); onClose(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={commentRequired && !comment.trim()} onClick={submit}>{confirmLabel}</Button>
    </>}>
      <p className="muted">{hint}</p>
      <Field label={<>{t('common.comment')} {!commentRequired && <span className="muted">({t('common.optional')})</span>}</>}>
        {(id) => <textarea id={id} className="input textarea" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      <ErrorMessage error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ domain */

const BUDGET_TONE: Record<BudgetStatus, string> = { DRAFT: 'neutral', COLLECTING: 'info', CFO_REVIEW: 'warning', APPROVED: 'success', LOCKED: 'dark' };
const DEPT_TONE: Record<DeptStatus, string> = { NOT_STARTED: 'neutral', IN_PROGRESS: 'info', SUBMITTED: 'warning', CHANGES_REQUESTED: 'danger', REVIEWED: 'success' };

export function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${BUDGET_TONE[status]}`}>{t(`budgetStatus.${status}`)}</span>;
}

export function DeptStatusBadge({ status }: { status: DeptStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${DEPT_TONE[status]}`}>{t(`deptStatus.${status}`)}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Positive variance = overspend (red ▲), negative = saving (green ▼). Never colour alone. */
export function Variance({ value, percent, showPct = false }: { value: number; percent?: number | null; showPct?: boolean }) {
  const { locale, t } = useI18n();
  const state = varianceState(value);
  const icon = state === 'over' ? '▲' : state === 'under' ? '▼' : '•';
  return (
    <span className={`var var-${state}`} title={state === 'over' ? t('dashboard.over') : state === 'under' ? t('dashboard.under') : undefined}>
      <span className="var-ico" aria-hidden="true">{icon}</span>
      {signedMoney(value, locale)}
      {showPct && percent !== undefined && <small className="var-pct">{pct(percent, locale)}</small>}
    </span>
  );
}

export function VariancePct({ value }: { value: number | null }) {
  const { locale } = useI18n();
  const state = value === null ? 'on' : varianceState(value, 0.05);
  return <span className={`var var-${state}`}>{pct(value, locale)}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value}
          className={`tab${tab.value === value ? ' is-active' : ''}`} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function ExportButton({ path, filename, label }: { path: string; filename: string; label?: string }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sep = path.includes('?') ? '&' : '?';
  return (
    <>
      <Button busy={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await download(`${path}${sep}lang=${lang}`, filename); } catch (e) { setError(e); } finally { setBusy(false); }
      }}>
        <Icon name="download" /> {label ?? t('common.exportExcel')}
      </Button>
      {error ? <span className="field-error">{errorText(error, t)}</span> : null}
    </>
  );
}

export function isErrorCode(err: unknown, code: ErrorCode): boolean {
  return err instanceof ApiError && err.code === code;
}

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  budget: 'M4 5h16v14H4zM4 9h16M9 9v10',
  pva: 'M4 20h16M7 16V9M11 16V5M15 16v-4M19 16V8',
  actuals: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  departments: 'M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6',
  costCenters: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  accounts: 'M4 6h16M4 12h16M4 18h10',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  company: 'M4 21V5l8-2v18M12 21h8V9l-8-2M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01',
  platform: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 20h14',
  plus: 'M12 5v14M5 12h14',
  logout: 'M15 17l5-5-5-5M20 12H9M12 20H5V4h7',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function Logo({ light }: { light?: boolean }) {
  return (
    <span className={`brand${light ? ' brand-light' : ''}`}>
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#2350d0" />
        <path d="M6 22.5h20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M7 20.5c3.2-7.4 14.8-7.4 18 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M11.5 16.9v5.6M16 15.3v7.2M20.5 16.9v5.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
      </svg>
      <span>FinBridge</span>
    </span>
  );
}
