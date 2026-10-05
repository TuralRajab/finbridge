import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  MONTH_NAMES, REQUEST_TYPES,
  type BudgetCheckDto, type CurrencyDto, type ExchangeRateDto, type PurchaseRequestDto, type RequestType, type WorkflowPreviewDto,
} from '@finbridge/shared';
import { ApiError, api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner, Tabs, isErrorCode } from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { money, parseAmount } from '../../lib/format';
import { useMasterData, useDisplayName, usableAccounts } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import { useYear } from '../../lib/useYear';
import { AttachmentsCard, FundsCheckView, requestableCostCenters } from './requestShared';
import '../../styles/spend.css';

const az = {
  newPurchase: 'Yeni satınalma sorğusu',
  newExpense: 'Yeni xərc sorğusu',
  edit: 'Sorğunun redaktəsi',
  eyebrow: 'Satınalma və xərc sorğuları',
  subtitle: 'Sorğunu doldurun — büdcə qalığı daxil etdikcə yoxlanılır. Qaralama kimi saxlaya və ya dərhal təsdiqə göndərə bilərsiniz.',
  details: 'Sorğunun məlumatları',
  titleLabel: 'Mövzu',
  titlePh: 'Məs.: Ofis üçün 10 noutbukun alınması',
  descLabel: 'Əsaslandırma',
  descPh: 'Nə üçün lazımdır, kim istifadə edəcək, alternativlər…',
  vendor: 'Təchizatçı',
  payee: 'Alıcı / təchizatçı',
  vendorPh: 'Şirkət adı',
  allocation: 'Büdcə bölgüsü',
  ccHint: 'Yalnız sorğu yaratmağa icazəniz olan xərc mərkəzləri göstərilir.',
  noCc: 'Sizin üçün sorğu yaradıla bilən xərc mərkəzi yoxdur. Administratorla əlaqə saxlayın.',
  accountHint: 'Seçilmiş xərc mərkəzi üçün sorğuya icazə verilən hesablar.',
  noAccounts: 'Bu xərc mərkəzi üçün sorğu açıla bilən hesab yoxdur.',
  fiscalYear: 'Maliyyə ili',
  month: 'Xərc ayı',
  monthHint: 'Xərcin büdcədə əks olunacağı ay.',
  money: 'Məbləğ',
  rate: 'Məzənnə',
  rateText: '1 {ccy} = {rate} {base}',
  rateMissing: '{ccy} üçün məzənnə daxil edilməyib. Maliyyə ayarlarında məzənnə əlavə edin və ya {base} seçin.',
  baseAmount: 'Baza valyutada: {amount} {base}',
  rateNote: 'Məzənnə təsdiqə göndərilmə anında yenidən hesablanır.',
  funds: 'Büdcə yoxlaması',
  fundsHint: 'Xərc mərkəzi, hesab, ay və məbləği seçdikdə avtomatik hesablanır.',
  checking: 'Yoxlanılır…',
  routing: 'Təsdiq marşrutu (önizləmə)',
  routingNone: 'Bu sorğu üçün aktiv təsdiq axını tapılmadı.',
  routingSkipped: 'şərt ödənmir — keçiləcək',
  routingUnavailable: 'Marşrut önizləməsi əlçatan deyil.',
  saveDraft: 'Qaralama kimi saxla',
  submit: 'Təsdiqə göndər',
  savedDraft: 'Qaralama yadda saxlanıldı.',
  notEditable: 'Bu sorğu artıq redaktə edilə bilməz (status: {status}).',
  openRequest: 'Sorğuya bax',
  errTitle: 'Mövzu ən azı 3 simvol olmalıdır.',
  errCc: 'Xərc mərkəzini seçin.',
  errAccount: 'Hesabı seçin.',
  errAmount: 'Müsbət məbləğ daxil edin.',
  overBudget: 'Sorğu göndərilmədi: məbləğ mövcud büdcə qalığını aşır ({available} {ccy}) və şirkət ayarları büdcəni aşan sorğuları qəbul etmir. Sorğu qaralama kimi saxlanılıb.',
  forbiddenCc: 'Seçilmiş xərc mərkəzi üzrə sorğu yaratmağa icazəniz yoxdur.',
};
const TEXT = {
  az,
  en: {
    newPurchase: 'New purchase request',
    newExpense: 'New expense request',
    edit: 'Edit request',
    eyebrow: 'Purchase & expense requests',
    subtitle: 'Fill in the request — funds are checked as you type. Save as a draft or submit for approval straight away.',
    details: 'Request details',
    titleLabel: 'Subject',
    titlePh: 'E.g. Purchase of 10 laptops for the office',
    descLabel: 'Justification',
    descPh: 'Why it is needed, who will use it, alternatives considered…',
    vendor: 'Vendor',
    payee: 'Payee / vendor',
    vendorPh: 'Company name',
    allocation: 'Budget allocation',
    ccHint: 'Only cost centers you may raise requests on are listed.',
    noCc: 'There is no cost center you can raise requests on. Contact your administrator.',
    accountHint: 'Accounts open for requests on the selected cost center.',
    noAccounts: 'No account is open for requests on this cost center.',
    fiscalYear: 'Fiscal year',
    month: 'Expense month',
    monthHint: 'The budget month the spend belongs to.',
    money: 'Amount',
    rate: 'Exchange rate',
    rateText: '1 {ccy} = {rate} {base}',
    rateMissing: 'No exchange rate is set up for {ccy}. Add one under financial settings or choose {base}.',
    baseAmount: 'In base currency: {amount} {base}',
    rateNote: 'The rate is refreshed when the request is submitted.',
    funds: 'Funds check',
    fundsHint: 'Calculated automatically once cost center, account, month and amount are set.',
    checking: 'Checking…',
    routing: 'Approval route (preview)',
    routingNone: 'No active approval workflow matches this request.',
    routingSkipped: 'condition not met — skipped',
    routingUnavailable: 'Route preview is not available.',
    saveDraft: 'Save draft',
    submit: 'Submit for approval',
    savedDraft: 'Draft saved.',
    notEditable: 'This request can no longer be edited (status: {status}).',
    openRequest: 'Open request',
    errTitle: 'The subject must be at least 3 characters.',
    errCc: 'Select a cost center.',
    errAccount: 'Select an account.',
    errAmount: 'Enter a positive amount.',
    overBudget: 'Not submitted: the amount exceeds the available budget ({available} {ccy}) and company settings block over-budget requests. The request was kept as a draft.',
    forbiddenCc: 'You are not allowed to raise requests on the selected cost center.',
  } satisfies typeof az,
};

