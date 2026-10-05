import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { REQUEST_STATUSES, type BudgetDto, type ChangeRequestDto, type RequestStatus } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, PageHeader, RequestStatusBadge, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useYear } from '../../lib/useYear';
import { Delta, sum } from '../budgets/budgetUi';
import '../../styles/budgets.css';

const az = {
  title: 'Büdcə dəyişiklikləri',
  subtitle: 'Kilidlənmiş büdcəyə düzəliş sorğuları. Təsdiqləndikdə yeni versiya yaranır, əvvəlki versiya dəyişməz qalır.',
  create: 'Yeni dəyişiklik sorğusu',
  year: 'Maliyyə ili',
  allYears: 'Bütün illər',
  budget: 'Büdcə',
  status: 'Status',
  search: 'Axtarış',
  searchPlaceholder: 'Nömrə, mövzu, xərc mərkəzi',
  number: 'Nömrə',
  titleCol: 'Mövzu',
  costCenter: 'Xərc mərkəzi',
  increase: 'Artım',
  decrease: 'Azalma',
  net: 'Xalis',
  requester: 'Sorğu edən',
  created: 'Yaradılıb',
  version: 'Versiya',
  empty: 'Seçilmiş filtrlər üzrə dəyişiklik sorğusu yoxdur.',
  count: '{n} sorğu',
  totals: 'Cəmi',
  all: 'Hamısı',
  resultVersion: 'v{a} → v{b}',
  baseVersion: 'v{a} əsasında',
};
const TEXT = {
  az,
  en: {
    title: 'Budget changes',
    subtitle: 'Requests to amend a locked budget. On approval a new version is created; the previous version stays unchanged.',
    create: 'New change request',
    year: 'Fiscal year',
    allYears: 'All years',
    budget: 'Budget',
    status: 'Status',
    search: 'Search',
    searchPlaceholder: 'Number, title, cost center',
    number: 'Number',
    titleCol: 'Title',
    costCenter: 'Cost center',
    increase: 'Increase',
    decrease: 'Decrease',
    net: 'Net',
    requester: 'Requested by',
    created: 'Created',
    version: 'Version',
    empty: 'No change requests match the selected filters.',
    count: '{n} requests',
    totals: 'Total',
    all: 'All',
    resultVersion: 'v{a} → v{b}',
    baseVersion: 'based on v{a}',
  } satisfies typeof az,
};

const split = (c: ChangeRequestDto) => ({
  up: sum(c.items.filter((i) => i.difference > 0).map((i) => i.difference)),
  down: sum(c.items.filter((i) => i.difference < 0).map((i) => i.difference)),
});

