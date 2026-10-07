import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WORKFLOW_TYPES, type AuditLogDto, type ImportJobDto } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-security.css';

const az = {
  title: 'Audit jurnalı',
  subtitle: 'Kim, nə vaxt, nəyi dəyişdi. Jurnal yalnız əlavə olunur — qeydlər dəyişdirilə və silinə bilməz.',
  tabLog: 'Dəyişikliklər jurnalı',
  tabWorkflow: 'Təsdiq əməliyyatları',
  tabImports: 'İdxal tarixçəsi',
  entity: 'Obyekt',
  allEntities: 'Bütün obyektlər',
  allUsers: 'Bütün istifadəçilər',
  allActions: 'Bütün əməliyyatlar',
  allTypes: 'Bütün axın növləri',
  action: 'Əməliyyat',
  from: 'Tarixdən',
  to: 'Tarixədək',
  limit: 'Son qeydlər',
  last: 'Son {n}',
  searchPh: 'Sahə, dəyər, şərh…',
  shown: '{n} qeyd göstərilir',
  limitNote: 'Server ən son {n} qeydi qaytarır; daha köhnə qeydlər üçün limiti artırın və ya obyekt növü üzrə süzün.',
  system: 'Sistem',
  noChanges: 'Ətraflı məlumat qeyd edilməyib.',
  field: 'Sahə',
  oldValue: 'Əvvəlki dəyər',
  newValue: 'Yeni dəyər',
  value: 'Dəyər',
  expand: 'Ətraflı göstər',
  collapse: 'Gizlət',
  fields: '{n} sahə',
  workflow: 'Axın',
  document: 'Sənəd',
  statusChange: 'Status',
  comment: 'Şərh',
  file: 'Fayl',
  kind: 'Növ',
  rowsRead: 'Oxunan sətir',
  rowsValid: 'Düzgün sətir',
  total: 'Cəmi məbləğ',
  errors: 'Xəta',
  kindBudget: 'Büdcə',
  kindActuals: 'Faktiki xərclər',
  stValidated: 'Yoxlanılıb (tətbiq edilməyib)',
  stApplied: 'Tətbiq edilib',
  stFailed: 'Uğursuz',
  importsLimit: 'Son 200 idxal göstərilir.',
  wfLimit: 'Son 500 təsdiq əməliyyatı göstərilir.',
  overdue: 'Müddət keçdi (SLA)',
};
const en: typeof az = {
  title: 'Audit log',
  subtitle: 'Who changed what, and when. The log is append-only — entries cannot be edited or deleted.',
  tabLog: 'Change log',
  tabWorkflow: 'Approval actions',
  tabImports: 'Import history',
  entity: 'Object',
  allEntities: 'All objects',
  allUsers: 'All users',
  allActions: 'All actions',
  allTypes: 'All workflow types',
  action: 'Action',
  from: 'From',
  to: 'To',
  limit: 'Latest entries',
  last: 'Last {n}',
  searchPh: 'Field, value, comment…',
  shown: '{n} entries shown',
  limitNote: 'The server returns the latest {n} entries; raise the limit or filter by object type to reach older ones.',
  system: 'System',
  noChanges: 'No details were recorded.',
  field: 'Field',
  oldValue: 'Old value',
  newValue: 'New value',
  value: 'Value',
  expand: 'Show details',
  collapse: 'Hide',
  fields: '{n} fields',
  workflow: 'Workflow',
  document: 'Document',
  statusChange: 'Status',
  comment: 'Comment',
  file: 'File',
  kind: 'Kind',
  rowsRead: 'Rows read',
  rowsValid: 'Valid rows',
  total: 'Total amount',
  errors: 'Errors',
  kindBudget: 'Budget',
  kindActuals: 'Actuals',
  stValidated: 'Validated (not applied)',
  stApplied: 'Applied',
  stFailed: 'Failed',
  importsLimit: 'The latest 200 imports are shown.',
  wfLimit: 'The latest 500 approval actions are shown.',
  overdue: 'Overdue (SLA)',
};
const TEXT = { az, en };

