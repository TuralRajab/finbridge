import { Fragment, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MONTH_NAMES, MONTH_SHORT, REQUEST_STATUSES,
  type ConsumptionReportDto, type Measures, type ReportGroupBy, type ReportRow, type RequestStatus, type TransactionDto,
} from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge, Card, ConsumptionBar, Empty, ErrorMessage, ExportButton, Field, Icon, PageHeader, RequestStatusBadge, Select, Spinner, Tabs,
  Variance, VariancePct, VersionStatusBadge,
} from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money } from '../../lib/format';
import { useDisplayName, useMasterData } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import { useYear } from '../../lib/useYear';
import '../../styles/reports.css';

const az = {
  title: 'Büdcə istifadəsi',
  subtitle: 'Şirkət → struktur vahidi → xərc mərkəzi → hesab → əməliyyatlar üzrə büdcə, öhdəlik və fakt.',
  byUnit: 'Struktur üzrə',
  bySection: 'Büdcə bölmələri üzrə',
  byCc: 'Xərc mərkəzləri üzrə',
  byAccount: 'Hesablar üzrə',
  basis: 'Dövr',
  fullYear: 'Tam il',
  ytd: 'İlin əvvəlindən',
  through: 'Ayın sonuna qədər',
  ccFilter: 'Xərc mərkəzi',
  allCc: 'Bütün xərc mərkəzləri',
  name: 'Ad',
  variancePct: 'Fərq %',
  versionInfo: 'Versiya {n}',
  noBudget: 'Bu il üçün büdcə yoxdur.',
  empty: 'Bu səviyyədə məlumat yoxdur.',
  transactions: 'Əməliyyatlar',
  allTransactions: 'Xərc mərkəzinin bütün əməliyyatları',
  txEmpty: 'Bu xərc mərkəzi və hesab üzrə sorğu və ya faktiki xərc yoxdur.',
  kind: 'Növ',
  kindREQUEST: 'Sorğu',
  kindACTUAL: 'Fakt',
  reference: 'Sənəd',
  sourceMANUAL: 'Əl ilə',
  sourceIMPORT: 'Excel idxalı',
  sourceREQUEST: 'Sorğu üzrə qaimə',
  actualTotal: 'Faktlar cəmi',
  requestTotal: 'Sorğular cəmi (rədd və ləğv edilənlər xaric)',
  drill: 'Ətraflı',
  legendActual: 'Fakt',
  legendCommitted: 'Öhdəlik',
  legendPending: 'Təsdiqdə',
  periodNote: 'Büdcə, fakt və öhdəlik {period} üzrə; proqnoz tam il üçündür.',
};
const TEXT = {
  az,
  en: {
    title: 'Budget consumption',
    subtitle: 'Budget, commitments and actuals from company → unit → cost center → account → transactions.',
    byUnit: 'By structure',
    bySection: 'By budget section',
    byCc: 'By cost center',
    byAccount: 'By account',
    basis: 'Period',
    fullYear: 'Full year',
    ytd: 'Year to date',
    through: 'Through end of',
    ccFilter: 'Cost center',
    allCc: 'All cost centers',
    name: 'Name',
    variancePct: 'Variance %',
    versionInfo: 'Version {n}',
    noBudget: 'There is no budget for this year.',
    empty: 'No data at this level.',
    transactions: 'Transactions',
    allTransactions: 'All transactions of the cost center',
    txEmpty: 'No requests or actuals for this cost center and account.',
    kind: 'Kind',
    kindREQUEST: 'Request',
    kindACTUAL: 'Actual',
    reference: 'Reference',
    sourceMANUAL: 'Manual',
    sourceIMPORT: 'Excel import',
    sourceREQUEST: 'Invoice on request',
    actualTotal: 'Total actuals',
    requestTotal: 'Total requests (excl. rejected and cancelled)',
    drill: 'Details',
    legendActual: 'Actual',
    legendCommitted: 'Committed',
    legendPending: 'Pending',
    periodNote: 'Budget, actuals and commitments for {period}; the forecast is full-year.',
  } satisfies typeof az,
};

type Params = { groupBy?: ReportGroupBy; parentUnitId?: number; parentAccountId?: number; costCenterId?: number; accountId?: number; tx?: number };
const num = (v: string | null) => (v && Number(v) > 0 ? Number(v) : undefined);

