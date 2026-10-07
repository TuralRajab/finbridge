import { useMemo, useState } from 'react';
import type {
  BudgetDetailDto, PlanningComparisonDto, PlanningDelta, PlanningForecastMethod, PlanningMonthlyDto, PlanningRow, PlanningYearInfo,
} from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { GroupedBarChart, type BarSeries } from '../../components/charts/GroupedBarChart';
import { PlanMonthlyChart, type MonthlyLine } from '../../components/charts/PlanMonthlyChart';
import { Alert, Button, Card, Empty, ErrorMessage, Field, Icon, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { money, pct } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Delta } from './budgetUi';
import '../../styles/planning.css';

const az = {
  groupBy: 'Qruplaşdırma',
  bySection: 'Departament',
  byCostCenter: 'Xərc mərkəzi',
  byAccount: 'Hesab',
  years: 'Müqayisə dövrü',
  yearsN: 'Son {n} il',
  forecast: 'Natamam il üçün proqnoz',
  fcBudget: 'Fakt + qalan ayların büdcəsi',
  fcRunRate: 'Orta aylıq fakt × 12',
  all: 'Bütün şirkət',
  allMine: 'Mənim sahəm',
  crumbsLabel: 'Drill-down yolu',
  planOf: 'Plan {year}',
  planHint: 'v{n} · seçilmiş versiya',
  lastActual: 'Fakt {year}',
  lastForecast: 'Proqnoz {year}',
  ytd: '{n} ay fakt: {amount}',
  vsActual: 'Δ plan − fakt/proqnoz',
  vsBudget: 'Δ plan − büdcə {year}',
  finalBudget: 'yekun büdcə {amount}',
  partialNote: '{year} ili natamamdır: {n} ay üzrə fakt var. Tam il proqnozu = {method}.',
  completeNote: '{year} ili tamamlanıb (12 ay fakt).',
  noBudget: '{year} üçün büdcə yoxdur',
  scopeNote: 'Yalnız sizə aid departament və xərc mərkəzləri göstərilir.',
  chartTitle: 'Əvvəlki illərin faktı və büdcəsi ilə {year} planının müqayisəsi',
  chartLimited: 'Qrafikdə cari sıralama üzrə ilk {n} sətir göstərilir; hamısı cədvəldədir.',
  chartYears: 'Qrafikdə son iki il göstərilir; {year} ili yalnız cədvəldədir.',
  seriesActual: 'Fakt {year}',
  seriesBudget: 'Büdcə {year}',
  seriesPlan: 'Plan {year}',
  name: 'Ad',
  original: 'İlkin büdcə',
  final: 'Yekun büdcə',
  budget: 'Büdcə',
  actual: 'Fakt',
  actualPartial: 'Fakt ({n} ay)',
  forecastCol: 'Proqnoz',
  plan: 'Plan',
  dAbs: 'Δ faktdan',
  dPct: 'Δ %',
  dBudgetPct: 'Δ % büdcədən',
  total: 'Cəmi',
  drillHint: 'Ətraflı baxmaq üçün ada klikləyin; sətrə klikləmək aylar üzrə qrafiki açır.',
  open: 'Aç: {name}',
  noRows: 'Bu səviyyədə nə plan, nə də əvvəlki illər üzrə məlumat var.',
  noHistory: 'Əvvəlki maliyyə illəri üzrə büdcə və ya fakt tapılmadı — müqayisə yalnız plan üzrə göstərilir.',
  monthlyTitle: 'Aylar üzrə: {name}',
  monthlyAria: 'Aylar üzrə əvvəlki illərin faktı, keçən ilin büdcəsi və plan',
  monthlyHint: 'Cədvəldə sətir seçin — burada həmin sətrin aylıq müqayisəsi göstəriləcək.',
  sortBy: '{col} üzrə sırala',
  fc: 'proqnoz',
  forecastBadge: 'Proqnozdur: {n} ay fakt + qalan aylar',
  close: 'Bağla',
};
const TEXT = {
  az,
  en: {
    groupBy: 'Group by',
    bySection: 'Department',
    byCostCenter: 'Cost center',
    byAccount: 'Account',
    years: 'Comparison period',
    yearsN: 'Last {n} years',
    forecast: 'Forecast for a partial year',
    fcBudget: 'Actual + remaining months\' budget',
    fcRunRate: 'Average monthly actual × 12',
    all: 'Whole company',
    allMine: 'My area',
    crumbsLabel: 'Drill-down path',
    planOf: 'Plan {year}',
    planHint: 'v{n} · selected version',
    lastActual: 'Actual {year}',
    lastForecast: 'Forecast {year}',
    ytd: '{n} months actual: {amount}',
    vsActual: 'Δ plan − actual/forecast',
    vsBudget: 'Δ plan − budget {year}',
    finalBudget: 'final budget {amount}',
    partialNote: '{year} is not complete: actuals for {n} months. Full-year forecast = {method}.',
    completeNote: '{year} is complete (12 months of actuals).',
    noBudget: 'No budget for {year}',
    scopeNote: 'Only your own departments and cost centers are shown.',
    chartTitle: 'Prior years\' actuals and budget compared with the {year} plan',
    chartLimited: 'The chart shows the first {n} rows of the current sort order; the table has all of them.',
    chartYears: 'The chart shows the last two years; {year} is in the table only.',
    seriesActual: 'Actual {year}',
    seriesBudget: 'Budget {year}',
    seriesPlan: 'Plan {year}',
    name: 'Name',
    original: 'Original budget',
    final: 'Final budget',
    budget: 'Budget',
    actual: 'Actual',
    actualPartial: 'Actual ({n} mo.)',
    forecastCol: 'Forecast',
    plan: 'Plan',
    dAbs: 'Δ vs actual',
    dPct: 'Δ %',
    dBudgetPct: 'Δ % vs budget',
    total: 'Total',
    drillHint: 'Click a name to drill down; click a row to open its monthly chart.',
    open: 'Open: {name}',
    noRows: 'There is no plan or prior-year data at this level.',
    noHistory: 'No budget or actuals were found for prior fiscal years — only the plan is shown.',
    monthlyTitle: 'By month: {name}',
    monthlyAria: 'Prior years\' actuals, last year\'s budget and the plan by month',
    monthlyHint: 'Select a row in the table to see its monthly comparison here.',
    sortBy: 'Sort by {col}',
    fc: 'forecast',
    forecastBadge: 'Forecast: {n} months actual + remaining months',
    close: 'Close',
  } satisfies typeof az,
};
type Texts = typeof az;

