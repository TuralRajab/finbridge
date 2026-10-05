import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REQUEST_STATUSES, type ChangeReportRowDto, type ConsumptionReportDto } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Card, Empty, ErrorMessage, ExportButton, Field, Icon, PageHeader, RequestStatusBadge, Select, Spinner, Tabs } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money, pct, signedMoney } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useYear } from '../../lib/useYear';
import '../../styles/reports.css';

const az = {
  title: 'Büdcə dəyişiklikləri hesabatı',
  subtitle: 'İlkin təsdiqlənmiş büdcə ilə cari büdcənin müqayisəsi və dəyişiklik sorğuları.',
  compare: 'İlkin və cari büdcə',
  compareHint: 'Tam il üzrə · {ccy}',
  byCc: 'Xərc mərkəzləri üzrə',
  byAccount: 'Hesablar üzrə',
  changedOnly: 'Yalnız dəyişənlər',
  original: 'İlkin büdcə',
  current: 'Cari büdcə',
  change: 'Dəyişiklik',
  changePct: 'Dəyişiklik %',
  noChanges: 'İlkin büdcədən fərqlənən mövqe yoxdur.',
  noBudget: 'Bu il üçün büdcə yoxdur.',
  allAccounts: 'Bütün hesablar',
  requests: 'Dəyişiklik sorğuları',
  number: 'Nömrə',
  costCenter: 'Xərc mərkəzi',
  subject: 'Mövzu',
  reason: 'Səbəb',
  before: 'Əvvəl',
  after: 'Sonra',
  requester: 'Sorğu edən',
  created: 'Yaradılıb',
  decided: 'Qərar',
  empty: 'Bu il üçün büdcə dəyişikliyi sorğusu yoxdur.',
  emptyFiltered: 'Seçilmiş statusda sorğu yoxdur.',
  approvedNet: 'Təsdiqlənmiş xalis dəyişiklik',
  approvedCount: 'Təsdiqlənmiş sorğular',
  pendingCount: 'Təsdiqdə olan sorğular',
  pendingNet: 'Təsdiqdə olan xalis dəyişiklik',
  totalChange: 'Cəmi dəyişiklik',
  count: '{n} sorğu',
};
const TEXT = {
  az,
  en: {
    title: 'Budget change report',
    subtitle: 'Original approved budget compared with the current budget, plus the change requests behind it.',
    compare: 'Original vs current budget',
    compareHint: 'Full year · {ccy}',
    byCc: 'By cost center',
    byAccount: 'By account',
    changedOnly: 'Changed only',
    original: 'Original budget',
    current: 'Current budget',
    change: 'Change',
    changePct: 'Change %',
    noChanges: 'Nothing differs from the original budget.',
    noBudget: 'There is no budget for this year.',
    allAccounts: 'All accounts',
    requests: 'Change requests',
    number: 'Number',
    costCenter: 'Cost center',
    subject: 'Subject',
    reason: 'Reason',
    before: 'Before',
    after: 'After',
    requester: 'Requester',
    created: 'Created',
    decided: 'Decided',
    empty: 'No budget change requests for this year.',
    emptyFiltered: 'No requests with the selected status.',
    approvedNet: 'Approved net change',
    approvedCount: 'Approved requests',
    pendingCount: 'Requests in approval',
    pendingNet: 'Net change in approval',
    totalChange: 'Total change',
    count: '{n} requests',
  } satisfies typeof az,
};

