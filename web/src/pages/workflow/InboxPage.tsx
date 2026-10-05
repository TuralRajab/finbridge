import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WORKFLOW_TYPES, type DelegationDto, type InboxItemDto, type WorkflowReportDto, type WorkflowType } from '@finbridge/shared';
import '../../styles/workflow.css';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { todayIso } from './wfCommon';

const az = {
  title: 'Təsdiqlərim',
  subtitle: 'Sizin qərarınızı gözləyən sənədlər. Sənədi açın, yoxlayın və təsdiqləyin, rədd edin və ya düzəlişə qaytarın.',
  tabMine: 'Mənim növbəm',
  tabAll: 'Bütün gözləyənlər',
  allHint: 'Şirkət üzrə təsdiqdə olan bütün mərhələlər (maliyyə nəzarəti üçün).',
  type: 'Sənəd növü',
  allTypes: 'Bütün növlər',
  search: 'Axtarış',
  searchPh: 'Sənəd, göndərən, mərhələ…',
  onlyOverdue: 'Yalnız gecikənlər',
  kpiTotal: 'Gözləyən',
  kpiOverdue: 'Gecikən',
  kpiDueSoon: '24 saat ərzində son tarix',
  kpiOldest: 'Ən uzun gözləyən',
  colItem: 'Sənəd',
  colAmount: 'Məbləğ',
  colStep: 'Mərhələ',
  colRequested: 'Göndərən',
  colWaiting: 'Gözləyir',
  colDue: 'Son tarix',
  overdueBy: '{d} gecikir',
  dueIn: '{d} qalıb',
  noDue: 'Müddətsiz',
  days: '{n} gün',
  hours: '{n} saat',
  lessHour: '1 saatdan az',
  emptyMine: 'Sizi gözləyən təsdiq yoxdur.',
  emptyAll: 'Şirkətdə təsdiq gözləyən sənəd yoxdur.',
  noMatch: 'Filtrə uyğun sənəd tapılmadı.',
  runEscalations: 'Eskalasiyaları indi işə sal',
  escalated: 'SLA-sı keçmiş {n} tapşırıq eskalasiya edildi.',
  escalatedNone: 'Eskalasiya ediləcək yeni gecikmiş tapşırıq yoxdur.',
  escHint: 'SLA müddəti keçmiş tapşırıqlara mərhələdə göstərilən eskalasiya təsdiqləyənini əlavə edir (hər tapşırıq üçün bir dəfə).',
  delegateBanner: 'Siz {from} adından {scope} təsdiqləyə bilərsiniz — {to} tarixinədək. Bu sənədlər də siyahınızdadır.',
  scopeAll: 'bütün sənədləri',
  delegations: 'Səlahiyyət ötürmə',
  open: 'Aç',
};
const TEXT = {
  az,
  en: {
    title: 'My approvals',
    subtitle: 'Documents waiting for your decision. Open a document to review, approve, reject or return it.',
    tabMine: 'My turn',
    tabAll: 'All pending',
    allHint: 'Every pending approval step in the company (for finance oversight).',
    type: 'Document type',
    allTypes: 'All types',
    search: 'Search',
    searchPh: 'Document, requester, step…',
    onlyOverdue: 'Overdue only',
    kpiTotal: 'Pending',
    kpiOverdue: 'Overdue',
    kpiDueSoon: 'Due within 24 h',
    kpiOldest: 'Longest waiting',
    colItem: 'Document',
    colAmount: 'Amount',
    colStep: 'Step',
    colRequested: 'Requested by',
    colWaiting: 'Waiting',
    colDue: 'Due',
    overdueBy: '{d} overdue',
    dueIn: '{d} left',
    noDue: 'No deadline',
    days: '{n} d',
    hours: '{n} h',
    lessHour: '< 1 h',
    emptyMine: 'Nothing is waiting for you.',
    emptyAll: 'No documents are pending approval in the company.',
    noMatch: 'No documents match the filter.',
    runEscalations: 'Run escalations now',
    escalated: '{n} overdue tasks were escalated.',
    escalatedNone: 'No new overdue tasks to escalate.',
    escHint: 'Adds the step\'s escalation approver to tasks past their SLA (once per task).',
    delegateBanner: 'You can approve {scope} on behalf of {from} until {to}. Those documents are included in your list.',
    scopeAll: 'all documents',
    delegations: 'Delegations',
    open: 'Open',
  } satisfies typeof az,
};
type Txt = typeof az;

type TabKey = 'mine' | 'all';