type Root = 'section' | 'costCenter' | 'account';
interface Drill { unitId?: number; unitName?: string; costCenterId?: number; costCenterName?: string }
interface Col { key: string; label: string; get: (r: PlanningRow) => number | null; first?: boolean; plan?: boolean }

const CHART_ROWS = 15;

export function PctDelta({ d }: { d: PlanningDelta }) {
  const { locale } = useI18n();
  if (d.pct === null) return <span className="muted">—</span>;
  const dir = d.pct > 0 ? 'up' : d.pct < 0 ? 'down' : 'zero';
  return <span className={`pc-pct ${dir}`}>{dir !== 'zero' && <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>}{pct(d.pct, locale)}</span>;
}

export function PlanningTab({ detail }: { detail: BudgetDetailDto }) {
  const L = useLocal(TEXT);
  const { lang, locale } = useI18n();
  const [root, setRoot] = useState<Root>('section');
  const [drill, setDrill] = useState<Drill>({});
  const [years, setYears] = useState(2);
  const [forecast, setForecast] = useState<PlanningForecastMethod>('budget');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'code', dir: 1 });
  const [selected, setSelected] = useState<PlanningRow | null>(null);
  const groupBy: Root = drill.costCenterId ? 'account' : drill.unitId ? 'costCenter' : root;
  const versionId = detail.version.id;
  const filters = { versionId, unitId: drill.unitId, costCenterId: drill.costCenterId, years, forecast };

  const { data, error, loading } = useAsync(
    () => api<PlanningComparisonDto>('GET', `/budgets/${detail.id}/planning${qs({ ...filters, groupBy })}`),
    [detail.id, versionId, groupBy, drill.unitId, drill.costCenterId, years, forecast],
  );
  const name = (r: PlanningRow) => (lang === 'en' && r.nameEn ? r.nameEn : r.name);

  const rowFilters = (r: PlanningRow | null) => {
    if (!r) return {};
    if (r.kind === 'section') return { unitId: r.id };
    if (r.kind === 'costCenter') return { costCenterId: r.id };
    if (r.kind === 'account') return { accountId: r.id };
    return {};
  };
  const sel = selected && data?.rows.some((r) => r.key === selected.key) ? selected : null;
  const monthly = useAsync(
    () => api<PlanningMonthlyDto>('GET', `/budgets/${detail.id}/planning/monthly${qs({ ...filters, ...rowFilters(sel) })}`),
    [detail.id, versionId, drill.unitId, drill.costCenterId, years, forecast, sel?.key],
  );

  const infos = data?.years ?? [];
  const chrono = [...infos].reverse(); // oldest first
  const last = infos[0];
  const cols: Col[] = useMemo(() => {
    const out: Col[] = [];
    chrono.forEach((info) => {
      const idx = infos.indexOf(info);
      const isLast = idx === 0;
      if (isLast) {
        out.push({ key: `o${idx}`, label: L.original, get: (r) => r.years[idx].originalBudget, first: true });
        out.push({ key: `f${idx}`, label: L.final, get: (r) => r.years[idx].finalBudget });
      } else {
        out.push({ key: `f${idx}`, label: L.budget, get: (r) => r.years[idx].finalBudget, first: true });
      }
      out.push({ key: `a${idx}`, label: info.complete ? L.actual : fmt(L.actualPartial, { n: info.monthsWithActuals }), get: (r) => r.years[idx].actual });
      if (!info.complete) out.push({ key: `x${idx}`, label: L.forecastCol, get: (r) => r.years[idx].fullYear });
    });
    out.push({ key: 'plan', label: L.plan, get: (r) => r.plan, first: true, plan: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, L]);

  const rows = useMemo(() => {
    const rs = [...(data?.rows ?? [])];
    const val = (r: PlanningRow): number | string | null => {
      if (sort.key === 'code') return r.code;
      if (sort.key === 'dAbs') return r.vsLastActual.abs;
      if (sort.key === 'dPct') return r.vsLastActual.pct;
      if (sort.key === 'dBudgetPct') return r.vsLastBudget.pct;
      return cols.find((c) => c.key === sort.key)?.get(r) ?? null;
    };
    return rs.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y, undefined, { numeric: true }) * sort.dir;
      return ((x as number) - (y as number)) * sort.dir;
    });
  }, [data, sort, cols]);

  const drillInto = (r: PlanningRow) => {
    setSelected(null);
    if (r.kind === 'section') setDrill({ unitId: r.id, unitName: name(r) });
    else if (r.kind === 'costCenter') setDrill({ ...drill, costCenterId: r.id, costCenterName: `${r.code} ${name(r)}` });
  };
  const changeRoot = (g: Root) => { setRoot(g); setDrill({}); setSelected(null); };
  const canDrill = (r: PlanningRow) => r.kind === 'section' || r.kind === 'costCenter';

  const sortHeader = (key: string, label: string, className = '', rowSpan?: number) => {
    const active = sort.key === key;
    return (
      <th key={key} className={className} rowSpan={rowSpan} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="sort-btn" title={fmt(L.sortBy, { col: label })}
          onClick={() => setSort(active ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'code' ? 1 : -1 })}>
          {label}<span className="sort-ind" aria-hidden="true">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  // chart: up to two prior years' actuals, last year's budget and the plan
  const chartSeries: BarSeries[] = [];
  const chartGetters: ((r: PlanningRow) => number | null)[] = [];
  if (infos[1]) { chartSeries.push({ key: 'a1', label: fmt(L.seriesActual, { year: infos[1].year }), className: 'pc-s1', hatched: !infos[1].complete }); chartGetters.push((r) => r.years[1].fullYear); }
  if (last) {
    chartSeries.push({ key: 'b0', label: fmt(L.seriesBudget, { year: last.year }), className: 'pc-s2' }); chartGetters.push((r) => r.years[0].finalBudget);
    chartSeries.push({ key: 'a0', label: fmt(L.seriesActual, { year: last.year }), className: 'pc-s3', hatched: !last.complete }); chartGetters.push((r) => r.years[0].fullYear);
  }
  chartSeries.push({ key: 'plan', label: fmt(L.seriesPlan, { year: detail.fiscalYear }), className: 'pc-s4' }); chartGetters.push((r) => r.plan);
  const chartRows = rows.slice(0, CHART_ROWS);
  const hasHistory = infos.some((i) => i.budgetId !== null || i.monthsWithActuals > 0);
  const t = data?.totals;
  const lastFull = t && last ? t.years[0] : null;
  const methodText = forecast === 'budget' ? L.fcBudget : L.fcRunRate;

  const monthlyLines: MonthlyLine[] = [];
  if (monthly.data) {
    const ys = monthly.data.years;
    if (ys[1]) monthlyLines.push({ key: 'a1', label: fmt(L.seriesActual, { year: ys[1].year }), className: 'pc-l1', values: ys[1].actual });
    if (ys[0]) {
      monthlyLines.push({ key: 'b0', label: fmt(L.seriesBudget, { year: ys[0].year }), className: 'pc-l2', values: ys[0].budget, dashed: true });
      monthlyLines.push({ key: 'a0', label: fmt(L.seriesActual, { year: ys[0].year }), className: 'pc-l3', values: ys[0].actual });
    }
  }
  const selName = sel ? `${sel.code} ${name(sel)}` : drill.costCenterName ?? drill.unitName ?? (data?.companyWide === false ? L.allMine : L.all);

  return (
    <>
      <Card>
        <div className="pc-toolbar">
          <div className="seg-field">
            <span className="seg-label" id="pc-group-label">{L.groupBy}</span>
            <div className="seg" role="group" aria-labelledby="pc-group-label">
              {([['section', L.bySection], ['costCenter', L.byCostCenter], ['account', L.byAccount]] as [Root, string][]).map(([g, label]) => (
                <button key={g} type="button" className={root === g && !drill.unitId && !drill.costCenterId ? 'is-active' : ''}
                  aria-pressed={root === g && !drill.unitId && !drill.costCenterId} onClick={() => changeRoot(g)}>{label}</button>
              ))}
            </div>
          </div>
          <Field label={L.years}>
            {(id) => <Select id={id} value={years} onChange={(e) => setYears(Number(e.target.value))}
              options={[1, 2, 3].map((n) => ({ value: n, label: fmt(L.yearsN, { n }) }))} />}
          </Field>
          <Field label={L.forecast}>
            {(id) => <Select id={id} value={forecast} onChange={(e) => setForecast(e.target.value as PlanningForecastMethod)}
              options={[{ value: 'budget', label: L.fcBudget }, { value: 'run_rate', label: L.fcRunRate }]} />}
          </Field>
        </div>
        <nav aria-label={L.crumbsLabel}>
          <ol className="pc-crumbs">
            <li>{drill.unitId || drill.costCenterId
              ? <button type="button" onClick={() => { setDrill({}); setSelected(null); }}>{data?.companyWide === false ? L.allMine : L.all}</button>
              : <span aria-current="page">{data?.companyWide === false ? L.allMine : L.all}</span>}</li>
            {drill.unitId && <li>{drill.costCenterId
              ? <button type="button" onClick={() => { setDrill({ unitId: drill.unitId, unitName: drill.unitName }); setSelected(null); }}>{drill.unitName}</button>
              : <span aria-current="page">{drill.unitName}</span>}</li>}
            {drill.costCenterId && <li><span aria-current="page">{drill.costCenterName}</span></li>}
          </ol>
        </nav>
      </Card>

      {loading && !data ? <Spinner /> : error ? <ErrorMessage error={error} /> : data && t && (
        <>
          <div className="kpis pc-kpis">
            <div className="kpi">
              <div className="kpi-label">{fmt(L.planOf, { year: detail.fiscalYear })}</div>
              <div className="kpi-value num">{money(t.plan, locale)}<span className="kpi-unit">{data.currency}</span></div>
              <div className="kpi-foot">{fmt(L.planHint, { n: data.versionNo })}</div>
            </div>
            {last && lastFull && (
              <>
                <div className="kpi">
                  <div className="kpi-label">{fmt(last.complete ? L.lastActual : L.lastForecast, { year: last.year })}</div>
                  <div className="kpi-value num">{money(lastFull.fullYear, locale)}<span className="kpi-unit">{data.currency}</span></div>
                  <div className="kpi-foot">{last.complete ? fmt(L.finalBudget, { amount: money(lastFull.finalBudget, locale) })
                    : fmt(L.ytd, { n: last.monthsWithActuals, amount: money(lastFull.actual, locale) })}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{L.vsActual}</div>
                  <div className="kpi-value num"><Delta value={t.vsLastActual.abs} strong /></div>
                  <div className="kpi-foot"><PctDelta d={t.vsLastActual} /></div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{fmt(L.vsBudget, { year: last.year })}</div>
                  <div className="kpi-value num"><Delta value={t.vsLastBudget.abs} strong /></div>
                  <div className="kpi-foot"><PctDelta d={t.vsLastBudget} /> · {fmt(L.finalBudget, { amount: money(lastFull.finalBudget, locale) })}</div>
                </div>
              </>
            )}
          </div>

          <div className="mb-8 small muted pc-note">
            {infos.map((i) => (
              <span key={i.year}>
                {i.budgetId === null && i.monthsWithActuals === 0 ? fmt(L.noBudget, { year: i.year })
                  : i.complete ? fmt(L.completeNote, { year: i.year })
                    : fmt(L.partialNote, { year: i.year, n: i.monthsWithActuals, method: methodText })}
              </span>
            ))}
          </div>
          {!data.companyWide && <p className="small muted mb-8"><Icon name="lock" /> {L.scopeNote}</p>}
          {!hasHistory && <Alert kind="info">{L.noHistory}</Alert>}

          {rows.length === 0 ? <Card><Empty>{L.noRows}</Empty></Card> : (
            <>
              <Card title={fmt(L.chartTitle, { year: detail.fiscalYear })}>
                <GroupedBarChart
                  title={fmt(L.chartTitle, { year: detail.fiscalYear })}
                  categories={chartRows.map((r) => ({ key: r.key, label: `${groupBy === 'section' ? '' : `${r.code} `}${name(r)}`, sublabel: r.parentName ?? undefined }))}
                  series={chartSeries}
                  values={chartRows.map((r) => chartGetters.map((g) => g(r)))}
                  currency={data.currency}
                  selectedKey={sel?.key ?? null}
                  onSelect={(key) => setSelected(rows.find((r) => r.key === key) ?? null)}
                  footer={<>
                    {rows.length > CHART_ROWS && <p className="small muted">{fmt(L.chartLimited, { n: CHART_ROWS })}</p>}
                    {infos[2] && <p className="small muted">{fmt(L.chartYears, { year: infos[2].year })}</p>}
                  </>}
                />
              </Card>

              <Card flush>
                <p className="small muted lines-hint">{L.drillHint}</p>
                <div className="table-scroll">
                  <PlanningTable L={L} data={data} rows={rows} cols={cols} chrono={chrono} infos={infos} name={name} sortHeader={sortHeader}
                    selectedKey={sel?.key ?? null} onSelect={(r) => setSelected(sel?.key === r.key ? null : r)} onDrill={drillInto} canDrill={canDrill} groupBy={groupBy} />
                </div>
              </Card>
            </>
          )}

          <Card title={fmt(L.monthlyTitle, { name: selName })} actions={sel ? <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>{L.close}</Button> : undefined}>
            {!sel && <p className="small muted mb-8">{L.monthlyHint}</p>}
            {monthly.loading && !monthly.data ? <Spinner /> : monthly.error ? <ErrorMessage error={monthly.error} /> : monthly.data && (
              <PlanMonthlyChart title={`${L.monthlyAria}: ${selName}`} plan={monthly.data.plan} planLabel={fmt(L.seriesPlan, { year: detail.fiscalYear })}
                lines={monthlyLines} currency={monthly.data.currency} />
            )}
          </Card>
        </>
      )}
    </>
  );
}

