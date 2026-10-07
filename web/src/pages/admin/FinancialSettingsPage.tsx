import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MONTH_NAMES, MONTH_SHORT, type CompanyDto, type CompanySettingsDto, type CurrencyDto, type ExchangeRateDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { BulkImportButton } from '../../components/BulkImportDialog';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-security.css';

const az = {
  title: 'Maliyyə ayarları',
  subtitle: 'Büdcə nəzarəti qaydaları, valyutalar və məzənnələr, maliyyə ili.',
  tabControl: 'Büdcə nəzarəti',
  tabCurrencies: 'Valyutalar və məzənnələr',
  tabFiscal: 'Maliyyə təqvimi',
  readOnly: 'Bu ayarları yalnız Administrator dəyişə bilər. Siz cari dəyərlərə baxırsınız.',
  nearTitle: 'Limitə yaxınlıq həddi',
  nearText: 'Sorğu yaradılanda sistem büdcə xəttinin nə qədər istifadə olunacağını hesablayır. İstifadə bu faizə çatdıqda və ya onu keçdikdə sorğu “Limitə yaxın” kimi işarələnir.',
  nearExample: 'Məsələn, 90% seçilsə, 100 000 AZN büdcədən 90 000 AZN-dən çox istifadə xəbərdarlıq yaradır.',
  nearLabel: 'Hədd, %',
  nearError: '1 ilə 100 arasında rəqəm daxil edin.',
  basisTitle: 'Qalığın hesablanma bazası',
  basisText: 'Sorğuda “büdcə qalığı” hansı məbləğə qarşı yoxlanılsın.',
  basisAnnual: 'İllik büdcə',
  basisAnnualHint: 'Qalıq = bütün ilin büdcəsi − fakt − öhdəliklər. Daha çevikdir.',
  basisYtd: 'İlin əvvəlindən (YTD)',
  basisYtdHint: 'Qalıq = ilin əvvəlindən sorğunun aid olduğu ay daxil olmaqla planlaşdırılan büdcə − fakt − öhdəliklər. Gələcək ayların büdcəsini qabaqcadan xərcləməyə imkan vermir.',
  pendingTitle: 'Təsdiqdə olan sorğuları qalıqdan çıx',
  pendingText: 'Aktiv olduqda hələ təsdiqlənməmiş (təsdiq prosesində olan) sorğuların məbləği də mövcud qalıqdan çıxılır. Bu, eyni büdcənin bir neçə paralel sorğu ilə “ikiqat” istifadəsinin qarşısını alır.',
  pendingLabel: 'Təsdiqdə olanları nəzərə al',
  blockTitle: 'Büdcəni aşan sorğuları blokla',
  blockText: 'Aktiv olduqda büdcə qalığını aşan sorğu təsdiqə göndərilə bilməz. Deaktiv olduqda belə sorğu göndərilə bilər, lakin “Büdcəni aşır” kimi işarələnir və təsdiqləyənlər bunu görür.',
  blockLabel: 'Aşan sorğuları qəbul etmə',
  lockTitle: 'Təsdiqdən sonra versiyanı avtomatik kilidlə',
  lockText: 'Aktiv olduqda büdcə versiyası yekun təsdiqləndiyi anda kilidlənir. Kilidlənmiş versiyada dəyişiklik yalnız büdcə dəyişikliyi sorğusu vasitəsilə mümkündür. Deaktiv olduqda maliyyə komandası versiyanı əl ilə kilidləyir.',
  lockLabel: 'Avtomatik kilidlə',
  unsaved: 'Yadda saxlanmamış dəyişikliklər var',
  reset: 'Dəyişiklikləri ləğv et',
  baseCurrency: 'Baza valyutası',
  baseHint: 'Bütün büdcə və hesabatlar baza valyutasında aparılır. Xarici valyutada olan sorğular məzənnə ilə çevrilir.',
  changeBase: 'Şirkət profilində dəyişdirin',
  currencies: 'Valyutalar',
  currenciesSub: 'Sistemdə mövcud valyutalar (platforma səviyyəsində müəyyən edilir).',
  symbol: 'Simvol',
  decimals: 'Onluq rəqəm',
  currentRate: 'Cari məzənnə',
  rates: 'Valyuta məzənnələri',
  ratesSub: '1 vahid xarici valyutanın baza valyutasında dəyəri. Sorğu tarixinə ən yaxın əvvəlki məzənnə tətbiq olunur.',
  addRate: 'Məzənnə əlavə et',
  rate: 'Məzənnə',
  rateHint: '1 {cur} = ? {base}',
  rateError: 'Müsbət rəqəm daxil edin.',
  validFrom: 'Qüvvəyə minmə tarixi',
  sameDateNote: 'Eyni valyuta və tarix üçün məzənnə artıq varsa, yenilənəcək.',
  noRate: 'Məzənnə yoxdur',
  base: 'Baza',
  currentBadge: 'Cari',
  deleteRateTitle: 'Məzənnə silinsin?',
  deleteRate: '{cur} üzrə {date} tarixli məzənnə ({rate}) silinəcək.',
  noRights: 'Məzənnələri yalnız hesablar planını idarə edən istifadəçilər dəyişə bilər.',
  fiscalTitle: 'Maliyyə ili',
  fiscalStart: 'Maliyyə ilinin başlanğıc ayı',
  fiscalText: 'Şirkətin maliyyə ili bu aydan başlayır və 12 ay davam edir. Ay şirkət profilində saxlanılır.',
  fiscalYear: '{y} maliyyə ili',
  periodNote: 'Diqqət: FinBridge-də büdcə dövrləri (1–12) və “ilin əvvəlindən” (YTD) göstəriciləri hazırda təqvim ayları (Yanvar–Dekabr) üzrə aparılır. Yanvardan fərqli başlanğıc ayı məlumat xarakterlidir.',
  fiscalChange: 'Başlanğıc ayını şirkət profilində dəyişmək olar.',
  goCompany: 'Şirkət profilinə keçin',
  calendarYear: 'Təqvim ili ilə üst-üstə düşür',
  offsetYear: 'Təqvim ilindən fərqlənir',
};
const en: typeof az = {
  title: 'Financial settings',
  subtitle: 'Budget-control rules, currencies and exchange rates, fiscal year.',
  tabControl: 'Budget control',
  tabCurrencies: 'Currencies & rates',
  tabFiscal: 'Fiscal calendar',
  readOnly: 'Only an Administrator can change these settings. You are viewing the current values.',
  nearTitle: 'Near-limit threshold',
  nearText: 'When a request is created, the system calculates how much of the budget line will be used. Once usage reaches or passes this percentage, the request is flagged “Near limit”.',
  nearExample: 'For example, with 90%, using more than AZN 90,000 of a AZN 100,000 budget raises a warning.',
  nearLabel: 'Threshold, %',
  nearError: 'Enter a number between 1 and 100.',
  basisTitle: 'Availability basis',
  basisText: 'Which amount a request’s “available budget” is checked against.',
  basisAnnual: 'Annual budget',
  basisAnnualHint: 'Available = full-year budget − actuals − commitments. More flexible.',
  basisYtd: 'Year to date (YTD)',
  basisYtdHint: 'Available = budget planned from the start of the year up to and including the request’s month − actuals − commitments. Prevents spending future months’ budget early.',
  pendingTitle: 'Deduct requests still in approval',
  pendingText: 'When on, the amount of requests that are not yet approved (still in the approval process) is also deducted from the available budget. This prevents the same budget being used twice by parallel requests.',
  pendingLabel: 'Include pending requests',
  blockTitle: 'Block over-budget requests',
  blockText: 'When on, a request that exceeds the available budget cannot be submitted. When off, it can be submitted but is flagged “Over budget” so approvers see it.',
  blockLabel: 'Reject over-budget requests',
  lockTitle: 'Lock version automatically on approval',
  lockText: 'When on, a budget version is locked the moment it receives final approval. A locked version can only change through a budget change request. When off, the finance team locks the version manually.',
  lockLabel: 'Lock automatically',
  unsaved: 'You have unsaved changes',
  reset: 'Discard changes',
  baseCurrency: 'Base currency',
  baseHint: 'All budgets and reports are kept in the base currency. Requests in a foreign currency are converted at the exchange rate.',
  changeBase: 'Change it in the company profile',
  currencies: 'Currencies',
  currenciesSub: 'Currencies available in the system (defined at platform level).',
  symbol: 'Symbol',
  decimals: 'Decimals',
  currentRate: 'Current rate',
  rates: 'Exchange rates',
  ratesSub: 'Value of 1 unit of foreign currency in the base currency. The latest rate on or before the request date applies.',
  addRate: 'Add rate',
  rate: 'Rate',
  rateHint: '1 {cur} = ? {base}',
  rateError: 'Enter a positive number.',
  validFrom: 'Valid from',
  sameDateNote: 'If a rate already exists for the same currency and date, it is updated.',
  noRate: 'No rate',
  base: 'Base',
  currentBadge: 'Current',
  deleteRateTitle: 'Delete exchange rate?',
  deleteRate: 'The {cur} rate dated {date} ({rate}) will be deleted.',
  noRights: 'Only users who manage the chart of accounts can change exchange rates.',
  fiscalTitle: 'Fiscal year',
  fiscalStart: 'Fiscal year start month',
  fiscalText: 'The company’s fiscal year starts in this month and runs for 12 months. The month is stored in the company profile.',
  fiscalYear: 'Fiscal year {y}',
  periodNote: 'Note: budget periods (1–12) and year-to-date (YTD) figures in FinBridge currently follow calendar months (January–December). A start month other than January is for reference only.',
  fiscalChange: 'The start month can be changed in the company profile.',
  goCompany: 'Go to company profile',
  calendarYear: 'Matches the calendar year',
  offsetYear: 'Differs from the calendar year',
};
const TEXT = { az, en };

