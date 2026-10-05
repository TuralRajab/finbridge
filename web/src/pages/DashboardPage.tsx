import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { varianceState, type DashboardDto, type ReportRow, type SectionStatus } from '@finbridge/shared';
import { api, qs } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { MonthlyChart } from '../components/MonthlyChart';
import {
  Card, ConsumptionBar, Empty, ErrorMessage, Field, PageHeader, SectionStatusBadge, Select, Spinner, Variance, VariancePct, VersionStatusBadge,
} from '../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../i18n';
import { compact, money, pct, periodLabel, signedMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useYear } from '../lib/useYear';
import '../styles/reports.css';

const az = {
  title: 'İdarəetmə paneli',
  subtitle: '{year} maliyyə ili · faktlar {period} dövrü üzrə',
  subtitleNoActuals: '{year} maliyyə ili · faktiki xərc hələ daxil edilməyib',
  noBudget: '{year} ili üçün büdcə yoxdur.',
  annualBudget: 'İllik büdcə',
  ytdBudget: 'Dövr üzrə büdcə',
  actual: 'Fakt',
  committed: 'Açıq öhdəliklər',
  committedFoot: 'təsdiqlənmiş, hələ fakturalanmamış',
  available: 'Qalıq',
  availableFoot: 'illik büdcə − fakt − öhdəlik',
  availablePending: 'illik büdcə − fakt − öhdəlik − təsdiqdə',
  variance: 'Fərq (dövr üzrə)',
  over: 'büdcədən artıq',
  under: 'qənaət',
  consumption: 'İstifadə',
  consumptionFoot: '(fakt + öhdəlik) / illik büdcə',
  monthly: 'Aylar üzrə büdcə, fakt və öhdəlik',
  capex: 'CAPEX və OPEX',
  capexHint: 'İllik büdcə üzrə',
  sections: 'Büdcə bölmələri üzrə istifadə',
  sectionsHint: 'İllik büdcəyə görə · sətrə klikləyərək xərc mərkəzlərinə keçin',
  topCc: 'Büdcəni ən çox aşan xərc mərkəzləri',
  topAcc: 'Büdcəni ən çox aşan hesablar',
  topHint: 'Dövr üzrə fərq · klikləyərək təfərrüata keçin',
  noOverspend: 'Dövr üzrə büdcəni aşan mövqe yoxdur.',
  approvals: 'Təsdiqlər',
  myPending: 'Mənim təsdiqimi gözləyir',
  allPending: 'Şirkət üzrə gözləyən',
  overdue: 'Müddəti keçmiş',
  openInbox: 'Təsdiqlərimə keç',
  openWf: 'Axınlar hesabatı',
  changes: 'Büdcə dəyişiklikləri',
  changesApproved: 'Təsdiqlənmiş',
  changesPending: 'Təsdiqdə',
  netChange: 'Xalis dəyişiklik',
  openChanges: 'Dəyişikliklər hesabatı',
  requests: 'Satınalma və xərc sorğuları',
  reqInApproval: 'Təsdiqdə',
  reqOpen: 'Təsdiqlənmiş, açıq',
  openRequests: 'Sorğulara keç',
  planning: 'Planlama: {year} büdcəsi',
  planningProgress: '{done} / {total} bölmə təsdiqlənib',
  openBudget: 'Büdcəni aç',
  noSections: 'Sizin görünüş sahənizdə bölmə yoxdur.',
  allConsumption: 'Büdcə istifadəsi hesabatı',
  version: 'Versiya {n}',
  ofBudget: 'büdcənin {p}',
  budgetLabel: 'büdcə',
};
const TEXT = {
  az,
  en: {
    title: 'Dashboard',
    subtitle: 'Fiscal year {year} · actuals through {period}',
    subtitleNoActuals: 'Fiscal year {year} · no actuals recorded yet',
    noBudget: 'There is no budget for {year}.',
    annualBudget: 'Annual budget',
    ytdBudget: 'Budget to date',
    actual: 'Actual',
    committed: 'Open commitments',
    committedFoot: 'approved, not yet invoiced',
    available: 'Available',
    availableFoot: 'annual budget − actual − committed',
    availablePending: 'annual budget − actual − committed − pending',
    variance: 'Variance (to date)',
    over: 'over budget',
    under: 'saving',
    consumption: 'Consumption',
    consumptionFoot: '(actual + committed) / annual budget',
    monthly: 'Monthly budget, actual and commitments',
    capex: 'CAPEX vs OPEX',
    capexHint: 'Against the annual budget',
    sections: 'Consumption by budget section',
    sectionsHint: 'Against the annual budget · click a row to see its cost centers',
    topCc: 'Top overspending cost centers',
    topAcc: 'Top overspending accounts',
    topHint: 'Variance to date · click to drill down',
    noOverspend: 'Nothing is over budget to date.',
    approvals: 'Approvals',
    myPending: 'Waiting for me',
    allPending: 'Pending company-wide',
    overdue: 'Overdue',
    openInbox: 'Open my approvals',
    openWf: 'Workflow report',
    changes: 'Budget changes',
    changesApproved: 'Approved',
    changesPending: 'In approval',
    netChange: 'Net change',
    openChanges: 'Change report',
    requests: 'Purchase & expense requests',
    reqInApproval: 'In approval',
    reqOpen: 'Approved, open',
    openRequests: 'Open requests',
    planning: 'Planning: {year} budget',
    planningProgress: '{done} / {total} sections approved',
    openBudget: 'Open budget',
    noSections: 'No sections in your scope.',
    allConsumption: 'Consumption report',
    version: 'Version {n}',
    ofBudget: '{p} of budget',
    budgetLabel: 'budget',
  } satisfies typeof az,
};

