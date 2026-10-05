import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InboxItemDto, WorkflowReportDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { Badge, Card, Empty, ErrorMessage, Field, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import '../../styles/reports.css';

const az = {
  title: 'Təsdiq axınları hesabatı',
  subtitle: 'Təsdiq proseslərinin həcmi, gözləyən və müddəti keçmiş mərhələlər, orta icra müddəti.',
  pending: 'Gözləyən mərhələlər',
  overdue: 'Müddəti keçmiş',
  inReview: 'Baxılan sənədlər',
  avgCycle: 'Orta icra müddəti',
  avgCycleHint: 'göndərilmədən yekun təsdiqə qədər',
  byType: 'Axın növləri üzrə',
  type: 'Axın növü',
  inReviewCol: 'Baxılır',
  approved: 'Təsdiqlənib',
  rejected: 'Rədd edilib',
  returned: 'Qaytarılıb',
  cancelled: 'Ləğv edilib',
  total: 'Cəmi',
  approvalRate: 'Təsdiq payı',
  byStep: 'Mərhələlər üzrə gözləyənlər',
  step: 'Mərhələ',
  count: 'Say',
  overdueCount: 'Gecikən',
  oldest: 'Ən köhnə',
  listPending: 'Gözləyənlər',
  listOverdue: 'Müddəti keçənlər',
  document: 'Sənəd',
  requester: 'Göndərən',
  since: 'Gözləyir (başlanğıc)',
  due: 'Son tarix',
  age: 'Gözləmə',
  amount: 'Məbləğ',
  hours: '{n} saat',
  days: '{n} gün',
  none: 'Gözləyən təsdiq mərhələsi yoxdur.',
  noneOverdue: 'Müddəti keçmiş mərhələ yoxdur.',
  noData: 'Hələ heç bir təsdiq axını başlamayıb.',
  allTypes: 'Bütün növlər',
  overdueBadge: 'Gecikib',
};
const TEXT = {
  az,
  en: {
    title: 'Workflow report',
    subtitle: 'Approval volumes, pending and overdue steps, and average cycle time.',
    pending: 'Pending steps',
    overdue: 'Overdue',
    inReview: 'Documents in review',
    avgCycle: 'Average cycle time',
    avgCycleHint: 'from submission to final approval',
    byType: 'By workflow type',
    type: 'Workflow type',
    inReviewCol: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
    returned: 'Returned',
    cancelled: 'Cancelled',
    total: 'Total',
    approvalRate: 'Approval rate',
    byStep: 'Pending by step',
    step: 'Step',
    count: 'Count',
    overdueCount: 'Overdue',
    oldest: 'Oldest',
    listPending: 'Pending',
    listOverdue: 'Overdue',
    document: 'Document',
    requester: 'Submitted by',
    since: 'Waiting since',
    due: 'Due',
    age: 'Waiting',
    amount: 'Amount',
    hours: '{n} h',
    days: '{n} d',
    none: 'No approval steps are pending.',
    noneOverdue: 'No overdue steps.',
    noData: 'No approval workflow has started yet.',
    allTypes: 'All types',
    overdueBadge: 'Overdue',
  } satisfies typeof az,
};

export function WorkflowReportPage() {
  const { t, locale } = useI18n();
  const L = useLocal(TEXT);
  const { data, error, loading } = useAsync(() => api<WorkflowReportDto>('GET', '/reports/workflows'), []);
  const [list, setList] = useState<'pending' | 'overdue'>('pending');
  const [type, setType] = useState('');

  const dur = (h: number | null) => (h === null ? '—' : h >= 48 ? fmt(L.days, { n: (h / 24).toFixed(1) }) : fmt(L.hours, { n: h.toFixed(1) }));
  const ageHours = (i: InboxItemDto) => (i.activatedAt ? (Date.now() - new Date(i.activatedAt.includes('T') ? i.activatedAt : `${i.activatedAt.replace(' ', 'T')}Z`).getTime()) / 36e5 : null);

  const byStep = useMemo(() => {
    const m = new Map<string, { type: InboxItemDto['workflowType']; step: string; n: number; overdue: number; oldest: string | null }>();
    for (const p of data?.pending ?? []) {
      const k = `${p.workflowType}|${p.stepName}`;
      const e = m.get(k) ?? { type: p.workflowType, step: p.stepName, n: 0, overdue: 0, oldest: null };
      e.n += 1;
      if (p.isOverdue) e.overdue += 1;
      if (p.activatedAt && (!e.oldest || p.activatedAt < e.oldest)) e.oldest = p.activatedAt;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [data]);

  if (loading && !data) return <><PageHeader title={L.title} subtitle={L.subtitle} /><Spinner /></>;
  if (error || !data) return <><PageHeader title={L.title} subtitle={L.subtitle} /><ErrorMessage error={error} /></>;

  const totals = data.byType.reduce((s, r) => ({
    inReview: s.inReview + r.inReview, approved: s.approved + r.approved, rejected: s.rejected + r.rejected, returned: s.returned + r.returned, cancelled: s.cancelled + r.cancelled,
  }), { inReview: 0, approved: 0, rejected: 0, returned: 0, cancelled: 0 });
  const timed = data.byType.filter((r) => r.avgHours !== null);
  const weighted = timed.reduce((s, r) => s + r.approved, 0);
  const avgAll = timed.length ? (weighted ? timed.reduce((s, r) => s + r.avgHours! * r.approved, 0) / weighted : timed.reduce((s, r) => s + r.avgHours!, 0) / timed.length) : null;
  const rate = (a: number, r: number) => (a + r ? `${Math.round((a / (a + r)) * 100)}%` : '—');
  const items = (list === 'pending' ? data.pending : data.overdue).filter((i) => !type || i.workflowType === type);
  const types = [...new Set([...data.pending.map((p) => p.workflowType), ...data.byType.map((b) => b.workflowType)])];

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <div className="kpis rep-kpis">
        <div className="kpi"><div className="kpi-label">{L.pending}</div><div className="kpi-value num">{data.pending.length}</div></div>
        <div className={`kpi${data.overdue.length ? ' kpi-over' : ''}`}>
          <div className="kpi-label">{L.overdue}</div><div className="kpi-value num">{data.overdue.length}</div>
          {data.overdue.length > 0 && <div className="kpi-foot">▲ {L.overdueBadge}</div>}
        </div>
        <div className="kpi"><div className="kpi-label">{L.inReview}</div><div className="kpi-value num">{totals.inReview}</div></div>
        <div className="kpi"><div className="kpi-label">{L.avgCycle}</div><div className="kpi-value num">{dur(avgAll === null ? null : Math.round(avgAll * 10) / 10)}</div><div className="kpi-foot">{L.avgCycleHint}</div></div>
      </div>

      <div className="grid-dash rep-grid">
        <Card title={L.byType} flush>
          {data.byType.length === 0 ? <Empty>{L.noData}</Empty> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr>
                  <th>{L.type}</th><th className="r">{L.inReviewCol}</th><th className="r">{L.approved}</th><th className="r">{L.rejected}</th>
                  <th className="r">{L.returned}</th><th className="r">{L.cancelled}</th><th className="r">{L.total}</th><th className="r">{L.approvalRate}</th><th className="r">{L.avgCycle}</th>
                </tr></thead>
                <tbody>
                  {data.byType.map((r) => (
                    <tr key={r.workflowType}>
                      <td><b>{t(`workflowType.${r.workflowType}` as TKey)}</b></td>
                      <td className="r num">{r.inReview}</td><td className="r num">{r.approved}</td><td className="r num">{r.rejected}</td>
                      <td className="r num">{r.returned}</td><td className="r num">{r.cancelled}</td>
                      <td className="r num"><b>{r.inReview + r.approved + r.rejected + r.returned + r.cancelled}</b></td>
                      <td className="r num">{rate(r.approved, r.rejected)}</td>
                      <td className="r num">{dur(r.avgHours)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td><b>{t('common.total')}</b></td>
                  <td className="r num"><b>{totals.inReview}</b></td><td className="r num"><b>{totals.approved}</b></td><td className="r num"><b>{totals.rejected}</b></td>
                  <td className="r num"><b>{totals.returned}</b></td><td className="r num"><b>{totals.cancelled}</b></td>
                  <td className="r num"><b>{totals.inReview + totals.approved + totals.rejected + totals.returned + totals.cancelled}</b></td>
                  <td className="r num"><b>{rate(totals.approved, totals.rejected)}</b></td>
                  <td className="r num"><b>{dur(avgAll === null ? null : Math.round(avgAll * 10) / 10)}</b></td>
                </tr></tfoot>
              </table>
            </div>
          )}
        </Card>
        <Card title={L.byStep} flush>
          {byStep.length === 0 ? <Empty>{L.none}</Empty> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>{L.step}</th><th className="r">{L.count}</th><th className="r">{L.overdueCount}</th><th>{L.oldest}</th></tr></thead>
                <tbody>
                  {byStep.map((s) => (
                    <tr key={`${s.type}|${s.step}`}>
                      <td><b>{s.step}</b><div className="muted small">{t(`workflowType.${s.type}` as TKey)}</div></td>
                      <td className="r num">{s.n}</td>
                      <td className="r num">{s.overdue ? <Badge tone="danger">! {s.overdue}</Badge> : 0}</td>
                      <td className="nowrap">{date(s.oldest, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card flush>
        <div className="table-toolbar">
          <Tabs tabs={[{ value: 'pending', label: `${L.listPending} (${data.pending.length})` }, { value: 'overdue', label: `${L.listOverdue} (${data.overdue.length})` }]} value={list} onChange={setList} />
          <div className="toolbar-right inline-field">
            <Field label={L.type}>{(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)}
                options={[{ value: '', label: L.allTypes }, ...types.map((x) => ({ value: x, label: t(`workflowType.${x}` as TKey) }))]} />
            )}</Field>
          </div>
        </div>
        {items.length === 0 ? <Empty>{list === 'pending' ? L.none : L.noneOverdue}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.document}</th><th>{L.type}</th><th>{L.step}</th><th>{L.requester}</th><th className="r">{L.amount}</th>
                <th>{L.since}</th><th>{L.age}</th><th>{L.due}</th>
              </tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.taskId}>
                    <td><Link to={i.link}><b>{i.title}</b></Link><div className="muted small">{i.subtitle}</div></td>
                    <td className="small">{t(`workflowType.${i.workflowType}` as TKey)}</td>
                    <td>{i.stepName}</td>
                    <td className="nowrap">{i.requestedBy}</td>
                    <td className="r num nowrap">{i.amount === null ? '—' : <>{money(i.amount, locale, 2)} <span className="muted small">{i.currency}</span></>}</td>
                    <td className="nowrap">{date(i.activatedAt, locale, true)}</td>
                    <td className="nowrap">{dur(ageHours(i) === null ? null : Math.max(0, Math.round(ageHours(i)! * 10) / 10))}</td>
                    <td className="nowrap">{date(i.dueAt, locale, true)} {i.isOverdue && <Badge tone="danger">! {L.overdueBadge}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