const ENTITY: Record<string, { az: string; en: string }> = {
  ACCOUNT: { az: 'Hesab', en: 'Account' },
  ACTUAL: { az: 'Faktiki xərc', en: 'Actual' },
  ACTUALS: { az: 'Faktiki xərclər (idxal)', en: 'Actuals (import)' },
  BUDGET: { az: 'Büdcə', en: 'Budget' },
  BUDGET_LINE: { az: 'Büdcə sətri', en: 'Budget line' },
  BUDGET_SECTION: { az: 'Büdcə bölməsi', en: 'Budget section' },
  BUDGET_VERSION: { az: 'Büdcə versiyası', en: 'Budget version' },
  CHANGE_REQUEST: { az: 'Büdcə dəyişikliyi', en: 'Budget change' },
  COMPANY: { az: 'Şirkət', en: 'Company' },
  COST_CENTER: { az: 'Xərc mərkəzi', en: 'Cost center' },
  DELEGATION: { az: 'Səlahiyyət ötürmə', en: 'Delegation' },
  EXCHANGE_RATE: { az: 'Valyuta məzənnəsi', en: 'Exchange rate' },
  JOB_FAMILY: { az: 'Peşə ailəsi', en: 'Job family' },
  LICENSE: { az: 'Lisenziya', en: 'Licence' },
  ORG_UNIT: { az: 'Struktur vahidi', en: 'Org unit' },
  ORG_UNIT_TYPE: { az: 'Vahid növü', en: 'Unit type' },
  POSITION: { az: 'Vəzifə', en: 'Position' },
  PURCHASE_REQUEST: { az: 'Satınalma / xərc sorğusu', en: 'Purchase / expense request' },
  SETTINGS: { az: 'Büdcə nəzarəti ayarları', en: 'Budget-control settings' },
  USER: { az: 'İstifadəçi', en: 'User' },
  WORKFLOW: { az: 'Təsdiq axını', en: 'Workflow' },
  WORKFLOW_DEFINITION: { az: 'Təsdiq axını', en: 'Workflow' },
};

const ACTION: Record<string, { az: string; en: string }> = {
  CREATED: { az: 'Yaradıldı', en: 'Created' },
  UPDATED: { az: 'Dəyişdirildi', en: 'Updated' },
  DELETED: { az: 'Silindi', en: 'Deleted' },
  SAVED: { az: 'Yadda saxlanıldı', en: 'Saved' },
  MOVED: { az: 'Köçürüldü', en: 'Moved' },
  SUBMITTED: { az: 'Təsdiqə göndərildi', en: 'Submitted' },
  LOCKED: { az: 'Kilidləndi', en: 'Locked' },
  REOPENED: { az: 'Yenidən açıldı', en: 'Reopened' },
  IMPORTED: { az: 'İdxal edildi', en: 'Imported' },
  CANCELLED: { az: 'Ləğv edildi', en: 'Cancelled' },
  REVOKED: { az: 'Geri alındı', en: 'Revoked' },
  TEMPLATE_APPLIED: { az: 'Şablon tətbiq edildi', en: 'Template applied' },
  CREATED_FROM_CHANGE: { az: 'Dəyişiklikdən yaradıldı', en: 'Created from change' },
  ACTUAL_RECORDED: { az: 'Fakt qeydə alındı', en: 'Actual recorded' },
  APPROVED: { az: 'Təsdiqləndi', en: 'Approved' },
  REJECTED: { az: 'Rədd edildi', en: 'Rejected' },
  RETURNED: { az: 'Qaytarıldı', en: 'Returned' },
};

const ACTION_TONE: Record<string, string> = { CREATED: 'info', DELETED: 'danger', REVOKED: 'danger', CANCELLED: 'muted', LOCKED: 'dark', SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'danger', RETURNED: 'danger' };

type Tab = 'log' | 'workflow' | 'imports';

export function AuditPage() {
  const L = useLocal(TEXT);
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'imports' ? 'imports' : params.get('tab') === 'workflow' ? 'workflow' : 'log');
  const tabs: { value: Tab; label: string }[] = [{ value: 'log', label: L.tabLog }, { value: 'workflow', label: L.tabWorkflow }];
  if (can('excel.import')) tabs.push({ value: 'imports', label: L.tabImports });
  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'log' && <LogTab />}
      {tab === 'workflow' && <WorkflowTab />}
      {tab === 'imports' && can('excel.import') && <ImportsTab />}
    </>
  );
}