export function ConsumptionReportPage() {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const ccy = user?.company?.baseCurrency ?? 'AZN';
  const navigate = useNavigate();
  const display = useDisplayName();
  const { years } = useYear();
  const [sp, setSp] = useSearchParams();
  const year = num(sp.get('year')) ?? new Date().getFullYear();
  const groupBy = (['unit', 'section', 'costCenter', 'account'].includes(sp.get('groupBy') ?? '') ? sp.get('groupBy') : 'unit') as ReportGroupBy;
  const parentUnitId = num(sp.get('parentUnitId'));
  const parentAccountId = num(sp.get('parentAccountId'));
  const costCenterId = num(sp.get('costCenterId'));
  const accountId = num(sp.get('accountId'));
  const through = num(sp.get('through'));
  const tx = sp.get('tx') === '1' && !!costCenterId;

  const md = useMasterData();
  const query = { year, groupBy, parentUnitId, parentAccountId, costCenterId, through };
  const report = useAsync(
    () => (tx ? Promise.resolve(null) : api<ConsumptionReportDto>('GET', `/reports/consumption${qs(query)}`)),
    [tx, year, groupBy, parentUnitId, parentAccountId, costCenterId, through],
  );
  const txs = useAsync(
    () => (tx ? api<TransactionDto[]>('GET', `/reports/transactions${qs({ year, costCenterId, accountId })}`) : Promise.resolve(null)),
    [tx, year, costCenterId, accountId],
  );

  /** Builds a URL for the report, keeping year and period. */
  const href = (p: Params) => `/reports/consumption${qs({ year, through, groupBy: p.groupBy, parentUnitId: p.parentUnitId, parentAccountId: p.parentAccountId, costCenterId: p.costCenterId, accountId: p.accountId, tx: p.tx })}`;
  const setTop = (k: 'year' | 'through', v: number | undefined) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, String(v)); else next.delete(k);
    setSp(next, { replace: true });
  };

  /* breadcrumbs from master data */
  const crumbs = useMemo(() => {
    const out: { label: string; to?: string }[] = [];
    const units = md.data?.units ?? [];
    const accounts = md.data?.accounts ?? [];
    const root = units.find((u) => u.parentId === null);
    out.push({ label: user?.company?.name ?? root?.name ?? '—', to: href({ groupBy: groupBy === 'section' || groupBy === 'costCenter' ? groupBy : groupBy === 'account' && !costCenterId ? 'account' : undefined }) });
    const unitChain = (id: number) => {
      const chain = [];
      let u = units.find((x) => x.id === id);
      while (u) { chain.unshift(u); const pid = u.parentId; u = pid ? units.find((x) => x.id === pid) : undefined; }
      return chain.filter((x) => x.parentId !== null);
    };
    const accChain = (id: number) => {
      const chain = [];
      let a = accounts.find((x) => x.id === id);
      while (a) { chain.unshift(a); const pid = a.parentId; a = pid ? accounts.find((x) => x.id === pid) : undefined; }
      return chain;
    };
    const cc = costCenterId ? md.data?.costCenters.find((c) => c.id === costCenterId) : undefined;
    if (cc) {
      for (const u of unitChain(cc.orgUnitId)) out.push({ label: display(u), to: href({ groupBy: 'unit', parentUnitId: u.id }) });
      out.push({ label: `${cc.code} · ${cc.name}`, to: href({ groupBy: 'account', costCenterId: cc.id }) });
    } else if (parentUnitId) {
      for (const u of unitChain(parentUnitId)) out.push({ label: display(u), to: href({ groupBy: groupBy === 'costCenter' ? 'costCenter' : 'unit', parentUnitId: u.id }) });
    }
    const accLeaf = tx ? accountId : parentAccountId;
    if (accLeaf) {
      for (const a of accChain(accLeaf)) {
        const leaf = tx && a.id === accountId;
        out.push({ label: `${a.code} · ${display(a)}`, to: leaf ? undefined : href({ groupBy: 'account', costCenterId, parentAccountId: a.id }) });
      }
    }
    if (tx) out.push({ label: L.transactions });
    out[out.length - 1] = { label: out[out.length - 1].label };
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md.data, user, groupBy, parentUnitId, parentAccountId, costCenterId, accountId, tx, year, through, lang]);

  const drill = (r: ReportRow): string | null => {
    if (r.kind === 'unit') return href({ groupBy: 'unit', parentUnitId: r.id });
    if (r.kind === 'section') return href({ groupBy: 'costCenter', parentUnitId: r.id });
    if (r.kind === 'costCenter') return href({ groupBy: 'account', costCenterId: r.id });
    if (r.hasChildren) return href({ groupBy: 'account', costCenterId, parentAccountId: r.id });
    if (costCenterId) return href({ tx: 1, costCenterId, accountId: r.id });
    return null;
  };

  const ccOptions = (md.data?.costCenters ?? []).filter((c) => c.isActive || c.id === costCenterId).sort((a, b) => a.code.localeCompare(b.code));
  const data = report.data;
  const showAnnual = !!through && through < 12;
  const periodText = through && through < 12 ? `${MONTH_SHORT[lang][0]}–${MONTH_SHORT[lang][through - 1]} ${year}` : `${L.fullYear} ${year}`;

  return (
    <>
      <PageHeader
        title={L.title}
        subtitle={<>{L.subtitle} {data?.versionNo ? <span className="nowrap">· {fmt(L.versionInfo, { n: data.versionNo })} {data.versionStatus && <VersionStatusBadge status={data.versionStatus} />}</span> : null}</>}
        actions={!tx && can('excel.export') ? <ExportButton path={`/export/consumption${qs(query)}`} filename={`consumption-${year}.xlsx`} /> : undefined}
      />
      <Card>
        <div className="filters">
          <Field label={t('common.year')}>{(id) => (
            <Select id={id} value={year} onChange={(e) => setTop('year', Number(e.target.value))}
              options={[...new Set([...years, year])].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))} />
          )}</Field>
          <Field label={L.basis}>{(id) => (
            <Select id={id} value={through ? 'ytd' : 'full'} onChange={(e) => setTop('through', e.target.value === 'ytd' ? (year === new Date().getFullYear() ? Math.max(1, new Date().getMonth()) : 12) : undefined)}
              options={[{ value: 'full', label: L.fullYear }, { value: 'ytd', label: L.ytd }]} />
          )}</Field>
          {through && (
            <Field label={L.through}>{(id) => (
              <Select id={id} value={through} onChange={(e) => setTop('through', Number(e.target.value))} options={MONTH_NAMES[lang].map((m, i) => ({ value: i + 1, label: m }))} />
            )}</Field>
          )}
          <Field label={L.ccFilter}>{(id) => (
            <Select id={id} value={costCenterId ?? ''} onChange={(e) => navigate(e.target.value ? href({ groupBy: 'account', costCenterId: Number(e.target.value) }) : href({}))}
              options={[{ value: '', label: L.allCc }, ...ccOptions.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} />
          )}</Field>
        </div>
      </Card>

      <div className="rep-nav">
        <Tabs
          tabs={[{ value: 'unit', label: L.byUnit }, { value: 'section', label: L.bySection }, { value: 'costCenter', label: L.byCc }, { value: 'account', label: L.byAccount }]}
          value={tx ? 'account' : groupBy}
          onChange={(v) => navigate(href({ groupBy: v as ReportGroupBy, costCenterId: v === 'account' ? costCenterId : undefined }))}
        />
      </div>
      <nav className="crumbs rep-crumbs" aria-label="breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="muted" aria-hidden="true"><Icon name="chevron" size={12} /></span>}
            {c.to ? <Link to={c.to}>{c.label}</Link> : <b aria-current="page">{c.label}</b>}
          </Fragment>
        ))}
      </nav>

      {tx ? (
        <TransactionsView rows={txs.data} loading={txs.loading} error={txs.error} ccy={ccy}
          allLink={accountId ? href({ tx: 1, costCenterId }) : null} />
      ) : (
        <Card flush>
          {report.loading && !data ? <Spinner /> : report.error ? <div className="card-body"><ErrorMessage error={report.error} /></div> : !data ? null : !data.budgetId ? <Empty>{L.noBudget}</Empty> : (
            <>
              <div className="table-toolbar">
                <span className="muted small">{fmt(L.periodNote, { period: periodText })} · {ccy}</span>
                <span className="legend toolbar-right rep-legend">
                  <span><i className="sw sw-actual" />{L.legendActual}</span>
                  <span><i className="sw sw-committed-cbar" />{L.legendCommitted}</span>
                  <span><i className="sw sw-pending" />{L.legendPending}</span>
                </span>
                {costCenterId && <Link className="btn btn-secondary btn-sm" to={href({ tx: 1, costCenterId })}>{L.allTransactions}</Link>}
              </div>
              {data.rows.length === 0 ? <Empty>{L.empty}</Empty> : (
                <div className="table-scroll">
                  <table className="table rep-table">
                    <thead><tr>
                      <th>{L.name}</th>
                      {showAnnual && <th className="r">{t('common.annualBudget')}</th>}
                      <th className="r">{t('common.budget')}</th><th className="r">{t('common.originalBudget')}</th>
                      <th className="r">{t('common.pending')}</th><th className="r">{t('common.committed')}</th><th className="r">{t('common.actual')}</th>
                      <th className="r">{t('common.available')}</th><th className="r">{t('common.variance')}</th><th className="r">{L.variancePct}</th>
                      <th>{t('common.consumption')}</th><th className="r">{t('common.forecast')}</th>
                    </tr></thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const to = drill(r);
                        return (
                          <tr key={r.key} className={to ? 'clickable' : ''} onClick={to ? () => navigate(to) : undefined}>
                            <td className="rep-name">
                              {to ? <Link to={to} onClick={(e) => e.stopPropagation()}><b>{r.code}</b> {r.name}</Link> : <span><b>{r.code}</b> {r.name}</span>}
                              {r.parentName && <span className="muted small">{r.parentName}</span>}
                            </td>
                            <MeasureCells m={r} showAnnual={showAnnual} />
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr>
                      <td><b>{t('common.total')}</b></td>
                      <MeasureCells m={data.totals} showAnnual={showAnnual} bold />
                    </tr></tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}

function MeasureCells({ m, showAnnual, bold }: { m: Measures; showAnnual: boolean; bold?: boolean }) {
  const { locale } = useI18n();
  const v = (n: number) => (bold ? <b>{money(n, locale)}</b> : money(n, locale));
  return (
    <>
      {showAnnual && <td className="r num muted">{v(m.annualBudget)}</td>}
      <td className="r num">{v(m.budget)}</td>
      <td className="r num muted">{v(m.originalBudget)}</td>
      <td className="r num">{v(m.pending)}</td>
      <td className="r num">{v(m.committed)}</td>
      <td className="r num">{v(m.actual)}</td>
      <td className={`r num${m.available < 0 ? ' neg' : ''}`}>{v(m.available)}</td>
      <td className="r num"><Variance value={m.variance} /></td>
      <td className="r num"><VariancePct value={m.variancePct} /></td>
      <td><ConsumptionBar actual={m.actual} committed={m.committed} pending={m.pending} budget={m.budget} /></td>
      <td className="r num">{v(m.forecast)}</td>
    </>
  );
}

function TransactionsView({ rows, loading, error, ccy, allLink }: { rows: TransactionDto[] | null; loading: boolean; error: unknown; ccy: string; allLink: string | null }) {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const actualTotal = (rows ?? []).filter((r) => r.kind === 'ACTUAL').reduce((s, r) => s + r.amount, 0);
  const requestTotal = (rows ?? []).filter((r) => r.kind === 'REQUEST' && !['REJECTED', 'CANCELLED'].includes(r.status)).reduce((s, r) => s + r.amount, 0);
  const sourceLabel = (s: string) => (s === 'MANUAL' ? L.sourceMANUAL : s === 'IMPORT' || s === 'EXCEL' ? L.sourceIMPORT : s === 'REQUEST' ? L.sourceREQUEST : s);
  return (
    <Card flush title={L.transactions} subtitle={ccy} actions={allLink ? <Link className="btn btn-secondary btn-sm" to={allLink}>{L.allTransactions}</Link> : undefined}>
      {loading && !rows ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !rows?.length ? <Empty>{L.txEmpty}</Empty> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr>
              <th>{L.kind}</th><th>{L.reference}</th><th>{t('common.month')}</th><th>{t('common.date')}</th>
              <th>{t('common.description')}</th><th>{t('common.status')}</th><th className="r">{t('common.amount')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}:${r.id}`}>
                  <td><Badge tone={r.kind === 'ACTUAL' ? 'dark' : 'info'}>{r.kind === 'ACTUAL' ? L.kindACTUAL : L.kindREQUEST}</Badge></td>
                  <td className="nowrap">{r.kind === 'REQUEST' ? (r.link ? <Link to={r.link}>{r.reference}</Link> : r.reference) : (r.link ? <Link to={r.link}>{sourceLabel(r.reference)}</Link> : sourceLabel(r.reference))}</td>
                  <td>{MONTH_SHORT[lang][r.month - 1]}</td>
                  <td className="nowrap">{date(r.date, locale)}</td>
                  <td>{r.description || '—'}</td>
                  <td>{r.kind === 'REQUEST' && (REQUEST_STATUSES as readonly string[]).includes(r.status) ? <RequestStatusBadge status={r.status as RequestStatus} /> : <span className="muted small">{sourceLabel(r.status)}</span>}</td>
                  <td className="r num">{money(r.amount, locale, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}><b>{L.actualTotal}</b></td><td className="r num"><b>{money(actualTotal, locale, 2)}</b></td></tr>
              <tr><td colSpan={6}>{L.requestTotal}</td><td className="r num">{money(requestTotal, locale, 2)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