export function DashboardPage() {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const ccy = user?.company?.baseCurrency ?? 'AZN';
  const { year, setYear, years } = useYear();
  const { data, loading, error } = useAsync(() => api<DashboardDto>('GET', `/reports/dashboard${qs({ year })}`), [year]);

  const yearSelect = (
    <Field label={t('common.year')}>{(id) => (
      <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: y, label: String(y) }))} />
    )}</Field>
  );
  const head = (sub?: ReactNode) => <PageHeader title={L.title} subtitle={sub} actions={<div className="dash-year">{yearSelect}</div>} />;
  if (loading && !data) return <>{head()}<Spinner /></>;
  if (error) return <>{head()}<ErrorMessage error={error} /></>;
  if (!data) return null;

  const period = periodLabel(data.throughMonth, lang);
  const T = data.totals;
  const Y = data.ytd;
  const vState = varianceState(Y.variance);
  const through = data.throughMonth || undefined;
  const link = (p: Record<string, string | number | undefined>) => `/reports/consumption${qs({ year, ...p })}`;
  const includesPending = Math.abs(T.annualBudget - T.actual - T.committed - T.pending - T.available) < 1 && T.pending > 0;

  return (
    <>
      {head(data.throughMonth ? fmt(L.subtitle, { year, period }) : fmt(L.subtitleNoActuals, { year }))}
      {!data.budget ? <Empty>{fmt(L.noBudget, { year })}</Empty> : (
        <>
          <div className="kpis dash-kpis">
            <Kpi label={L.annualBudget} value={compact(T.annualBudget, locale)} ccy={ccy}
              foot={<>{data.budget.currentStatus && <VersionStatusBadge status={data.budget.currentStatus} />} {data.budget.currentVersionNo ? fmt(L.version, { n: data.budget.currentVersionNo }) : null}</>} />
            <Kpi label={L.ytdBudget} value={compact(Y.budget, locale)} ccy={ccy} foot={period} />
            <Kpi label={L.actual} value={compact(Y.actual, locale)} ccy={ccy} foot={fmt(L.ofBudget, { p: pct(Y.budget ? (Y.actual / Y.budget) * 100 : null, locale, false) })} />
            <Kpi label={L.committed} value={compact(T.committed, locale)} ccy={ccy} foot={L.committedFoot} />
            <Kpi label={L.available} value={compact(T.available, locale)} ccy={ccy} tone={T.available < 0 ? 'over' : undefined}
              foot={includesPending ? L.availablePending : L.availableFoot} />
            <Kpi tone={vState} label={L.variance} value={(Y.variance > 0 ? '+' : '') + compact(Y.variance, locale)} ccy={ccy}
              foot={<>{vState === 'over' ? `▲ ${L.over}` : vState === 'under' ? `▼ ${L.under}` : '•'} · {pct(Y.variancePct, locale)}</>} />
            <Kpi label={L.consumption} value={pct(T.consumptionPct, locale, false)} foot={L.consumptionFoot} />
          </div>

          <div className="grid-dash">
            <Card title={L.monthly} subtitle={`${year} · ${ccy}`}>
              <MonthlyChart data={data.monthly} currency={ccy} />
            </Card>
            <Card title={L.capex} subtitle={L.capexHint}>
              <ul className="dash-classes">
                {data.capexOpex.map((c) => (
                  <li key={c.expenseClass}>
                    <div className="rank-head"><b>{t(`expenseClass.${c.expenseClass}` as TKey)}</b><span className="num">{money(c.budget, locale)} <span className="muted small">{ccy}</span></span></div>
                    <ConsumptionBar actual={c.actual} committed={c.committed} budget={c.budget} />
                    <small className="muted">{t('common.actual')} {money(c.actual, locale)} · {t('common.committed')} {money(c.committed, locale)} · {t('common.available')} {money(c.budget - c.actual - c.committed, locale)}</small>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid-dash">
            <Card title={L.sections} subtitle={`${L.sectionsHint} · ${ccy}`} flush actions={<Link className="btn btn-secondary btn-sm" to={link({ through })}>{L.allConsumption}</Link>}>
              {data.sections.length === 0 ? <Empty>{t('common.noData')}</Empty> : (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr>
                      <th>{t('common.section')}</th><th className="r">{t('common.annualBudget')}</th><th className="r">{t('common.actual')}</th>
                      <th className="r">{t('common.committed')}</th><th className="r">{t('common.available')}</th><th>{t('common.consumption')}</th>
                    </tr></thead>
                    <tbody>
                      {data.sections.map((r) => (
                        <tr key={r.key} className="clickable" onClick={() => navigate(link({ groupBy: 'costCenter', parentUnitId: r.id }))}>
                          <td><Link to={link({ groupBy: 'costCenter', parentUnitId: r.id })} onClick={(e) => e.stopPropagation()}><b>{r.name}</b></Link></td>
                          <td className="r num">{money(r.annualBudget, locale)}</td>
                          <td className="r num">{money(r.actual, locale)}</td>
                          <td className="r num">{money(r.committed, locale)}</td>
                          <td className={`r num${r.available < 0 ? ' neg' : ''}`}>{money(r.available, locale)}</td>
                          <td><ConsumptionBar actual={r.actual} committed={r.committed} budget={r.annualBudget} pending={0} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr>
                      <td><b>{t('common.total')}</b></td>
                      <td className="r num"><b>{money(T.annualBudget, locale)}</b></td>
                      <td className="r num"><b>{money(T.actual, locale)}</b></td>
                      <td className="r num"><b>{money(T.committed, locale)}</b></td>
                      <td className="r num"><b>{money(T.available, locale)}</b></td>
                      <td><ConsumptionBar actual={T.actual} committed={T.committed} budget={T.annualBudget} /></td>
                    </tr></tfoot>
                  </table>
                </div>
              )}
            </Card>
            <div className="dash-stack">
              <Card title={L.approvals}>
                <ul className="status-list dash-counts">
                  <li><Link to="/approvals">{L.myPending}</Link><b className="num">{data.approvals.pendingMine}</b></li>
                  {data.approvals.pendingTotal > 0 && <li><span>{L.allPending}</span><b className="num">{data.approvals.pendingTotal}</b></li>}
                  <li>
                    <span>{L.overdue}</span>
                    {data.approvals.overdue > 0 ? <span className="badge badge-danger"><span aria-hidden="true">!</span> {data.approvals.overdue}</span> : <b className="num">0</b>}
                  </li>
                </ul>
                <div className="dash-links">
                  <Link to="/approvals">{L.openInbox} →</Link>
                  {can('reports.view') && <Link to="/reports/workflows">{L.openWf} →</Link>}
                </div>
              </Card>
              <Card title={L.requests}>
                <ul className="status-list dash-counts">
                  <li><Link to="/requests?status=IN_APPROVAL">{L.reqInApproval}</Link><b className="num">{data.requests.inApproval}</b></li>
                  <li><Link to="/requests?status=APPROVED">{L.reqOpen}</Link><b className="num">{data.requests.approvedOpen}</b></li>
                </ul>
              </Card>
              <Card title={L.changes}>
                <ul className="status-list dash-counts">
                  <li><span>{L.changesApproved}</span><b className="num">{data.changes.approved}</b></li>
                  <li><span>{L.changesPending}</span><b className="num">{data.changes.pending}</b></li>
                  <li><span>{L.netChange}</span><b className="num">{signedMoney(data.changes.netChange, locale)} <span className="muted small">{ccy}</span></b></li>
                </ul>
                <div className="dash-links"><Link to={`/reports/changes${qs({ year })}`}>{L.openChanges} →</Link></div>
              </Card>
            </div>
          </div>

          <div className="grid-2 gap-lg dash-top">
            <Card title={L.topCc} subtitle={`${L.topHint} · ${period}`}>
              <TopList rows={data.topCostCenters} empty={L.noOverspend} to={(r) => link({ groupBy: 'account', costCenterId: r.id, through })} />
            </Card>
            <Card title={L.topAcc} subtitle={`${L.topHint} · ${period}`}>
              <TopList rows={data.topAccounts} empty={L.noOverspend} to={() => link({ groupBy: 'account', through })} />
            </Card>
          </div>
        </>
      )}

      {data.planning && <PlanningCard planning={data.planning} />}
    </>
  );
}

function PlanningCard({ planning }: { planning: NonNullable<DashboardDto['planning']> }) {
  const L = useLocal(TEXT);
  const order: SectionStatus[] = ['RETURNED', 'NOT_STARTED', 'IN_PROGRESS', 'IN_APPROVAL', 'APPROVED'];
  const done = planning.sections.filter((s) => s.status === 'APPROVED').length;
  const total = planning.sections.length;
  const counts = order.map((s) => ({ s, n: planning.sections.filter((x) => x.status === s).length })).filter((x) => x.n > 0);
  return (
    <Card title={fmt(L.planning, { year: planning.fiscalYear })} subtitle={fmt(L.planningProgress, { done, total })}
      actions={<Link className="btn btn-secondary btn-sm" to={`/budgets/${planning.budgetId}`}>{L.openBudget}</Link>}>
      <div className="row gap"><VersionStatusBadge status={planning.status} /></div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="dash-plan-counts">{counts.map((c) => <span key={c.s}><SectionStatusBadge status={c.s} /> <b>{c.n}</b></span>)}</div>
      {total === 0 ? <p className="muted">{L.noSections}</p> : (
        <ul className="status-list dash-plan">
          {[...planning.sections].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name)).map((s) => (
            <li key={s.name}><span>{s.name}</span><SectionStatusBadge status={s.status} /></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TopList({ rows, empty, to }: { rows: ReportRow[]; empty: string; to: (r: ReportRow) => string }) {
  const { locale } = useI18n();
  const L = useLocal(TEXT);
  if (!rows.length) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.variance));
  return (
    <ul className="rank">
      {rows.map((r) => (
        <li key={r.key}>
          <Link to={to(r)} className="rank-link">
            <div className="rank-head"><span><b>{r.code}</b> {r.name}</span><Variance value={r.variance} /></div>
            <div className="rank-bar"><span style={{ width: `${max > 0 ? (r.variance / max) * 100 : 0}%` }} /></div>
            <small className="muted">{r.parentName ? `${r.parentName} · ` : ''}<VariancePct value={r.variancePct} /> · {L.budgetLabel} {money(r.budget, locale)}</small>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, foot, tone, ccy }: { label: string; value: string; foot?: ReactNode; tone?: 'over' | 'under' | 'on'; ccy?: string }) {
  return (
    <div className={`kpi${tone && tone !== 'on' ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}{ccy && <span className="kpi-unit">{ccy}</span>}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