/** Translate with a fallback when the common dictionary has no such key. */
function useTr() {
  const { t } = useI18n();
  return (key: string, fallback: string) => { const s = t(key as TKey); return s === key ? fallback : s; };
}

function entityHref(type: string, id: number | null): string | null {
  if (!id) return null;
  if (type === 'PURCHASE_REQUEST') return `/requests/${id}`;
  if (type === 'CHANGE_REQUEST') return `/changes/${id}`;
  if (type === 'BUDGET') return `/budgets/${id}`;
  return null;
}

/* ------------------------------------------------------------------ change log */

function LogTab() {
  const L = useLocal(TEXT);
  const { t, lang, locale } = useI18n();
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState(300);
  const { data, error, loading, reload } = useAsync(
    () => api<AuditLogDto[]>('GET', `/audit/logs${qs({ entityType, limit })}`), [entityType, limit]);
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const entityLabel = (e: string) => ENTITY[e]?.[lang] ?? e;
  const actionLabel = (a: string) => ACTION[a]?.[lang] ?? a;

  const users = useMemo(() => [...new Set((data ?? []).map((r) => r.userName ?? ''))].sort(), [data]);
  const actions = useMemo(() => [...new Set((data ?? []).map((r) => r.action))].sort(), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(locale);
    return (data ?? []).filter((r) => {
      const day = localDay(r.createdAt);
      return (!user || (r.userName ?? '') === user) && (!action || r.action === action)
        && (!from || day >= from) && (!to || day <= to)
        && (!needle || JSON.stringify(r.changes ?? '').toLocaleLowerCase(locale).includes(needle) || String(r.entityId ?? '').includes(needle));
    });
  }, [data, user, action, from, to, q, locale]);

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const entityOptions = Object.keys(ENTITY).filter((k) => k !== 'WORKFLOW_DEFINITION').sort((a, b) => entityLabel(a).localeCompare(entityLabel(b), locale));

  return (
    <Card flush>
      <div className="card-body">
        <div className="filters">
          <Field label={L.entity}>
            {(id) => <Select id={id} value={entityType} onChange={(e) => setEntityType(e.target.value)}
              options={[{ value: '', label: L.allEntities }, ...entityOptions.map((k) => ({ value: k, label: entityLabel(k) }))]} />}
          </Field>
          <Field label={t('common.user')}>
            {(id) => <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}
              options={[{ value: '', label: L.allUsers }, ...users.map((u) => ({ value: u, label: u || L.system }))]} />}
          </Field>
          <Field label={L.action}>
            {(id) => <Select id={id} value={action} onChange={(e) => setAction(e.target.value)}
              options={[{ value: '', label: L.allActions }, ...actions.map((a) => ({ value: a, label: actionLabel(a) }))]} />}
          </Field>
          <Field label={L.from}>{(id) => <Input id={id} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={L.to}>{(id) => <Input id={id} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label={t('common.search')}>{(id) => <Input id={id} type="search" placeholder={L.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <Field label={L.limit}>
            {(id) => <Select id={id} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
              options={[100, 300, 1000].map((n) => ({ value: n, label: fmt(L.last, { n }) }))} />}
          </Field>
          <div className="filters-right">
            <Button variant="ghost" onClick={() => void reload()}><Icon name="history" /> {t('common.refresh')}</Button>
          </div>
        </div>
      </div>
      {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !rows.length ? <Empty>{t('common.noData')}</Empty> : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th aria-label={L.expand} /><th>{t('common.date')}</th><th>{t('common.user')}</th><th>{L.entity}</th><th>{L.action}</th><th>{t('common.details')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open.has(r.id);
                  const n = r.changes ? Object.keys(r.changes).length : 0;
                  const href = entityHref(r.entityType, r.entityId);
                  return (
                    <Fragment key={r.id}>
                      <tr className={n ? 'clickable' : ''} onClick={n ? () => toggle(r.id) : undefined}>
                        <td>
                          {n > 0 && (
                            <button type="button" className="sec-expander" aria-expanded={isOpen} aria-label={isOpen ? L.collapse : L.expand}
                              onClick={(e) => { e.stopPropagation(); toggle(r.id); }}>
                              <Icon name="chevron" />
                            </button>
                          )}
                        </td>
                        <td className="sec-nowrap">{date(r.createdAt, locale, true)}</td>
                        <td>{r.userName ?? <span className="muted">{L.system}</span>}</td>
                        <td>
                          {entityLabel(r.entityType)}
                          {r.entityId !== null && (href
                            ? <> <Link to={href} onClick={(e) => e.stopPropagation()}>#{r.entityId}</Link></>
                            : <span className="muted"> #{r.entityId}</span>)}
                        </td>
                        <td><Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>{actionLabel(r.action)}</Badge></td>
                        <td className="muted small">{n ? summary(r.changes!, n, L.fields) : '—'}</td>
                      </tr>
                      {isOpen && (
                        <tr className="sec-detail"><td colSpan={6}><Changes changes={r.changes} /></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body">
            <p className="muted small">{fmt(L.shown, { n: rows.length })}{data && data.length >= limit ? ` · ${fmt(L.limitNote, { n: limit })}` : ''}</p>
          </div>
        </>
      )}
    </Card>
  );
}

function localDay(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isDiff(changes: Record<string, unknown>): boolean {
  const vals = Object.values(changes);
  return vals.length > 0 && vals.every((v) => Array.isArray(v) && v.length === 2);
}

function summary(changes: Record<string, unknown>, n: number, tpl: string): string {
  const keys = Object.keys(changes);
  const head = keys.slice(0, 3).join(', ');
  return keys.length > 3 ? `${head} … (${fmt(tpl, { n })})` : head;
}

function Changes({ changes }: { changes: Record<string, unknown> | null }) {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  if (!changes || !Object.keys(changes).length) return <p className="muted">{L.noChanges}</p>;
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : money(v, locale, 2);
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  };
  if (isDiff(changes)) {
    return (
      <table className="sec-diff">
        <thead><tr><th>{L.field}</th><th>{L.oldValue}</th><th aria-hidden="true" /><th>{L.newValue}</th></tr></thead>
        <tbody>
          {Object.entries(changes).map(([k, v]) => {
            const [a, b] = v as [unknown, unknown];
            return (
              <tr key={k}>
                <td className="sec-mono">{k}</td>
                <td className="sec-old"><span className="sec-sr">{L.oldValue}: </span>{show(a)}</td>
                <td className="sec-arrow" aria-hidden="true">→</td>
                <td className="sec-new"><span className="sec-sr">{L.newValue}: </span>{show(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <table className="sec-diff">
      <thead><tr><th>{L.field}</th><th>{L.value}</th></tr></thead>
      <tbody>
        {Object.entries(changes).map(([k, v]) => {
          const pair = Array.isArray(v) && v.length === 2 && !Array.isArray(v[0]);
          return (
            <tr key={k}>
              <td className="sec-mono">{k}</td>
              <td>{pair ? <><span className="sec-old">{show(v[0])}</span> → <span className="sec-new">{show(v[1])}</span></> : show(v)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ workflow actions */

interface WorkflowActionRow {
  id: number; instance_id: number; workflow_type: string; definition_name: string; entity_type: string; entity_id: number;
  action: string; user_name: string | null; from_status: string | null; to_status: string | null; comment: string | null; created_at: string;
}

function WorkflowTab() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const tr = useTr();
  const { data, error, loading } = useAsync(() => api<WorkflowActionRow[]>('GET', '/audit/workflow-actions'), []);
  const [type, setType] = useState('');
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');

  const users = useMemo(() => [...new Set((data ?? []).map((r) => r.user_name ?? ''))].sort(), [data]);
  const actions = useMemo(() => [...new Set((data ?? []).map((r) => r.action))].sort(), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(locale);
    return (data ?? []).filter((r) => (!type || r.workflow_type === type) && (!user || (r.user_name ?? '') === user) && (!action || r.action === action)
      && (!needle || `${r.definition_name} ${r.comment ?? ''} ${r.entity_id}`.toLocaleLowerCase(locale).includes(needle)));
  }, [data, type, user, action, q, locale]);

  const actionLabel = (a: string) => (a === 'OVERDUE' ? L.overdue : tr(`workflowAction.${a}`, a));
  const statusLabel = (s: string | null) => (s ? tr(`taskStatus.${s}`, tr(`instanceStatus.${s}`, s)) : null);

  return (
    <Card flush>
      <div className="card-body">
        <div className="filters">
          <Field label={L.workflow}>
            {(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}
              options={[{ value: '', label: L.allTypes }, ...WORKFLOW_TYPES.map((w) => ({ value: w, label: t(`workflowType.${w}`) }))]} />}
          </Field>
          <Field label={t('common.user')}>
            {(id) => <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}
              options={[{ value: '', label: L.allUsers }, ...users.map((u) => ({ value: u, label: u || L.system }))]} />}
          </Field>
          <Field label={L.action}>
            {(id) => <Select id={id} value={action} onChange={(e) => setAction(e.target.value)}
              options={[{ value: '', label: L.allActions }, ...actions.map((a) => ({ value: a, label: actionLabel(a) }))]} />}
          </Field>
          <Field label={t('common.search')}>{(id) => <Input id={id} type="search" placeholder={L.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        </div>
      </div>
      {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !rows.length ? <Empty>{t('common.noData')}</Empty> : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{t('common.date')}</th><th>{L.workflow}</th><th>{L.document}</th><th>{L.action}</th><th>{t('common.user')}</th><th>{L.statusChange}</th><th>{L.comment}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const href = entityHref(r.entity_type, r.entity_id);
                  const from = statusLabel(r.from_status);
                  const to = statusLabel(r.to_status);
                  return (
                    <tr key={r.id}>
                      <td className="sec-nowrap">{date(r.created_at, locale, true)}</td>
                      <td>{tr(`workflowType.${r.workflow_type}`, r.workflow_type)}<span className="sec-cell-sub">{r.definition_name}</span></td>
                      <td className="sec-nowrap">
                        {tr(`workflowEntity.${r.entity_type}`, r.entity_type)}{' '}
                        {href ? <Link to={href}>#{r.entity_id}</Link> : <span className="muted">#{r.entity_id}</span>}
                      </td>
                      <td>{actionLabel(r.action)}</td>
                      <td>{r.user_name ?? <span className="muted">{L.system}</span>}</td>
                      <td className="sec-nowrap small">{from || to ? <>{from ?? '—'} → {to ?? '—'}</> : '—'}</td>
                      <td className="small">{r.comment ?? <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body"><p className="muted small">{fmt(L.shown, { n: rows.length })} · {L.wfLimit}</p></div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ imports */

function ImportsTab() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { data, error, loading } = useAsync(() => api<ImportJobDto[]>('GET', '/audit/imports'), []);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error} />;
  const status: Record<ImportJobDto['status'], [string, string]> = {
    VALIDATED: [L.stValidated, 'info'], APPLIED: [L.stApplied, 'success'], FAILED: [L.stFailed, 'danger'],
  };
  return (
    <Card flush subtitle={L.importsLimit} title={L.tabImports}>
      {!data.length ? <Empty>{t('common.noData')}</Empty> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr>
              <th>{t('common.date')}</th><th>{L.kind}</th><th>{L.file}</th><th>{t('common.user')}</th><th>{t('common.status')}</th>
              <th className="r">{L.rowsRead}</th><th className="r">{L.rowsValid}</th><th className="r">{L.errors}</th><th className="r">{L.total}</th>
            </tr></thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id}>
                  <td className="sec-nowrap">{date(j.createdAt, locale, true)}</td>
                  <td>{j.kind === 'BUDGET' ? L.kindBudget : j.kind === 'ACTUALS' ? L.kindActuals : t(`bulkKind.${j.kind}` as TKey)}{(j.createdCount > 0 || j.updatedCount > 0) && <div className="hint">+{j.createdCount} · ✎{j.updatedCount}</div>}</td>
                  <td className="sec-mono">{j.fileName}</td>
                  <td>{j.userName ?? '—'}</td>
                  <td><Badge tone={status[j.status][1]}>{status[j.status][0]}</Badge></td>
                  <td className="r num">{j.rowsRead}</td>
                  <td className="r num">{j.rowsValid}</td>
                  <td className="r num">{j.errorCount ? <Badge tone="danger"><span aria-hidden="true">!</span> {j.errorCount}</Badge> : <span className="muted">0</span>}</td>
                  <td className="r num">{money(j.total, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