export function ChangeReportPage() {
  const { t, locale } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const ccy = user?.company?.baseCurrency ?? 'AZN';
  const { years } = useYear();
  const [sp, setSp] = useSearchParams();
  const year = Number(sp.get('year')) || new Date().getFullYear();
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'costCenter' | 'account'>('costCenter');
  const [parentAccount, setParentAccount] = useState<{ id: number; name: string }[]>([]);
  const [changedOnly, setChangedOnly] = useState(true);

  const changes = useAsync(() => api<ChangeReportRowDto[]>('GET', `/reports/changes${qs({ year })}`), [year]);
  const parentAccountId = parentAccount.length ? parentAccount[parentAccount.length - 1].id : undefined;
  const cmp = useAsync(
    () => api<ConsumptionReportDto>('GET', `/reports/consumption${qs({ year, groupBy: view, parentAccountId: view === 'account' ? parentAccountId : undefined })}`),
    [year, view, parentAccountId],
  );

  const rows = useMemo(() => (changes.data ?? []).filter((r) => !status || r.status === status), [changes.data, status]);
  const all = changes.data ?? [];
  const approved = all.filter((r) => r.status === 'APPROVED');
  const pending = all.filter((r) => r.status === 'IN_APPROVAL');
  const sum = (list: ChangeReportRowDto[]) => list.reduce((s, r) => s + r.change, 0);

  const cmpRows = (cmp.data?.rows ?? []).filter((r) => !changedOnly || Math.abs(r.annualBudget - r.originalBudget) >= 0.5);
  const cmpTotals = cmp.data?.totals;

  return (
    <>
      <PageHeader
        title={L.title}
        subtitle={L.subtitle}
        actions={<>
          <div className="inline-field"><Field label={t('common.year')}>{(id) => (
            <Select id={id} value={year} onChange={(e) => { setSp({ year: e.target.value }, { replace: true }); setParentAccount([]); }}
              options={[...new Set([...years, year])].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))} />
          )}</Field></div>
          {can('excel.export') && <ExportButton path={`/export/changes${qs({ year })}`} filename={`budget-changes-${year}.xlsx`} />}
        </>}
      />

      <div className="kpis rep-kpis">
        <div className="kpi"><div className="kpi-label">{L.approvedCount}</div><div className="kpi-value num">{approved.length}</div></div>
        <div className="kpi"><div className="kpi-label">{L.approvedNet}</div><div className="kpi-value num">{signedMoney(sum(approved), locale)}<span className="kpi-unit">{ccy}</span></div></div>
        <div className="kpi"><div className="kpi-label">{L.pendingCount}</div><div className="kpi-value num">{pending.length}</div></div>
        <div className="kpi"><div className="kpi-label">{L.pendingNet}</div><div className="kpi-value num">{signedMoney(sum(pending), locale)}<span className="kpi-unit">{ccy}</span></div></div>
      </div>

      <Card flush title={L.compare} subtitle={fmt(L.compareHint, { ccy })}>
        <div className="table-toolbar">
          <Tabs tabs={[{ value: 'costCenter', label: L.byCc }, { value: 'account', label: L.byAccount }]} value={view} onChange={(v) => { setView(v); setParentAccount([]); }} />
          <label className="check toolbar-right"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> {L.changedOnly}</label>
        </div>
        {view === 'account' && parentAccount.length > 0 && (
          <nav className="crumbs rep-crumbs rep-crumbs-inset" aria-label="breadcrumb">
            <button type="button" className="link-btn" onClick={() => setParentAccount([])}>{L.allAccounts}</button>
            {parentAccount.map((p, i) => (
              <span key={p.id} className="row gap-4">
                <Icon name="chevron" size={12} />
                {i === parentAccount.length - 1 ? <b aria-current="page">{p.name}</b>
                  : <button type="button" className="link-btn" onClick={() => setParentAccount(parentAccount.slice(0, i + 1))}>{p.name}</button>}
              </span>
            ))}
          </nav>
        )}
        {cmp.loading && !cmp.data ? <Spinner /> : cmp.error ? <div className="card-body"><ErrorMessage error={cmp.error} /></div> : !cmp.data?.budgetId ? <Empty>{L.noBudget}</Empty> : cmpRows.length === 0 ? <Empty>{L.noChanges}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{view === 'costCenter' ? L.costCenter : t('common.account')}</th>
                <th className="r">{L.original}</th><th className="r">{L.current}</th><th className="r">{L.change}</th><th className="r">{L.changePct}</th>
              </tr></thead>
              <tbody>
                {cmpRows.map((r) => {
                  const diff = Math.round((r.annualBudget - r.originalBudget) * 100) / 100;
                  const drill = view === 'account' && r.hasChildren;
                  return (
                    <tr key={r.key} className={drill ? 'clickable' : ''} onClick={drill ? () => setParentAccount([...parentAccount, { id: r.id, name: `${r.code} ${r.name}` }]) : undefined}>
                      <td className="rep-name">
                        {drill ? <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setParentAccount([...parentAccount, { id: r.id, name: `${r.code} ${r.name}` }]); }}><b>{r.code}</b> {r.name}</button>
                          : <span><b>{r.code}</b> {r.name}</span>}
                        {r.parentName && <span className="muted small">{r.parentName}</span>}
                      </td>
                      <td className="r num">{money(r.originalBudget, locale)}</td>
                      <td className="r num">{money(r.annualBudget, locale)}</td>
                      <td className="r num"><ChangeValue value={diff} /></td>
                      <td className="r num">{r.originalBudget ? pct((diff / r.originalBudget) * 100, locale) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {cmpTotals && (
                <tfoot><tr>
                  <td><b>{t('common.total')}</b></td>
                  <td className="r num"><b>{money(cmpTotals.originalBudget, locale)}</b></td>
                  <td className="r num"><b>{money(cmpTotals.annualBudget, locale)}</b></td>
                  <td className="r num"><ChangeValue value={Math.round((cmpTotals.annualBudget - cmpTotals.originalBudget) * 100) / 100} /></td>
                  <td className="r num">{cmpTotals.originalBudget ? pct(((cmpTotals.annualBudget - cmpTotals.originalBudget) / cmpTotals.originalBudget) * 100, locale) : '—'}</td>
                </tr></tfoot>
              )}
            </table>
          </div>
        )}
      </Card>

      <Card flush title={L.requests} subtitle={changes.data ? fmt(L.count, { n: rows.length }) : undefined}
        actions={<div className="inline-field"><Field label={t('common.status')}>{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}
            options={[{ value: '', label: t('common.all') }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: t(`requestStatus.${s}`) }))]} />
        )}</Field></div>}>
        {changes.loading && !changes.data ? <Spinner /> : changes.error ? <div className="card-body"><ErrorMessage error={changes.error} /></div> : rows.length === 0 ? <Empty>{all.length ? L.emptyFiltered : L.empty}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.number}</th><th>{L.costCenter}</th><th>{L.subject}</th><th>{t('common.status')}</th>
                <th className="r">{L.before}</th><th className="r">{L.change}</th><th className="r">{L.after}</th>
                <th>{L.requester}</th><th>{L.created}</th><th>{L.decided}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap"><Link to={`/changes/${r.id}`}><b>{r.number}</b></Link></td>
                    <td>{r.costCenter}</td>
                    <td className="rep-name"><span>{r.title}</span>{r.reason && <span className="muted small rep-reason">{r.reason}</span>}</td>
                    <td><RequestStatusBadge status={r.status} /></td>
                    <td className="r num">{money(r.original, locale)}</td>
                    <td className="r num"><ChangeValue value={r.change} /></td>
                    <td className="r num">{money(r.revised, locale)}</td>
                    <td className="nowrap">{r.requestedBy}</td>
                    <td className="nowrap">{date(r.createdAt, locale)}</td>
                    <td className="nowrap">{date(r.decidedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={4}><b>{L.totalChange}</b></td>
                <td className="r num"><b>{money(rows.reduce((s, r) => s + r.original, 0), locale)}</b></td>
                <td className="r num"><ChangeValue value={sum(rows)} /></td>
                <td className="r num"><b>{money(rows.reduce((s, r) => s + r.revised, 0), locale)}</b></td>
                <td colSpan={3} />
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** A budget change is neither good nor bad: show direction with an arrow, neutral colour. */
function ChangeValue({ value }: { value: number }) {
  const { locale } = useI18n();
  if (Math.round(value) === 0) return <span className="muted">0</span>;
  return <span className="chg"><span aria-hidden="true">{value > 0 ? '▲' : '▼'}</span> {signedMoney(value, locale)}</span>;
}
