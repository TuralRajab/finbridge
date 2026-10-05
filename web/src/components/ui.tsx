import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { varianceState, type BudgetCheckState, type ErrorCode, type InstanceStatus, type RequestStatus, type SectionStatus, type TaskStatus, type VersionStatus } from '@finbridge/shared';
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

const VERSION_TONE: Record<VersionStatus, string> = { DRAFT: 'neutral', IN_APPROVAL: 'warning', APPROVED: 'success', LOCKED: 'dark', SUPERSEDED: 'muted' };
const SECTION_TONE: Record<SectionStatus, string> = { NOT_STARTED: 'neutral', IN_PROGRESS: 'info', IN_APPROVAL: 'warning', RETURNED: 'danger', APPROVED: 'success' };
const REQUEST_TONE: Record<RequestStatus, string> = { DRAFT: 'neutral', IN_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'danger', RETURNED: 'danger', CANCELLED: 'muted', CLOSED: 'dark' };
const INSTANCE_TONE: Record<InstanceStatus, string> = { IN_REVIEW: 'warning', APPROVED: 'success', REJECTED: 'danger', RETURNED: 'danger', CANCELLED: 'muted', EXPIRED: 'muted' };
const TASK_TONE: Record<TaskStatus, string> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', RETURNED: 'danger', SKIPPED: 'muted', CANCELLED: 'muted' };
const CHECK_TONE: Record<BudgetCheckState, string> = { WITHIN: 'success', NEAR: 'warning', OVER: 'danger' };

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${VERSION_TONE[status]}`}>{t(`versionStatus.${status}`)}</span>;
}

export function SectionStatusBadge({ status }: { status: SectionStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${SECTION_TONE[status]}`}>{t(`sectionStatus.${status}`)}</span>;
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${REQUEST_TONE[status]}`}>{t(`requestStatus.${status}`)}</span>;
}

export function InstanceStatusBadge({ status }: { status: InstanceStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${INSTANCE_TONE[status]}`}>{t(`instanceStatus.${status}`)}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-${TASK_TONE[status]}`}>{t(`taskStatus.${status}`)}</span>;
}

/** Funds-check state; icon + text, never colour alone. */
export function BudgetCheckBadge({ state }: { state: BudgetCheckState | null | undefined }) {
  const { t } = useI18n();
  if (!state) return <span className="muted">—</span>;
  const icon = state === 'OVER' ? '▲' : state === 'NEAR' ? '!' : '✓';
  return <span className={`badge badge-${CHECK_TONE[state]}`}><span aria-hidden="true">{icon}</span> {t(`budgetCheck.${state}`)}</span>;
}

/** Consumption bar: actual (solid) + committed (hatched) against 100 % budget. */
export function ConsumptionBar({ actual, committed, budget, pending = 0 }: { actual: number; committed: number; budget: number; pending?: number }) {
  const { locale } = useI18n();
  const pctOf = (v: number) => (budget > 0 ? Math.max(0, (v / budget) * 100) : 0);
  const used = pctOf(actual + committed + pending);
  const over = used > 100;
  return (
    <div className={`cbar${over ? ' cbar-over' : ''}`} title={`${pct(used, locale, false)}`}>
      <div className="cbar-track">
        <span className="cbar-actual" style={{ width: `${Math.min(100, pctOf(actual))}%` }} />
        <span className="cbar-committed" style={{ width: `${Math.min(100 - Math.min(100, pctOf(actual)), pctOf(committed))}%` }} />
        {pending > 0 && <span className="cbar-pending" style={{ width: `${Math.max(0, Math.min(100 - pctOf(actual + committed), pctOf(pending)))}%` }} />}
      </div>
      <span className="cbar-label">{pct(used, locale, false)}</span>
    </div>
  );
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
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  workflow: 'M5 4h6v6H5zM13 14h6v6h-6zM8 10v4a2 2 0 0 0 2 2h3',
  request: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4',
  change: 'M4 7h13l-3-3M20 17H7l3 3',
  report: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  org: 'M10 3h4v4h-4zM4 17h4v4H4zM16 17h4v4h-4zM12 7v5M6 17v-3h12v3',
  template: 'M4 4h16v5H4zM4 13h7v7H4zM15 13h5v7h-5z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  audit: 'M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',
  delegate: 'M17 8l4 4-4 4M21 12H9M9 4H5v16h4',
  wand: 'M15 4V2M15 10V8M11 6h2M17 6h2M4 20l11-11',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  compare: 'M8 3v18M16 3v18M3 8h5M16 16h5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
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