interface FormState {
  requestType: RequestType;
  title: string;
  description: string;
  vendor: string;
  costCenterId: string;
  accountId: string;
  fiscalYear: string;
  month: string;
  amount: string;
  currency: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

export function RequestFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const { data: existing, error, loading } = useAsync(
    () => (editId ? api<PurchaseRequestDto>('GET', `/requests/${editId}`) : Promise.resolve(null)), [editId],
  );
  if (editId && loading && !existing) return <Spinner />;
  if (editId && error) return <ErrorMessage error={error} />;
  return <RequestForm key={editId ?? 'new'} existing={existing} />;
}

function RequestForm({ existing }: { existing: PurchaseRequestDto | null }) {
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const display = useDisplayName();
  const { years } = useYear();
  const md = useMasterData();
  const refs = useAsync(async () => {
    const [currencies, rates] = await Promise.all([
      api<CurrencyDto[]>('GET', '/company/currencies'),
      api<ExchangeRateDto[]>('GET', '/company/exchange-rates').catch(() => [] as ExchangeRateDto[]),
    ]);
    return { currencies, rates };
  }, []);
  const base = user?.company?.baseCurrency ?? 'AZN';
  const now = new Date();

  const [f, setF] = useState<FormState>(() => existing ? {
    requestType: existing.requestType, title: existing.title, description: existing.description ?? '', vendor: existing.vendor ?? '',
    costCenterId: String(existing.costCenterId), accountId: String(existing.accountId), fiscalYear: String(existing.fiscalYear),
    month: String(existing.month), amount: String(existing.amount), currency: existing.currency,
  } : {
    requestType: params.get('type') === 'EXPENSE' ? 'EXPENSE' : 'PURCHASE', title: '', description: '', vendor: '', costCenterId: '', accountId: '',
    fiscalYear: String(now.getFullYear()), month: String(now.getMonth() + 1), amount: '', currency: base,
  });
  const [savedId, setSavedId] = useState<number | null>(existing?.id ?? null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const costCenters = useMemo(() => {
    if (!md.data) return [];
    const list = requestableCostCenters(user, md.data.costCenters, md.data.units);
    const current = existing && md.data.costCenters.find((c) => c.id === existing.costCenterId);
    if (current && !list.some((c) => c.id === current.id)) list.push(current);
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }, [md.data, user, existing]);
  const cc = costCenters.find((c) => String(c.id) === f.costCenterId);
  const accounts = useMemo(() => (md.data ? usableAccounts(md.data.accounts, cc, 'request').sort((a, b) => a.code.localeCompare(b.code)) : []), [md.data, cc]);

  // Drop an account that is not allowed on the newly chosen cost center.
  useEffect(() => {
    if (md.data && f.accountId && cc && !accounts.some((a) => String(a.id) === f.accountId)) set('accountId', '');
  }, [accounts, cc, f.accountId, md.data]);

  const rate = useMemo(() => {
    if (f.currency === base) return 1;
    const today = new Date().toISOString().slice(0, 10);
    return refs.data?.rates.find((r) => r.currency === f.currency && r.validFrom <= today)?.rate ?? null;
  }, [f.currency, base, refs.data]);
  const currencyOptions = useMemo(() => {
    const withRates = new Set([base, f.currency, ...(refs.data?.rates.map((r) => r.currency) ?? [])]);
    const list = (refs.data?.currencies ?? []).filter((c) => withRates.has(c.code));
    if (!list.length) return [...withRates].map((c) => ({ value: c, label: c }));
    return list.map((c) => ({ value: c.code, label: `${c.code} · ${lang === 'en' ? c.nameEn : c.nameAz}` }));
  }, [refs.data, base, f.currency, lang]);

  const amount = parseAmount(f.amount);
  const amountBase = amount !== null && rate !== null ? Math.round(amount * rate * 100) / 100 : null;
  const errors = {
    title: f.title.trim().length < 3 ? L.errTitle : undefined,
    costCenterId: !f.costCenterId ? L.errCc : undefined,
    accountId: !f.accountId ? L.errAccount : undefined,
    amount: amount === null || amount <= 0 ? L.errAmount : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  /* live funds check + routing preview (debounced) */
  const checkInput = useDebounced(
    f.costCenterId && f.accountId && amount !== null && amount >= 0 && rate !== null
      ? { costCenterId: Number(f.costCenterId), accountId: Number(f.accountId), fiscalYear: Number(f.fiscalYear), month: Number(f.month), amount, currency: f.currency, excludeRequestId: savedId ?? undefined }
      : null,
    400,
  );
  const checkKey = JSON.stringify(checkInput);
  const [check, setCheck] = useState<{ key: string; data: BudgetCheckDto | null; error: unknown }>({ key: '', data: null, error: null });
  useEffect(() => {
    if (!checkInput) { setCheck({ key: '', data: null, error: null }); return; }
    let live = true;
    api<BudgetCheckDto>('POST', '/requests/budget-check', checkInput)
      .then((d) => { if (live) setCheck({ key: checkKey, data: d, error: null }); })
      .catch((e) => { if (live) setCheck({ key: checkKey, data: null, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);
  const checking = !!checkInput && check.key !== checkKey;

  const previewKey = checkInput ? JSON.stringify([f.requestType, checkInput.costCenterId, checkInput.accountId, amountBase]) : '';
  const debouncedPreviewKey = useDebounced(previewKey, 500);
  const [preview, setPreview] = useState<{ data: WorkflowPreviewDto | null; error: unknown }>({ data: null, error: null });
  useEffect(() => {
    if (!debouncedPreviewKey || amountBase === null) { setPreview({ data: null, error: null }); return; }
    let live = true;
    api<WorkflowPreviewDto>('POST', '/workflows/preview', {
      workflowType: f.requestType === 'EXPENSE' ? 'EXPENSE_REQUEST' : 'PURCHASE_REQUEST', amount: amountBase,
      costCenterId: Number(f.costCenterId), accountId: Number(f.accountId), requestType: f.requestType,
    }).then((d) => { if (live) setPreview({ data: d, error: null }); }).catch((e) => { if (live) setPreview({ data: null, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPreviewKey]);

  const persist = async (): Promise<PurchaseRequestDto> => {
    const body = {
      requestType: f.requestType, title: f.title.trim(), description: f.description.trim() || null, vendor: f.vendor.trim() || null,
      costCenterId: Number(f.costCenterId), accountId: Number(f.accountId), fiscalYear: Number(f.fiscalYear), month: Number(f.month),
      amount: amount ?? 0, currency: f.currency,
    };
    const dto = savedId ? await api<PurchaseRequestDto>('PUT', `/requests/${savedId}`, body) : await api<PurchaseRequestDto>('POST', '/requests', body);
    setSavedId(dto.id);
    return dto;
  };

  const run = async (mode: 'draft' | 'submit') => {
    setTouched(true);
    if (!valid) return;
    setBusy(mode); setSaveError(null);
    try {
      const dto = await persist();
      if (mode === 'submit') await api<PurchaseRequestDto>('POST', `/requests/${dto.id}/submit`);
      navigate(`/requests/${dto.id}`);
    } catch (e) { setSaveError(e); } finally { setBusy(null); }
  };

  if (existing && !existing.canEdit) {
    return (
      <>
        <PageHeader eyebrow={L.eyebrow} title={`${existing.number} · ${existing.title}`} />
        <Alert kind="warning">{fmt(L.notEditable, { status: t(`requestStatus.${existing.status}`) })}</Alert>
        <Link className="btn btn-secondary" to={`/requests/${existing.id}`}>{L.openRequest}</Link>
      </>
    );
  }

  const overDetails = isErrorCode(saveError, 'OVER_BUDGET') && saveError instanceof ApiError ? saveError.details as BudgetCheckDto | undefined : undefined;
  const months = MONTH_NAMES[lang].map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOptions = [...new Set([...years, now.getFullYear(), now.getFullYear() + 1, Number(f.fiscalYear)])].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const isPurchase = f.requestType === 'PURCHASE';

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/requests">{L.eyebrow}</Link>}
        title={existing ? `${L.edit} · ${existing.number}` : isPurchase ? L.newPurchase : L.newExpense}
        subtitle={L.subtitle}
      />
      {md.error ? <ErrorMessage error={md.error} /> : null}
      <div className="req-layout">
        <div className="req-main">
          <Card title={L.details}>
            <div className="field">
              <Tabs tabs={REQUEST_TYPES.map((x) => ({ value: x, label: t(`requestType.${x}` as TKey) }))} value={f.requestType} onChange={(v) => set('requestType', v)} />
            </div>
            <Field label={L.titleLabel} error={err('title')}>{(fid) => (
              <Input id={fid} value={f.title} maxLength={200} placeholder={L.titlePh} onChange={(e) => set('title', e.target.value)} />
            )}</Field>
            <Field label={<>{L.descLabel} <span className="muted">({t('common.optional')})</span></>}>{(fid) => (
              <textarea id={fid} className="input textarea" rows={3} maxLength={2000} value={f.description} placeholder={L.descPh} onChange={(e) => set('description', e.target.value)} />
            )}</Field>
            <Field label={<>{isPurchase ? L.vendor : L.payee} <span className="muted">({t('common.optional')})</span></>}>{(fid) => (
              <Input id={fid} value={f.vendor} maxLength={200} placeholder={L.vendorPh} onChange={(e) => set('vendor', e.target.value)} />
            )}</Field>
          </Card>

          <Card title={L.allocation}>
            {md.loading && !md.data ? <Spinner /> : (
              <>
                {costCenters.length === 0 && <Alert kind="warning">{L.noCc}</Alert>}
                <div className="grid-2">
                  <Field label={t('common.costCenter')} hint={L.ccHint} error={err('costCenterId')}>{(fid) => (
                    <Select id={fid} value={f.costCenterId} onChange={(e) => set('costCenterId', e.target.value)}
                      options={[{ value: '', label: t('common.select') }, ...costCenters.map((c) => ({ value: String(c.id), label: `${c.code} · ${c.name}` }))]} />
                  )}</Field>
                  <Field label={t('common.account')} hint={cc && !accounts.length ? L.noAccounts : L.accountHint} error={err('accountId')}>{(fid) => (
                    <Select id={fid} value={f.accountId} disabled={!cc} onChange={(e) => set('accountId', e.target.value)}
                      options={[{ value: '', label: t('common.select') }, ...accounts.map((a) => ({ value: String(a.id), label: `${a.code} · ${display(a)}` }))]} />
                  )}</Field>
                  <Field label={L.fiscalYear}>{(fid) => <Select id={fid} value={f.fiscalYear} onChange={(e) => set('fiscalYear', e.target.value)} options={yearOptions} />}</Field>
                  <Field label={L.month} hint={L.monthHint}>{(fid) => <Select id={fid} value={f.month} onChange={(e) => set('month', e.target.value)} options={months} />}</Field>
                </div>
                <div className="grid-2">
                  <Field label={L.money} error={err('amount')}>{(fid) => (
                    <Input id={fid} inputMode="decimal" className="r num" value={f.amount} placeholder="0,00" onChange={(e) => set('amount', e.target.value)} />
                  )}</Field>
                  <Field label={t('common.currency')}>{(fid) => <Select id={fid} value={f.currency} onChange={(e) => set('currency', e.target.value)} options={currencyOptions} />}</Field>
                </div>
                {f.currency !== base && (
                  rate === null
                    ? <Alert kind="warning">{fmt(L.rateMissing, { ccy: f.currency, base })}</Alert>
                    : <p className="small muted">
                        {L.rate}: {fmt(L.rateText, { ccy: f.currency, rate: money(rate, locale, 4), base })}
                        {amountBase !== null && <> · <b>{fmt(L.baseAmount, { amount: money(amountBase, locale, 2), base })}</b></>}
                        <br />{L.rateNote}
                      </p>
                )}
              </>
            )}
          </Card>

          <AttachmentsCard requestId={savedId} />
        </div>

        <aside className="req-side">
          <Card title={L.funds} subtitle={!check.data && !checking ? L.fundsHint : undefined} actions={checking ? <span className="small muted"><span className="spinner-sm" aria-hidden="true" /> {L.checking}</span> : undefined}>
            <div aria-live="polite">
              {check.error ? (
                isErrorCode(check.error, 'FORBIDDEN') ? <Alert kind="error">{L.forbiddenCc}</Alert> : <ErrorMessage error={check.error} />
              ) : check.data ? <FundsCheckView check={check.data} /> : null}
            </div>
          </Card>

          {preview.data || preview.error ? (
            <Card title={L.routing}>
              {preview.error ? <p className="muted small">{L.routingUnavailable}</p> : preview.data && (
                !preview.data.definition ? <Alert kind="warning">{L.routingNone}</Alert> : (
                  <>
                    <p className="small muted mb-8">{preview.data.definition.name}</p>
                    <ol className="route-list">
                      {preview.data.steps.map((s) => (
                        <li key={s.seq} className={s.included ? '' : 'is-skipped'}>
                          <span className="route-seq" aria-hidden="true">{s.seq}</span>
                          <div>
                            <b>{s.name}</b> <span className="muted small">{t(`approverType.${s.approverType}` as TKey)}</span>
                            <div className="small">{s.included ? (s.approvers.join(', ') || '—') : <span className="muted">{L.routingSkipped}</span>}</div>
                            {s.note && <div className="small muted">{s.note}</div>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                )
              )}
            </Card>
          ) : null}
        </aside>
      </div>

      <div className="form-actions">
        {overDetails || isErrorCode(saveError, 'OVER_BUDGET') ? (
          <Alert kind="error">{fmt(L.overBudget, { available: money(overDetails?.available ?? 0, locale, 2), ccy: overDetails?.currency ?? base })}</Alert>
        ) : <ErrorMessage error={saveError} />}
        <div className="row-actions">
          <Link className="btn btn-ghost" to={savedId ? `/requests/${savedId}` : '/requests'}>{t('common.cancel')}</Link>
          <Button busy={busy === 'draft'} disabled={!!busy} onClick={() => void run('draft')}>{L.saveDraft}</Button>
          <Button variant="primary" busy={busy === 'submit'} disabled={!!busy || (touched && !valid)} onClick={() => void run('submit')}>
            <Icon name="check" /> {L.submit}
          </Button>
        </div>
      </div>
    </>
  );
}