type Tab = 'control' | 'currencies' | 'fiscal';

export function FinancialSettingsPage() {
  const L = useLocal(TEXT);
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('control');
  const [version, setVersion] = useState(0);
  const company = useAsync(() => api<CompanyDto>('GET', '/company'), []);
  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={can('coa.manage') && <BulkImportButton kind="EXCHANGE_RATES" onDone={() => { setTab('currencies'); setVersion((v) => v + 1); }} />} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'control', label: L.tabControl }, { value: 'currencies', label: L.tabCurrencies }, { value: 'fiscal', label: L.tabFiscal },
      ]} />
      {tab === 'control' && <ControlTab />}
      {tab !== 'control' && (company.loading && !company.data ? <Spinner /> : !company.data ? <ErrorMessage error={company.error} /> : (
        tab === 'currencies' ? <CurrenciesTab key={version} company={company.data} /> : <FiscalTab company={company.data} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ budget control */

function ControlTab() {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const { can } = useAuth();
  const editable = can('company.manage');
  const { data, setData, error, loading } = useAsync(() => api<CompanySettingsDto>('GET', '/company/settings'), []);
  const [f, setF] = useState<CompanySettingsDto | null>(null);
  const [near, setNear] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) { setF(data); setNear(String(data.nearLimitPct)); } }, [data]);

  if (loading && !data) return <Spinner />;
  if (error || !data || !f) return <ErrorMessage error={error} />;

  const nearNum = Number(near.replace(',', '.'));
  const nearValid = near.trim() !== '' && Number.isFinite(nearNum) && nearNum >= 1 && nearNum <= 100;
  const draft: CompanySettingsDto = { ...f, nearLimitPct: nearValid ? nearNum : f.nearLimitPct };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data) || (!nearValid);
  const patch = (p: Partial<CompanySettingsDto>) => { setF({ ...f, ...p }); setSaved(false); };

  const save = async () => {
    setBusy(true); setSaveError(null); setSaved(false);
    try { setData(await api<CompanySettingsDto>('PATCH', '/company/settings', draft)); setSaved(true); } catch (e) { setSaveError(e); } finally { setBusy(false); }
  };

  return (
    <Card>
      {!editable && <Alert kind="info">{L.readOnly}</Alert>}
      <div className="sec-setting">
        <div><h3>{L.nearTitle}</h3><p>{L.nearText}</p><p className="muted">{L.nearExample}</p></div>
        <Field label={L.nearLabel} error={nearValid ? undefined : L.nearError}>
          {(id) => <Input id={id} type="number" min={1} max={100} step={1} className="num" value={near} disabled={!editable}
            onChange={(e) => { setNear(e.target.value); setSaved(false); }} />}
        </Field>
      </div>
      <div className="sec-setting">
        <div><h3>{L.basisTitle}</h3><p>{L.basisText}</p></div>
        <fieldset className="sec-radio" disabled={!editable} aria-label={L.basisTitle}>
          {(['ANNUAL', 'YTD'] as const).map((b) => (
            <label key={b}>
              <input type="radio" name="basis" value={b} checked={f.availabilityBasis === b} onChange={() => patch({ availabilityBasis: b })} />
              <span>{b === 'ANNUAL' ? L.basisAnnual : L.basisYtd}<small>{b === 'ANNUAL' ? L.basisAnnualHint : L.basisYtdHint}</small></span>
            </label>
          ))}
        </fieldset>
      </div>
      <Toggle title={L.pendingTitle} text={L.pendingText} label={L.pendingLabel} checked={f.includePendingInAvailable} disabled={!editable}
        onChange={(v) => patch({ includePendingInAvailable: v })} />
      <Toggle title={L.blockTitle} text={L.blockText} label={L.blockLabel} checked={f.blockOverBudget} disabled={!editable}
        onChange={(v) => patch({ blockOverBudget: v })} />
      <Toggle title={L.lockTitle} text={L.lockText} label={L.lockLabel} checked={f.autoLockOnApproval} disabled={!editable}
        onChange={(v) => patch({ autoLockOnApproval: v })} />
      <ErrorMessage error={saveError} />
      {saved && <Alert kind="success">{t('common.saved')}</Alert>}
      {editable && (
        <div className="sec-form-actions">
          {dirty && <span className="muted small">{L.unsaved}</span>}
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setF(data); setNear(String(data.nearLimitPct)); }}>{L.reset}</Button>
          <Button variant="primary" busy={busy} disabled={!dirty || !nearValid} onClick={save}>{t('common.save')}</Button>
        </div>
      )}
    </Card>
  );
}