function duration(ms: number, L: Txt): string {
  const h = Math.floor(Math.abs(ms) / 3600_000);
  if (h < 1) return L.lessHour;
  if (h < 48) return fmt(L.hours, { n: h });
  return fmt(L.days, { n: Math.floor(h / 24) });
}

function sortItems(items: InboxItemDto[]): InboxItemDto[] {
  return [...items].sort((a, b) =>
    Number(b.isOverdue) - Number(a.isOverdue)
    || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')
    || (a.activatedAt ?? '').localeCompare(b.activatedAt ?? ''));
}

export function InboxPage() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { can, user, refresh } = useAuth();
  const canAll = can('reports.view') && (can('workflow.manage') || can('audit.view'));
  const [tab, setTab] = useState<TabKey>('mine');
  const mine = useAsync(() => api<InboxItemDto[]>('GET', '/workflows/inbox'), []);
  const all = useAsync(() => (tab === 'all' && canAll ? api<WorkflowReportDto>('GET', '/reports/workflows').then((r) => r.pending) : Promise.resolve(null)), [tab, canAll]);
  const dels = useAsync(() => api<DelegationDto[]>('GET', '/workflows/delegations'), []);
  const [escBusy, setEscBusy] = useState(false);
  const [escResult, setEscResult] = useState<string | null>(null);
  const [escError, setEscError] = useState<unknown>(null);

  const runEscalations = async () => {
    setEscBusy(true); setEscError(null); setEscResult(null);
    try {
      const r = await api<{ escalated: number }>('POST', '/workflows/escalations/run');
      setEscResult(r.escalated ? fmt(L.escalated, { n: r.escalated }) : L.escalatedNone);
      await Promise.all([mine.reload(), tab === 'all' ? all.reload() : Promise.resolve(), refresh().catch(() => undefined)]);
    } catch (e) { setEscError(e); } finally { setEscBusy(false); }
  };

  const day = todayIso();
  const toMe = (dels.data ?? []).filter((d) => d.isActive && d.toUserId === user?.id && d.validFrom <= day && d.validTo >= day);
  const src = tab === 'mine' ? mine : all;

  return (
    <div className="wfi">
      <PageHeader eyebrow={t('nav.overview')} title={L.title} subtitle={L.subtitle} actions={<>
        <Button onClick={() => void src.reload()} aria-label={t('common.refresh')}><Icon name="history" /> {t('common.refresh')}</Button>
        {can('workflow.manage') && <Button busy={escBusy} onClick={() => void runEscalations()} title={L.escHint}><Icon name="alert" /> {L.runEscalations}</Button>}
      </>} />

      {escResult && <div className="alert alert-success" role="status">{escResult}</div>}
      <ErrorMessage error={escError} />
      {toMe.map((d) => (
        <div key={d.id} className="alert alert-info wfi-deleg">
          <Icon name="delegate" />{' '}
          {fmt(L.delegateBanner, {
            from: d.fromName, to: date(d.validTo, locale), scope: d.workflowType ? `«${t(`workflowType.${d.workflowType}` as TKey)}»` : L.scopeAll,
          })}{' '}
          <Link to="/delegations">{L.delegations}</Link>
        </div>
      ))}

      {canAll && (
        <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
          { value: 'mine', label: <>{L.tabMine} {mine.data && <Badge tone={mine.data.length ? 'warning' : 'muted'}>{mine.data.length}</Badge>}</> },
          { value: 'all', label: L.tabAll },
        ]} />
      )}
      {tab === 'all' && <p className="muted small wfi-hint">{L.allHint}</p>}

      {src.loading && !src.data ? <Spinner /> : src.error ? <ErrorMessage error={src.error} /> : src.data && (
        <InboxList key={tab} items={src.data} empty={tab === 'mine' ? L.emptyMine : L.emptyAll} L={L} />
      )}
    </div>
  );
}