function PlanningTable({ L, data, rows, cols, chrono, infos, name, sortHeader, selectedKey, onSelect, onDrill, canDrill, groupBy }: {
  L: Texts; data: PlanningComparisonDto; rows: PlanningRow[]; cols: Col[]; chrono: PlanningYearInfo[]; infos: PlanningYearInfo[];
  name: (r: PlanningRow) => string; sortHeader: (key: string, label: string, className?: string, rowSpan?: number) => JSX.Element;
  selectedKey: string | null; onSelect: (r: PlanningRow) => void; onDrill: (r: PlanningRow) => void; canDrill: (r: PlanningRow) => boolean; groupBy: Root;
}) {
  const { locale } = useI18n();
  const t = data.totals;
  const span = (info: PlanningYearInfo) => (infos.indexOf(info) === 0 ? 3 : 2) + (info.complete ? 0 : 1);
  const nameLabel = groupBy === 'section' ? L.bySection : groupBy === 'costCenter' ? L.byCostCenter : L.byAccount;
  const cell = (c: Col, r: PlanningRow, strong = false) => {
    const v = c.get(r);
    const isFc = c.key.startsWith('x');
    const body = <>{money(v, locale)}{isFc && <span className="pc-fc" title={L.fc}>{L.fc}</span>}</>;
    return <td key={c.key} className={`r num${c.first ? ' pc-first' : ''}${c.plan ? ' pc-plan' : ''}`}>{strong ? <b>{body}</b> : body}</td>;
  };
  return (
    <table className="table pc-table">
      <caption className="sr-only">{nameLabel}</caption>
      <thead>
        <tr>
          {sortHeader('code', nameLabel, '', 2)}
          {chrono.map((info) => <th key={info.year} colSpan={span(info)} className="pc-year" scope="colgroup">{info.year}{!info.complete && <span className="pc-fc">{L.fc}</span>}</th>)}
          <th colSpan={4} className="pc-year pc-plan" scope="colgroup">{data.fiscalYear}</th>
        </tr>
        <tr>
          {cols.map((c) => sortHeader(c.key, c.label, `r${c.first ? ' pc-first' : ''}${c.plan ? ' pc-plan' : ''}`))}
          {sortHeader('dAbs', L.dAbs, 'r')}
          {sortHeader('dPct', L.dPct, 'r')}
          {sortHeader('dBudgetPct', L.dBudgetPct, 'r')}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={selectedKey === r.key ? 'is-selected' : ''} aria-selected={selectedKey === r.key} onClick={() => onSelect(r)}>
            <td>
              {canDrill(r)
                ? <button type="button" className="drill" aria-label={fmt(L.open, { name: name(r) })} onClick={(e) => { e.stopPropagation(); onDrill(r); }}>
                  {groupBy !== 'section' && <span className="acc-code">{r.code}</span>} {name(r)} <span aria-hidden="true">›</span>
                </button>
                : <button type="button" className="drill" onClick={(e) => { e.stopPropagation(); onSelect(r); }}><span className="acc-code">{r.code}</span> {name(r)}</button>}
              {r.parentName && <div className="muted small">{r.parentName}</div>}
            </td>
            {cols.map((c) => cell(c, r))}
            <td className="r num"><Delta value={r.vsLastActual.abs} /></td>
            <td className="r num"><PctDelta d={r.vsLastActual} /></td>
            <td className="r num"><PctDelta d={r.vsLastBudget} /></td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td><b>{L.total}</b> <span className="muted small">({rows.length})</span></td>
          {cols.map((c) => cell(c, t, true))}
          <td className="r num"><Delta value={t.vsLastActual.abs} strong /></td>
          <td className="r num"><PctDelta d={t.vsLastActual} /></td>
          <td className="r num"><PctDelta d={t.vsLastBudget} /></td>
        </tr>
      </tfoot>
    </table>
  );
}
