import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MONTH_SHORT, REQUEST_STATUSES, REQUEST_TYPES, type PurchaseRequestDto } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  Badge, BudgetCheckBadge, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, PageHeader, RequestStatusBadge, Select, Spinner,
} from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useYear } from '../../lib/useYear';
import '../../styles/spend.css';

const az = {
  title: 'Satınalma və xərc sorğuları',
  subtitle: 'Sorğular göndərilərkən büdcə qalığı yoxlanılır; təsdiqlənmiş sorğular öhdəlik kimi büdcədən ayrılır.',
  newPurchase: 'Yeni satınalma sorğusu',
  newExpense: 'Yeni xərc sorğusu',
  number: 'Nömrə',
  titleCol: 'Mövzu',
  base: 'Baza valyutada',
  budgetState: 'Büdcə yoxlaması',
  requester: 'Sorğu edən',
  mine: 'Yalnız mənim sorğularım',
  allYears: 'Bütün illər',
  searchPh: 'Nömrə, mövzu, təchizatçı…',
  count: '{n} sorğu',
  empty: 'Seçilmiş filtrlərə uyğun sorğu yoxdur.',
  emptyFirst: 'Hələ sorğu yaradılmayıb. Satınalma və ya xərc sorğusu yaradın — büdcə qalığı avtomatik yoxlanılacaq.',
  totalBase: 'Cəmi (baza valyutada)',
  spent: 'Fakt: {a}',
};
const TEXT = {
  az,
  en: {
    title: 'Purchase & expense requests',
    subtitle: 'Funds are checked when a request is submitted; approved requests are reserved against the budget as commitments.',
    newPurchase: 'New purchase request',
    newExpense: 'New expense request',
    number: 'Number',
    titleCol: 'Subject',
    base: 'In base currency',
    budgetState: 'Funds check',
    requester: 'Requester',
    mine: 'Only my requests',
    allYears: 'All years',
    searchPh: 'Number, subject, vendor…',
    count: '{n} requests',
    empty: 'No requests match the selected filters.',
    emptyFirst: 'No requests yet. Raise a purchase or expense request — funds are checked automatically.',
    totalBase: 'Total (base currency)',
    spent: 'Actual: {a}',
  } satisfies typeof az,
};