function Toggle({ title, text, label, checked, disabled, onChange }: { title: string; text: string; label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div className="sec-setting">
      <div><h3>{title}</h3><p>{text}</p></div>
      <label className="check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label} <span className="muted">({checked ? t('common.yes') : t('common.no')})</span></span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ currencies & rates */

function CurrenciesTab({ company }: { company: CompanyDto }) {
  const L = useLocal(TEXT);
  const { t, lang, locale } = useI18n();
  const { can } = useAuth();
  const editable = can('coa.manage');
  const base = company.baseCurrency;
  const { data, error, loading, reload } = useAsync(async () => {
    const [currencies, rates] = await Promise.all([
      api<CurrencyDto[]>('GET', '/company/currencies'),
      api<ExchangeRateDto[]>('GET', '/company/exchange-rates'),
    ]);
    return { currencies, rates };
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ currency: '', rate: '', validFrom: today });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [del, setDel] = useState<ExchangeRateDto | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<unknown>(null);

  /** Rate in effect today per currency (latest validFrom ≤ today). */
  const current = useMemo(() => {
    const m = new Map<string, ExchangeRateDto>();
    for (const r of data?.rates ?? []) {
      if (r.validFrom > today) continue;
      const prev = m.get(r.currency);
      if (!prev || r.validFrom > prev.validFrom) m.set(r.currency, r);
    }
    return m;
  }, [data, today]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error} />;

  const cname = (c: CurrencyDto) => (lang === 'en' ? c.nameEn : c.nameAz);
  const foreign = data.currencies.filter((c) => c.code !== base);
  const cur = form.currency || foreign[0]?.code || '';
  const rateNum = Number(form.rate.replace(/\s/g, '').replace(',', '.'));
  const rateValid = form.rate.trim() !== '' && Number.isFinite(rateNum) && rateNum > 0 && rateNum <= 1e6;
  const fmtRate = (n: number) => (locale.startsWith('az') ? String(n).replace('.', ',') : String(n));
  const baseCur = data.currencies.find((c) => c.code === base);

  const add = async () => {
    setBusy(true); setFormError(null);
    try {
      await api('POST', '/company/exchange-rates', { currency: cur, rate: rateNum, validFrom: form.validFrom });
      setForm({ ...form, rate: '' });
      await reload();
    } catch (e) { setFormError(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!del) return;
    setDelBusy(true); setDelError(null);
    try { await api('DELETE', `/company/exchange-rates/${del.id}`); setDel(null); await reload(); } catch (e) { setDelError(e); } finally { setDelBusy(false); }
  };

  return (
    <>
      <Card>
        <dl className="facts">
          <div><dt>{L.baseCurrency}</dt><dd>{base}{baseCur ? ` · ${cname(baseCur)} (${baseCur.symbol})` : ''}</dd></div>
          <div><dt>{L.baseHint}</dt><dd>{can('company.manage') ? <Link to="/admin/company">{L.changeBase} →</Link> : <span className="muted small">—</span>}</dd></div>
        </dl>
      </Card>

      <div className="grid-dash">
        <Card flush title={L.currencies} subtitle={L.currenciesSub}>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>{t('common.code')}</th><th>{t('common.name')}</th><th>{L.symbol}</th><th className="r">{L.decimals}</th><th className="r">{L.currentRate}</th></tr></thead>
              <tbody>
                {data.currencies.map((c) => {
                  const r = current.get(c.code);
                  return (
                    <tr key={c.code}>
                      <td><b>{c.code}</b>{c.code === base && <> <Badge tone="info">{L.base}</Badge></>}</td>
                      <td>{cname(c)}</td>
                      <td>{c.symbol}</td>
                      <td className="r num">{c.decimals}</td>
                      <td className="r num">{c.code === base ? '1' : r ? <>{fmtRate(r.rate)} <span className="muted small">{base}</span></> : <span className="muted">{L.noRate}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card flush title={L.rates} subtitle={L.ratesSub}>
          {editable ? (
            <div className="card-body">
              <div className="filters">
                <Field label={t('common.currency')}>
                  {(id) => <Select id={id} value={cur} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    options={foreign.map((c) => ({ value: c.code, label: `${c.code} · ${cname(c)}` }))} />}
                </Field>
                <Field label={L.rate} hint={fmt(L.rateHint, { cur, base })} error={form.rate && !rateValid ? L.rateError : undefined}>
                  {(id) => <Input id={id} inputMode="decimal" className="num" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />}
                </Field>
                <Field label={L.validFrom}>
                  {(id) => <Input id={id} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />}
                </Field>
                <Button variant="primary" busy={busy} disabled={!cur || !rateValid || !/^\d{4}-\d{2}-\d{2}$/.test(form.validFrom)} onClick={add}>
                  <Icon name="plus" /> {L.addRate}
                </Button>
              </div>
              <p className="hint small">{L.sameDateNote}</p>
              <ErrorMessage error={formError} />
            </div>
          ) : <div className="card-body"><Alert kind="info">{L.noRights}</Alert></div>}
          {!data.rates.length ? <Empty>{t('common.noData')}</Empty> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>{t('common.currency')}</th><th>{L.validFrom}</th><th className="r">{L.rate}</th>{editable && <th className="r">{t('common.actions')}</th>}</tr></thead>
                <tbody>
                  {data.rates.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.currency}</b></td>
                      <td>{date(r.validFrom, locale)}{current.get(r.currency)?.id === r.id && <> <Badge tone="success">{L.currentBadge}</Badge></>}</td>
                      <td className="r num">{fmtRate(r.rate)} <span className="muted small">{base}</span></td>
                      {editable && (
                        <td className="r">
                          <Button size="sm" variant="ghost" aria-label={`${t('common.delete')} ${r.currency} ${r.validFrom}`} onClick={() => { setDelError(null); setDel(r); }}>
                            <Icon name="trash" /> {t('common.delete')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {del && (
        <Modal title={L.deleteRateTitle} onClose={() => setDel(null)} footer={<>
          <Button variant="ghost" onClick={() => setDel(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" busy={delBusy} onClick={remove}>{t('common.delete')}</Button>
        </>}>
          <p>{fmt(L.deleteRate, { cur: del.currency, date: date(del.validFrom, locale), rate: `${fmtRate(del.rate)} ${base}` })}</p>
          <ErrorMessage error={delError} />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ fiscal calendar */

function FiscalTab({ company }: { company: CompanyDto }) {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const { can } = useAuth();
  const start = company.fiscalYearStartMonth;
  const y = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => ({ m: ((start - 1 + i) % 12) + 1, year: start + i > 12 ? y + 1 : y, idx: i + 1 }));
  const first = months[0];
  const last = months[11];
  const short = MONTH_SHORT[lang];
  return (
    <Card title={L.fiscalTitle}>
      <dl className="facts">
        <div><dt>{L.fiscalStart}</dt><dd>{MONTH_NAMES[lang][start - 1]} <Badge tone={start === 1 ? 'neutral' : 'info'}>{start === 1 ? L.calendarYear : L.offsetYear}</Badge></dd></div>
        <div><dt>{fmt(L.fiscalYear, { y })}</dt><dd>{short[first.m - 1]} {first.year} – {short[last.m - 1]} {last.year}</dd></div>
      </dl>
      <p className="muted">{L.fiscalText}</p>
      <div className="sec-months" role="list">
        {months.map((x) => (
          <div key={x.idx} role="listitem" className={x.idx === 1 ? 'is-start' : ''}>
            <b>{short[x.m - 1]}</b>
            <span className="muted">{x.year}</span>
          </div>
        ))}
      </div>
      {start !== 1 && <Alert kind="warning">{L.periodNote}</Alert>}
      <p className="hint small">{L.fiscalChange} {can('company.manage') && <Link to="/admin/company">{L.goCompany} →</Link>}</p>
    </Card>
  );
}
