import { useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, type ForecastMethod, type PlanVsActualDto, type PlanVsActualGroupBy } from '@finbridge/shared';
import { api, qs } from '../api/client';
import { BudgetStatusBadge, Button, Card, Empty, ErrorMessage, ExportButton, Field, PageHeader, Select, Spinner, Variance, VariancePct } from '../components/ui';
import { useI18n } from '../i18n';
import { money, periodLabel } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useYear } from './useYear';

export function PlanVsActualPage() {
  const { t, locale, lang } = useI18n();
  const { year, setYear, years } = useYear();
  const [params, setParams] = useSearchParams();
  const departmentId = params.get('departmentId') ? Number(params.get('departmentId')) : undefined;
  const groupBy = (params.get('groupBy') as PlanVsActualGroupBy | null) ?? (departmentId ? 'costCenter' : 'department');
  const method = (params.get('method') as ForecastMethod | null) ?? 'budget';
  const through = params.get('through') ? Number(params.get('through')) : undefined;
  const query = { year, through, groupBy, departmentId, method };

  const { data, loading, error } = useAsync(() => api<PlanVsActualDto>('GET', `/reports/plan-vs-actual${qs(query)}`), [year, through, groupBy, departmentId, method]);
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') next.delete(k); else next.set(k, v); }
    setParams(next);
  };
  const maxAbs = Math.max(1, ...(data?.rows ?? []).map((r) => Math.abs(r.variance)));
  const deptName = departmentId && data?.rows[0]?.parentName;

  return (
    <>
      <PageHeader
        title={t('pva.title')}
        subtitle={<>{t('pva.subtitle')}{data && <> · {year} · {periodLabel(data.throughMonth, lang)} · AZN</>}</>}
        actions={<ExportButton path={`/export/plan-vs-actual${qs(query)}`} filename={`plan-vs-actual-${year}.xlsx`} />}
      />
      <Card>
        <div className="filters">
          <Field label={t('common.year')}>{(id) => <Select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: y, label: String(y) }))} />}</Field>
          <Field label={t('pva.through')}>
            {(id) => <Select id={id} value={through ?? data?.throughMonth ?? ''} onChange={(e) => update({ through: e.target.value })}
              options={MONTH_NAMES[lang].map((m, i) => ({ value: i + 1, label: m }))} />}
          </Field>
          <Field label={t('pva.groupBy')}>
            {(id) => <Select id={id} value={groupBy} onChange={(e) => update({ groupBy: e.target.value, departmentId: e.target.value === 'costCenter' ? String(departmentId ?? '') : undefined })}
              options={[{ value: 'department', label: t('pva.byDepartment') }, { value: 'costCenter', label: t('pva.byCostCenter') }, { value: 'account', label: t('pva.byAccount') }]} />}
          </Field>
          <Field label={t('pva.method')}>
            {(id) => <Select id={id} value={method} onChange={(e) => update({ method: e.target.value })}
              options={[{ value: 'budget', label: t('pva.methodBudget') }, { value: 'run_rate', label: t('pva.methodRunRate') }]} />}
          </Field>
        </div>
      </Card>

      {departmentId && (
        <div className="crumbs">
          <Button size="sm" variant="ghost" onClick={() => update({ departmentId: undefined, groupBy: undefined })}>← {t('pva.backToDepartments')}</Button>
          {deptName && <b>{deptName}</b>}
        </div>
      )}

      {loading && !data ? <Spinner /> : error ? <ErrorMessage error={error} /> : !data ? null : !data.budgetId ? <Empty>{t('pva.noBudget')}</Empty> : (
        <Card flush title={<>{year} {data.budgetStatus && <BudgetStatusBadge status={data.budgetStatus} />}</>} subtitle={groupBy === 'department' ? t('pva.drillHint') : undefined}>
          <div className="table-scroll">
            <table className="table pva-table">
              <thead><tr>
                <th>{t('common.code')}</th>
                <th>{groupBy === 'department' ? t('pva.byDepartment') : groupBy === 'costCenter' ? t('pva.byCostCenter') : t('pva.byAccount')}</th>
                <th className="r">{t('pva.annualBudget')}</th>
                <th className="r">{t('pva.budgetYtd')}</th>
                <th className="r">{t('pva.actualYtd')}</th>
                <th className="r">{t('pva.variance')}</th>
                <th className="r">{t('pva.variancePct')}</th>
                <th className="bar-col" aria-hidden="true" />
                <th className="r">{t('pva.forecast')}</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className={groupBy === 'department' ? 'clickable' : ''}
                    onClick={groupBy === 'department' ? () => update({ departmentId: String(r.id), groupBy: 'costCenter' }) : undefined}>
                    <td className="muted">{r.code}</td>
                    <td><b>{r.name}</b>{r.parentName && !departmentId && <div className="muted small">{r.parentName}</div>}</td>
                    <td className="r num">{money(r.annualBudget, locale)}</td>
                    <td className="r num">{money(r.budgetYtd, locale)}</td>
                    <td className="r num">{money(r.actualYtd, locale)}</td>
                    <td className="r num"><Variance value={r.variance} /></td>
                    <td className="r num"><VariancePct value={r.variancePct} /></td>
                    <td className="bar-col"><DivergingBar value={r.variance} max={maxAbs} /></td>
                    <td className="r num">{money(r.forecast, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td /><td><b>{t('common.total')}</b></td>
                <td className="r num"><b>{money(data.totals.annualBudget, locale)}</b></td>
                <td className="r num"><b>{money(data.totals.budgetYtd, locale)}</b></td>
                <td className="r num"><b>{money(data.totals.actualYtd, locale)}</b></td>
                <td className="r num"><Variance value={data.totals.variance} /></td>
                <td className="r num"><VariancePct value={data.totals.variancePct} /></td>
                <td />
                <td className="r num"><b>{money(data.totals.forecast, locale)}</b></td>
              </tr></tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function DivergingBar({ value, max }: { value: number; max: number }) {
  const w = (Math.abs(value) / max) * 50;
  return (
    <div className="dbar">
      <span className="dbar-mid" />
      {value !== 0 && <span className={`dbar-fill ${value > 0 ? 'over' : 'under'}`} style={value > 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />}
    </div>
  );
}