export function RequestsPage() {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { years } = useYear();
  const [params, setParams] = useSearchParams();
  const year = params.get('year') ?? String(new Date().getFullYear());
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const cc = params.get('cc') ?? '';
  const mine = params.get('mine') === '1';
  const [search, setSearch] = useState('');
  const base = user?.company?.baseCurrency ?? 'AZN';

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const { data, error, loading } = useAsync(
    () => api<PurchaseRequestDto[]>('GET', `/requests${qs({ year: year === 'all' ? undefined : year, status: status || undefined, mine: mine ? '1' : undefined })}`),
    [year, status, mine],
  );

  const ccOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of data ?? []) m.set(r.costCenterId, `${r.costCenterCode} · ${r.costCenterName}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value: String(value), label }));
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => (!type || r.requestType === type) && (!cc || String(r.costCenterId) === cc)
      && (!q || `${r.number} ${r.title} ${r.vendor ?? ''} ${r.requestedBy}`.toLowerCase().includes(q)));
  }, [data, type, cc, search]);
  const totalBase = rows.reduce((s, r) => s + r.amountBase, 0);
  const filtered = !!(status || type || cc || mine || search);

  return (
    <>
      <PageHeader
        title={L.title}
        subtitle={L.subtitle}
        actions={<>
          {can('excel.export') && <ExportButton path={`/export/requests${qs({ year: year === 'all' ? undefined : year })}`} filename="requests.xlsx" />}
          <Link className="btn btn-secondary" to="/requests/new?type=EXPENSE"><Icon name="plus" /> {L.newExpense}</Link>
          <Link className="btn btn-primary" to="/requests/new?type=PURCHASE"><Icon name="plus" /> {L.newPurchase}</Link>
        </>}
      />
      <Card>
        <div className="filters">
          <Field label={t('common.year')}>{(id) => (
            <Select id={id} value={year} onChange={(e) => set('year', e.target.value)}
              options={[{ value: 'all', label: L.allYears }, ...[...new Set([...years, Number(year)].filter((y) => !Number.isNaN(y)))].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }))]} />
          )}</Field>
          <Field label={t('common.type')}>{(id) => (
            <Select id={id} value={type} onChange={(e) => set('type', e.target.value)}
              options={[{ value: '', label: t('common.all') }, ...REQUEST_TYPES.map((x) => ({ value: x, label: t(`requestType.${x}`) }))]} />
          )}</Field>
          <Field label={t('common.status')}>{(id) => (
            <Select id={id} value={status} onChange={(e) => set('status', e.target.value)}
              options={[{ value: '', label: t('common.all') }, ...REQUEST_STATUSES.map((x) => ({ value: x, label: t(`requestStatus.${x}`) }))]} />
          )}</Field>
          <Field label={t('common.costCenter')}>{(id) => (
            <Select id={id} value={cc} onChange={(e) => set('cc', e.target.value)} options={[{ value: '', label: t('common.all') }, ...ccOptions]} />
          )}</Field>
          <Field label={t('common.search')}>{(id) => <Input id={id} type="search" value={search} placeholder={L.searchPh} onChange={(e) => setSearch(e.target.value)} />}</Field>
          <label className="check filters-check">
            <input type="checkbox" checked={mine} onChange={(e) => set('mine', e.target.checked ? '1' : '')} /> {L.mine}
          </label>
        </div>
      </Card>

      <Card flush>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : rows.length === 0 ? (
          <Empty>{filtered || (data?.length ?? 0) > 0 ? L.empty : L.emptyFirst}</Empty>
        ) : (
          <>
            <div className="table-toolbar"><span className="muted small">{fmt(L.count, { n: rows.length })}</span></div>
            <div className="table-scroll">
              <table className="table req-table">
                <thead><tr>
                  <th>{L.number}</th><th>{t('common.type')}</th><th>{L.titleCol}</th><th>{t('common.costCenter')}</th><th>{t('common.account')}</th>
                  <th>{t('common.period')}</th><th className="r">{t('common.amount')}</th><th className="r">{L.base}</th>
                  <th>{L.budgetState}</th><th>{t('common.status')}</th><th>{L.requester}</th><th>{t('common.date')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                      <td><Link to={`/requests/${r.id}`} onClick={(e) => e.stopPropagation()}><b>{r.number}</b></Link></td>
                      <td><Badge tone={r.requestType === 'PURCHASE' ? 'info' : 'neutral'}>{t(`requestType.${r.requestType}` as TKey)}</Badge></td>
                      <td className="req-title">
                        <span>{r.title}</span>
                        {r.vendor && <span className="muted small">{r.vendor}</span>}
                      </td>
                      <td><b>{r.costCenterCode}</b> <span className="muted small">{r.costCenterName}</span></td>
                      <td><span className="acc-code">{r.accountCode}</span> <span className="small">{r.accountName}</span></td>
                      <td className="nowrap">{MONTH_SHORT[lang][r.month - 1]} {r.fiscalYear}</td>
                      <td className="r num nowrap">{money(r.amount, locale, 2)} <span className="muted small">{r.currency}</span></td>
                      <td className="r num nowrap">
                        {money(r.amountBase, locale, 2)}
                        {r.actualBase > 0 && <div className="muted small">{fmt(L.spent, { a: money(r.actualBase, locale) })}</div>}
                      </td>
                      <td><BudgetCheckBadge state={r.budgetState} /></td>
                      <td><RequestStatusBadge status={r.status} /></td>
                      <td className="nowrap">{r.requestedBy}</td>
                      <td className="nowrap">{date(r.submittedAt ?? r.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={7}><b>{L.totalBase}</b></td>
                  <td className="r num nowrap"><b>{money(totalBase, locale, 2)}</b> <span className="muted small">{base}</span></td>
                  <td colSpan={4} />
                </tr></tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
