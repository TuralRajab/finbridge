import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DashboardDto } from '@finbridge/shared';
import { varianceState } from '@finbridge/shared';
import { api, qs } from '../api/client';
import { MonthlyChart } from '../components/MonthlyChart';
import { BudgetStatusBadge, Card, DeptStatusBadge, Empty, ErrorMessage, ExportButton, PageHeader, Select, Spinner, Variance, VariancePct } from '../components/ui';
import { useI18n } from '../i18n';
import { compact, money, pct, periodLabel } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useYear } from './useYear';

export function DashboardPage() {
  const { t, locale, lang } = useI18n();
  const navigate = useNavigate();
  const { year, setYear, years } = useYear();
  const { data, loading, error } = useAsync(() => api<DashboardDto>('GET', `/reports/dashboard${qs({ year })}`), [year]);

  const yearSelect = <Select value={year} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: y, label: String(y) }))} aria-label={t('common.year')} />;
  if (loading && !data) return <><PageHeader title={t('dashboard.title')} actions={yearSelect} /><Spinner /></>;
  if (error) return <><PageHeader title={t('dashboard.title')} actions={yearSelect} /><ErrorMessage error={error} /></>;
  if (!data) return null;

  const k = data.kpis;
  const state = varianceState(k.variance);
  const period = periodLabel(data.throughMonth, lang);
  const reviewed = data.approval?.departments.filter((d) => d.status === 'REVIEWED').length ?? 0;

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle', { year, period })}
        actions={<>{yearSelect}<ExportButton path={`/export/plan-vs-actual${qs({ year })}`} filename={`plan-vs-actual-${year}.xlsx`} /></>}
      />
      {!data.budget && <Empty>{t('dashboard.noBudget', { year })}</Empty>}
      {data.budget && (
        <>
          <div className="kpis">
            <Kpi label={t('dashboard.annualBudget')} value={compact(k.annualBudget, locale)} foot={<BudgetStatusBadge status={data.budget.status} />} />
            <Kpi label={t('dashboard.budgetYtd')} value={compact(k.budgetYtd, locale)} foot={period} />
            <Kpi label={t('dashboard.actualYtd')} value={compact(k.actualYtd, locale)} foot={period} />
            <Kpi tone={state} label={t('dashboard.variance')} value={(k.variance > 0 ? '+' : '') + compact(k.variance, locale)}
              foot={<>{state === 'over' ? '▲ ' + t('dashboard.over') : state === 'under' ? '▼ ' + t('dashboard.under') : ''} · {pct(k.variancePct, locale)}</>} />
            <Kpi label={t('dashboard.forecast')} value={compact(k.forecast, locale)} foot={t('dashboard.forecastVsBudget', { pct: pct(k.forecastVsBudgetPct, locale) })} />
          </div>
          {data.throughMonth === 0 && <div className="alert alert-info">{t('dashboard.noActuals')}</div>}

          <div className="grid-dash">
            <Card title={t('dashboard.monthlyTitle')} subtitle={`${year} · AZN`}>
              <MonthlyChart data={data.monthly} />
            </Card>
            {data.approval ? (
              <Card title={t('dashboard.approvalTitle', { year: data.approval.year })} subtitle={t('dashboard.approvalProgress', { done: reviewed, total: data.approval.departments.length })}
                actions={<Link className="btn btn-secondary btn-sm" to={`/budgets/${data.approval.budgetId}`}>{t('dashboard.openBudget')}</Link>}>
                <div className="progress"><span style={{ width: `${data.approval.departments.length ? (reviewed / data.approval.departments.length) * 100 : 0}%` }} /></div>
                <div className="mb-8"><BudgetStatusBadge status={data.approval.status} /></div>
                <ul className="status-list">
                  {data.approval.departments.map((d) => <li key={d.name}><span>{d.name}</span><DeptStatusBadge status={d.status} /></li>)}
                </ul>
              </Card>
            ) : (
              <Card title={t('dashboard.overspendsTitle')}><Overspends data={data} /></Card>
            )}
          </div>

          <div className="grid-dash">
            <Card title={t('dashboard.departmentsTitle')} subtitle={`${period} · AZN`} flush>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>{t('lines.department')}</th><th className="r">{t('pva.budgetYtd')}</th><th className="r">{t('pva.actualYtd')}</th><th className="r">{t('pva.variance')}</th><th className="r">{t('pva.variancePct')}</th><th className="r">{t('pva.forecast')}</th></tr></thead>
                  <tbody>
                    {data.departments.map((d) => (
                      <tr key={d.key} className="clickable" onClick={() => navigate(`/plan-vs-actual?departmentId=${d.id}`)}>
                        <td><b>{d.name}</b></td>
                        <td className="r num">{money(d.budgetYtd, locale)}</td>
                        <td className="r num">{money(d.actualYtd, locale)}</td>
                        <td className="r num"><Variance value={d.variance} /></td>
                        <td className="r num"><VariancePct value={d.variancePct} /></td>
                        <td className="r num">{money(d.forecast, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {data.approval && <Card title={t('dashboard.overspendsTitle')}><Overspends data={data} /></Card>}
          </div>
        </>
      )}
    </>
  );
}

function Overspends({ data }: { data: DashboardDto }) {
  const { t, locale } = useI18n();
  if (!data.topOverspends.length) return <p className="muted">{t('dashboard.noOverspends')}</p>;
  const max = Math.max(...data.topOverspends.map((r) => r.variance));
  return (
    <ul className="rank">
      {data.topOverspends.map((r) => (
        <li key={r.key}>
          <div className="rank-head"><span><b>{r.code}</b> {r.name}</span><Variance value={r.variance} /></div>
          <div className="rank-bar"><span style={{ width: `${(r.variance / max) * 100}%` }} /></div>
          <small className="muted">{r.parentName} · {pct(r.variancePct, locale)}</small>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, foot, tone }: { label: string; value: string; foot?: ReactNode; tone?: 'over' | 'under' | 'on' }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}<span className="kpi-unit">AZN</span></div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