export function ChangesPage() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { years } = useYear();
  const budgetId = params.get('budgetId') ? Number(params.get('budgetId')) : undefined;
  const year = params.get('year') ? Number(params.get('year')) : undefined;
  const status = (params.get('status') ?? '') as RequestStatus | '';
  const [search, setSearch] = useState('');

  const budgets = useAsync(() => api<BudgetDto[]>('GET', '/budgets'), []);
  const { data, error, loading } = useAsync(() => api<ChangeRequestDto[]>('GET', `/changes${qs({ budgetId, year })}`), [budgetId, year]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const q = search.trim().toLocaleLowerCase(locale);
  const rows = useMemo(() => (data ?? []).filter((c) => (!status || c.status === status)
    && (!q || `${c.number} ${c.title} ${c.costCenterCode} ${c.costCenterName} ${c.requestedBy}`.toLocaleLowerCase(locale).includes(q))), [data, status, q, locale]);
  const totals = rows.reduce((acc, c) => { const s = split(c); return { up: acc.up + s.up, down: acc.down + s.down }; }, { up: 0, down: 0 });
  const yearOptions = [...new Set([...years, ...(budgets.data ?? []).map((b) => b.fiscalYear)])].sort((a, b) => b - a);
  const exportYear = year ?? (budgetId ? budgets.data?.find((b) => b.id === budgetId)?.fiscalYear : undefined);

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<>
        {can('excel.export') && exportYear && <ExportButton path={`/export/changes?year=${exportYear}`} filename={`budget-changes-${exportYear}.xlsx`} />}
        {can('change.create') && (
          <Button variant="primary" onClick={() => navigate(`/changes/new${qs({ budgetId })}`)}><Icon name="plus" /> {L.create}</Button>
        )}
      </>} />
      <Card flush>
        <div className="table-toolbar">
          <div className="filters">
            <Field label={L.year}>
              {(id) => <Select id={id} value={year ?? ''} onChange={(e) => { const next = new URLSearchParams(params); next.delete('budgetId'); if (e.target.value) next.set('year', e.target.value); else next.delete('year'); setParams(next, { replace: true }); }}
                options={[{ value: '', label: L.allYears }, ...yearOptions.map((y) => ({ value: y, label: String(y) }))]} />}
            </Field>
            <Field label={L.budget}>
              {(id) => <Select id={id} value={budgetId ?? ''} onChange={(e) => setParam('budgetId', e.target.value)}
                options={[{ value: '', label: L.all }, ...(budgets.data ?? []).filter((b) => !year || b.fiscalYear === year).map((b) => ({ value: b.id, label: `${b.fiscalYear} · ${b.name}` }))]} />}
            </Field>
            <Field label={L.status}>
              {(id) => <Select id={id} value={status} onChange={(e) => setParam('status', e.target.value)}
                options={[{ value: '', label: L.all }, ...REQUEST_STATUSES.filter((s) => s !== 'CLOSED').map((s) => ({ value: s, label: t(`requestStatus.${s}`) }))]} />}
            </Field>
            <Field label={L.search}>
              {(id) => <Input id={id} type="search" value={search} placeholder={L.searchPlaceholder} onChange={(e) => setSearch(e.target.value)} />}
            </Field>
          </div>
          {data && <span className="toolbar-right muted small">{fmt(L.count, { n: rows.length })}</span>}
        </div>
        <ErrorMessage error={error} />
        {loading && !data ? <Spinner /> : rows.length === 0 ? <Empty>{L.empty}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.number}</th><th>{L.titleCol}</th><th>{L.costCenter}</th><th>{L.version}</th>
                <th className="r">{L.increase}</th><th className="r">{L.decrease}</th><th className="r">{L.net}</th>
                <th>{L.status}</th><th>{L.requester}</th><th>{L.created}</th>
              </tr></thead>
              <tbody>
                {rows.map((c) => {
                  const s = split(c);
                  return (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/changes/${c.id}`)}>
                      <td className="nowrap"><Link to={`/changes/${c.id}`} onClick={(e) => e.stopPropagation()}><b>{c.number}</b></Link></td>
                      <td>{c.title}</td>
                      <td><b>{c.costCenterCode}</b> <span className="small">{c.costCenterName}</span></td>
                      <td className="small nowrap">{c.resultVersionNo ? fmt(L.resultVersion, { a: c.baseVersionNo, b: c.resultVersionNo }) : fmt(L.baseVersion, { a: c.baseVersionNo })}</td>
                      <td className="r num">{s.up ? <Delta value={s.up} /> : <span className="muted">—</span>}</td>
                      <td className="r num">{s.down ? <Delta value={s.down} /> : <span className="muted">—</span>}</td>
                      <td className="r num"><b>{money(c.totalDifference, locale)}</b></td>
                      <td><RequestStatusBadge status={c.status} /></td>
                      <td>{c.requestedBy}</td>
                      <td className="small nowrap">{date(c.createdAt, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={4}><b>{L.totals}</b></td>
                <td className="r num"><Delta value={totals.up} /></td>
                <td className="r num"><Delta value={totals.down} /></td>
                <td className="r num"><Delta value={totals.up + totals.down} strong /></td>
                <td colSpan={3} />
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