function InboxList({ items, empty, L }: { items: InboxItemDto[]; empty: string; L: Txt }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [type, setType] = useState<WorkflowType | ''>('');
  const [q, setQ] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const now = Date.now();

  const counts = useMemo(() => {
    const m = new Map<WorkflowType, number>();
    for (const i of items) m.set(i.workflowType, (m.get(i.workflowType) ?? 0) + 1);
    return m;
  }, [items]);
  const filtered = sortItems(items.filter((i) => (!type || i.workflowType === type) && (!onlyOverdue || i.isOverdue)
    && (!q.trim() || `${i.title} ${i.subtitle} ${i.requestedBy} ${i.stepName}`.toLowerCase().includes(q.trim().toLowerCase()))));
  const groups = WORKFLOW_TYPES.map((wt) => ({ wt, rows: filtered.filter((i) => i.workflowType === wt) })).filter((g) => g.rows.length)
    .sort((a, b) => Number(b.rows[0].isOverdue) - Number(a.rows[0].isOverdue));

  const overdue = items.filter((i) => i.isOverdue).length;
  const dueSoon = items.filter((i) => !i.isOverdue && i.dueAt && new Date(i.dueAt).getTime() - now < 24 * 3600_000).length;
  const oldest = items.reduce<string | null>((m, i) => (i.activatedAt && (!m || i.activatedAt < m) ? i.activatedAt : m), null);

  if (!items.length) return <Card><Empty><Icon name="check" size={28} /><div>{empty}</div></Empty></Card>;

  return (
    <>
      <div className="kpis wfi-kpis">
        <div className="kpi"><div className="kpi-label">{L.kpiTotal}</div><div className="kpi-value num">{items.length}</div></div>
        <div className={`kpi${overdue ? ' kpi-over' : ''}`}><div className="kpi-label">{L.kpiOverdue}</div><div className="kpi-value num">{overdue}</div>
          {overdue > 0 && <div className="kpi-foot"><Icon name="alert" /> {t('common.overdue')}</div>}</div>
        <div className="kpi"><div className="kpi-label">{L.kpiDueSoon}</div><div className="kpi-value num">{dueSoon}</div></div>
        <div className="kpi"><div className="kpi-label">{L.kpiOldest}</div><div className="kpi-value num">{oldest ? duration(now - new Date(oldest).getTime(), L) : '—'}</div>
          {oldest && <div className="kpi-foot">{date(oldest, locale, true)}</div>}</div>
      </div>

      <div className="filters wfi-filters">
        <Field label={L.type}>{(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as WorkflowType | '')}
            options={[{ value: '', label: `${L.allTypes} (${items.length})` },
              ...WORKFLOW_TYPES.filter((w) => counts.has(w)).map((w) => ({ value: w, label: `${t(`workflowType.${w}` as TKey)} (${counts.get(w)})` }))]} />
        )}</Field>
        <Field label={L.search}>{(id) => <Input id={id} type="search" placeholder={L.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <label className="check wfl-check"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> {L.onlyOverdue}</label>
      </div>

      {!groups.length ? <Card><Empty>{L.noMatch}</Empty></Card> : groups.map(({ wt, rows }) => (
        <Card key={wt} flush title={t(`workflowType.${wt}` as TKey)} subtitle={`${rows.length}${rows.some((r) => r.isOverdue) ? ` · ${rows.filter((r) => r.isOverdue).length} ${t('common.overdue').toLowerCase()}` : ''}`}>
          <div className="table-scroll">
            <table className="table wfi-table">
              <thead><tr>
                <th>{L.colItem}</th><th className="r">{L.colAmount}</th><th>{L.colStep}</th><th>{L.colRequested}</th><th>{L.colWaiting}</th><th>{L.colDue}</th><th className="r"><span className="sr-only">{L.open}</span></th>
              </tr></thead>
              <tbody>
                {rows.map((i) => {
                  const dueMs = i.dueAt ? new Date(i.dueAt).getTime() - now : null;
                  return (
                    <tr key={i.taskId} className={`clickable${i.isOverdue ? ' wfi-overdue' : ''}`} onClick={() => navigate(i.link)}>
                      <td className="wfi-item">
                        <Link to={i.link} onClick={(e) => e.stopPropagation()}><strong>{i.title}</strong></Link>
                        <div className="muted small">{i.subtitle}</div>
                      </td>
                      <td className="r num wfi-amt">{i.amount === null ? '—' : <>{money(i.amount, locale, 2)} <span className="muted small">{i.currency ?? ''}</span></>}</td>
                      <td>{i.stepName}</td>
                      <td>{i.requestedBy}</td>
                      <td className="small">
                        <div>{i.activatedAt ? duration(now - new Date(i.activatedAt).getTime(), L) : '—'}</div>
                        <div className="muted">{date(i.activatedAt, locale, true)}</div>
                      </td>
                      <td className="small">
                        {i.dueAt ? <>
                          <div>{date(i.dueAt, locale, true)}</div>
                          {i.isOverdue
                            ? <Badge tone="danger"><Icon name="alert" /> {fmt(L.overdueBy, { d: duration(dueMs ?? 0, L) })}</Badge>
                            : <span className="muted">{fmt(L.dueIn, { d: duration(dueMs ?? 0, L) })}</span>}
                        </> : <span className="muted">{L.noDue}</span>}
                      </td>
                      <td className="r"><Link className="btn btn-secondary btn-sm" to={i.link} onClick={(e) => e.stopPropagation()}>{L.open} <Icon name="chevron" /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
