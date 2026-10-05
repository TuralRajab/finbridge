import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MONTH_NAMES, type BudgetCheckDto, type PurchaseRequestDto, type TransactionDto } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { WorkflowPanel } from '../../components/WorkflowPanel';
import {
  ActionDialog, Alert, Badge, BudgetCheckBadge, Button, Card, ConsumptionBar, ErrorMessage, Field, Icon, Input, Modal, PageHeader,
  RequestStatusBadge, Select, Spinner,
} from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date, money, parseAmount } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { AttachmentsCard, FundsCheckView } from './requestShared';
import '../../styles/spend.css';

const az = {
  eyebrow: 'Satınalma və xərc sorğuları',
  facts: 'Sorğunun məlumatları',
  vendor: 'Təchizatçı / alıcı',
  period: 'Büdcə dövrü',
  amount: 'Məbləğ',
  rate: 'Məzənnə',
  base: 'Baza valyutada',
  requester: 'Sorğu edən',
  created: 'Yaradılıb',
  submitted: 'Təsdiqə göndərilib',
  decided: 'Qərar verilib',
  description: 'Əsaslandırma',
  snapshot: 'Göndərilmə anında büdcə yoxlaması',
  snapshotNone: 'Sorğu hələ təsdiqə göndərilməyib — büdcə yoxlaması göndərilmə anında qeydə alınacaq.',
  availableAtSubmit: 'Göndərilmə anında qalıq',
  requested: 'Sorğu məbləği',
  availableAfter: 'Sorğudan sonra qalıq',
  current: 'Cari vəziyyət (bu sorğu xaric)',
  spend: 'Faktiki xərc və öhdəlik',
  spent: 'Qeydə alınmış fakt',
  remaining: 'Qalan öhdəlik',
  noSpend: 'Bu sorğu üzrə hələ faktiki xərc (qaimə) qeydə alınmayıb.',
  closedNote: 'Sorğu bağlanıb — qalan öhdəlik büdcəyə qaytarılıb.',
  linked: 'Əlaqəli faktiki xərclər',
  record: 'Fakt / qaimə qeyd et',
  recordTitle: 'Faktiki xərcin qeydə alınması',
  recordHint: 'Məbləğ baza valyutada ({base}) daxil edilir və sorğunun xərc mərkəzi və hesabı üzrə fakt kimi yazılır. Tam xərclənmiş sorğu avtomatik bağlanır.',
  recordAmount: 'Məbləğ ({base})',
  recordMonth: 'Faktın ayı',
  recordDesc: 'Qaimə / təsvir',
  recordDescPh: 'Məs.: Qaimə № 1234',
  close: 'Sorğunu bağla (qalan öhdəliyi büdcəyə qaytar)',
  closeHint: 'Daha faktiki xərc gözlənilmirsə seçin.',
  saveActual: 'Qeyd et',
  errAmount: 'Düzgün məbləğ daxil edin.',
  edit: 'Redaktə et',
  submit: 'Təsdiqə göndər',
  withdraw: 'Geri çək',
  withdrawTitle: 'Sorğu geri çəkilsin?',
  withdrawHint: 'Sorğu ləğv ediləcək və büdcədən ayrılmış məbləğ azad olunacaq.',
  overBudget: 'Sorğu göndərilmədi: məbləğ mövcud büdcə qalığını aşır ({available} {ccy}) və şirkət ayarları büdcəni aşan sorğuları qəbul etmir.',
  ref: 'Sənəd',
};
const TEXT = {
  az,
  en: {
    eyebrow: 'Purchase & expense requests',
    facts: 'Request details',
    vendor: 'Vendor / payee',
    period: 'Budget period',
    amount: 'Amount',
    rate: 'Exchange rate',
    base: 'In base currency',
    requester: 'Requester',
    created: 'Created',
    submitted: 'Submitted',
    decided: 'Decided',
    description: 'Justification',
    snapshot: 'Funds check at submission',
    snapshotNone: 'Not submitted yet — the funds check is recorded at submission.',
    availableAtSubmit: 'Available at submission',
    requested: 'Requested',
    availableAfter: 'Available after request',
    current: 'Current position (excluding this request)',
    spend: 'Actuals & commitment',
    spent: 'Actuals recorded',
    remaining: 'Remaining commitment',
    noSpend: 'No actual spend (invoice) has been recorded against this request yet.',
    closedNote: 'The request is closed — the remaining commitment was released to the budget.',
    linked: 'Linked actuals',
    record: 'Record actual / invoice',
    recordTitle: 'Record actual spend',
    recordHint: 'The amount is entered in base currency ({base}) and booked as an actual on the request’s cost center and account. Fully spent requests close automatically.',
    recordAmount: 'Amount ({base})',
    recordMonth: 'Actual month',
    recordDesc: 'Invoice / description',
    recordDescPh: 'E.g. Invoice no. 1234',
    close: 'Close the request (release the remaining commitment)',
    closeHint: 'Tick when no further spend is expected.',
    saveActual: 'Record',
    errAmount: 'Enter a valid amount.',
    edit: 'Edit',
    submit: 'Submit for approval',
    withdraw: 'Withdraw',
    withdrawTitle: 'Withdraw the request?',
    withdrawHint: 'The request will be cancelled and any reserved amount released.',
    overBudget: 'Not submitted: the amount exceeds the available budget ({available} {ccy}) and company settings block over-budget requests.',
    ref: 'Reference',
  } satisfies typeof az,
};

export function RequestDetailPage() {
  const { id } = useParams();
  const { t, locale, lang } = useI18n();
  const L = useLocal(TEXT);
  const { user, can } = useAuth();
  const base = user?.company?.baseCurrency ?? 'AZN';
  const { data: pr, error, loading, reload, setData } = useAsync(() => api<PurchaseRequestDto>('GET', `/requests/${id}`), [id]);
  const [dialog, setDialog] = useState<'withdraw' | 'actual' | null>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<unknown>(null);

  // Current funds position for approvers / requesters (only for users who may raise requests on the cost center).
  const current = useAsync(async () => {
    if (!pr || !can('request.create') || !['DRAFT', 'RETURNED', 'IN_APPROVAL'].includes(pr.status)) return null;
    try {
      return await api<BudgetCheckDto>('POST', '/requests/budget-check', {
        costCenterId: pr.costCenterId, accountId: pr.accountId, fiscalYear: pr.fiscalYear, month: pr.month,
        amount: pr.amount, currency: pr.currency, excludeRequestId: pr.id,
      });
    } catch { return null; }
  }, [pr?.id, pr?.status, pr?.amount]);

  const linked = useAsync(async () => {
    if (!pr || !can('reports.view') || pr.actualBase <= 0) return [] as TransactionDto[];
    const tx = await api<TransactionDto[]>('GET', `/reports/transactions${qs({ year: pr.fiscalYear, costCenterId: pr.costCenterId, accountId: pr.accountId })}`);
    return tx.filter((x) => x.kind === 'ACTUAL' && x.link === `/requests/${pr.id}`);
  }, [pr?.id, pr?.actualBase]);

  if (loading && !pr) return <Spinner />;
  if (error || !pr) return <ErrorMessage error={error} />;

  const reloadAll = () => { void reload(); };
  const submit = async () => {
    setBusy(true); setOpError(null);
    try { setData(await api<PurchaseRequestDto>('POST', `/requests/${pr.id}/submit`)); } catch (e) { setOpError(e); } finally { setBusy(false); }
  };
  const remaining = pr.status === 'APPROVED' ? Math.max(0, Math.round((pr.amountBase - pr.actualBase) * 100) / 100) : 0;
  const editableStatus = pr.status === 'DRAFT' || pr.status === 'RETURNED';
  const overErr = opError && (opError as { code?: string }).code === 'OVER_BUDGET' ? (opError as { details?: BudgetCheckDto }).details : undefined;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/requests">{L.eyebrow}</Link>}
        title={<>{pr.number} · {pr.title}</>}
        subtitle={<span className="req-head-badges">
          <Badge tone={pr.requestType === 'PURCHASE' ? 'info' : 'neutral'}>{t(`requestType.${pr.requestType}` as TKey)}</Badge>
          <RequestStatusBadge status={pr.status} />
          <BudgetCheckBadge state={pr.budgetState} />
        </span>}
        actions={<>
          {pr.canEdit && <Link className="btn btn-secondary" to={`/requests/${pr.id}/edit`}><Icon name="request" /> {L.edit}</Link>}
          {pr.canCancel && editableStatus && <Button variant="danger" onClick={() => setDialog('withdraw')}>{L.withdraw}</Button>}
          {pr.canSubmit && <Button variant="primary" busy={busy} onClick={() => void submit()}><Icon name="check" /> {L.submit}</Button>}
          {pr.canRecordActual && <Button variant="primary" onClick={() => setDialog('actual')}><Icon name="actuals" /> {L.record}</Button>}
        </>}
      />
      {overErr ? <Alert kind="error">{fmt(L.overBudget, { available: money(overErr.available, locale, 2), ccy: overErr.currency })}</Alert> : <ErrorMessage error={opError} />}

      <div className="req-layout">
        <div className="req-main">
          <Card title={L.facts}>
            <dl className="facts req-facts">
              <div><dt>{t('common.costCenter')}</dt><dd>{pr.costCenterCode} · {pr.costCenterName}</dd></div>
              <div><dt>{t('common.account')}</dt><dd>{pr.accountCode} · {pr.accountName}</dd></div>
              <div><dt>{L.period}</dt><dd>{MONTH_NAMES[lang][pr.month - 1]} {pr.fiscalYear}</dd></div>
              <div><dt>{L.vendor}</dt><dd>{pr.vendor ?? '—'}</dd></div>
              <div><dt>{L.amount}</dt><dd className="num">{money(pr.amount, locale, 2)} {pr.currency}</dd></div>
              <div>
                <dt>{L.base}</dt>
                <dd className="num">{money(pr.amountBase, locale, 2)} {base}</dd>
                {pr.currency !== base && <small className="muted">{L.rate}: 1 {pr.currency} = {money(pr.exchangeRate, locale, 4)} {base}</small>}
              </div>
              <div><dt>{L.requester}</dt><dd>{pr.requestedBy}</dd></div>
              <div><dt>{L.created}</dt><dd>{date(pr.createdAt, locale, true)}</dd></div>
              <div><dt>{L.submitted}</dt><dd>{date(pr.submittedAt, locale, true)}</dd></div>
              <div><dt>{L.decided}</dt><dd>{date(pr.decidedAt, locale, true)}</dd></div>
            </dl>
            {pr.description && <><div className="h3">{L.description}</div><p className="req-desc">{pr.description}</p></>}
          </Card>

          {(pr.status === 'APPROVED' || pr.status === 'CLOSED' || pr.actualBase > 0) && (
            <Card title={L.spend} actions={pr.canRecordActual && <Button size="sm" onClick={() => setDialog('actual')}><Icon name="plus" /> {L.record}</Button>}>
              <dl className="facts">
                <div><dt>{L.base}</dt><dd className="num">{money(pr.amountBase, locale, 2)} {base}</dd></div>
                <div><dt>{L.spent}</dt><dd className="num">{money(pr.actualBase, locale, 2)} {base}</dd></div>
                <div><dt>{L.remaining}</dt><dd className="num">{money(remaining, locale, 2)} {base}</dd></div>
                <div><dt>{t('common.consumption')}</dt><dd><ConsumptionBar actual={pr.actualBase} committed={remaining} budget={pr.amountBase} /></dd></div>
              </dl>
              {pr.status === 'CLOSED' && <p className="small muted">{L.closedNote}</p>}
              {pr.actualBase <= 0 ? <p className="muted small">{L.noSpend}</p> : linked.data && linked.data.length > 0 && (
                <>
                  <div className="h3">{L.linked}</div>
                  <div className="table-scroll">
                    <table className="table">
                      <thead><tr><th>{t('common.date')}</th><th>{t('common.month')}</th><th>{t('common.description')}</th><th className="r">{t('common.amount')}</th></tr></thead>
                      <tbody>
                        {linked.data.map((x) => (
                          <tr key={x.id}>
                            <td className="nowrap">{date(x.date, locale)}</td>
                            <td>{MONTH_NAMES[lang][x.month - 1]}</td>
                            <td>{x.description || '—'}</td>
                            <td className="r num">{money(x.amount, locale, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          )}

          <AttachmentsCard requestId={pr.id} canUpload={pr.status !== 'CANCELLED'} />
        </div>

        <aside className="req-side">
          <Card title={L.snapshot}>
            {pr.availableAtSubmit === null ? <p className="muted small">{L.snapshotNone}</p> : (
              <>
                <div className="fc-head"><BudgetCheckBadge state={pr.budgetState} /></div>
                <dl className="fc-grid">
                  <div><dt>{L.availableAtSubmit}</dt><dd className="num">{money(pr.availableAtSubmit, locale, 2)} {base}</dd></div>
                  <div><dt>{L.requested}</dt><dd className="num">{money(pr.amountBase, locale, 2)} {base}</dd></div>
                  <div className={pr.availableAtSubmit - pr.amountBase < 0 ? 'fc-neg' : ''}>
                    <dt>{L.availableAfter}</dt><dd className="num">{money(pr.availableAtSubmit - pr.amountBase, locale, 2)} {base}</dd>
                  </div>
                  <div><dt>{L.submitted}</dt><dd>{date(pr.submittedAt, locale, true)}</dd></div>
                </dl>
              </>
            )}
          </Card>
          {current.data && (
            <Card title={L.current}><FundsCheckView check={current.data} compact /></Card>
          )}
          <WorkflowPanel instanceId={pr.workflowInstanceId} onChanged={reloadAll} />
        </aside>
      </div>

      {dialog === 'withdraw' && (
        <ActionDialog title={L.withdrawTitle} hint={L.withdrawHint} confirmLabel={L.withdraw} danger onClose={() => setDialog(null)}
          onConfirm={async (comment) => { setData(await api<PurchaseRequestDto>('POST', `/requests/${pr.id}/cancel`, { comment: comment || null })); }} />
      )}
      {dialog === 'actual' && (
        <RecordActualDialog pr={pr} base={base} remaining={remaining} onClose={() => setDialog(null)}
          onDone={(dto) => { setData(dto); setDialog(null); void linked.reload(); }} />
      )}
    </>
  );
}

function RecordActualDialog({ pr, base, remaining, onClose, onDone }: {
  pr: PurchaseRequestDto; base: string; remaining: number; onClose: () => void; onDone: (dto: PurchaseRequestDto) => void;
}) {
  const { t, lang } = useI18n();
  const L = useLocal(TEXT);
  const [amount, setAmount] = useState(remaining ? String(remaining) : '');
  const [month, setMonth] = useState(String(pr.month));
  const [description, setDescription] = useState('');
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const n = parseAmount(amount);
  const invalid = n === null || n < 0 || (n === 0 && !close);

  const save = async () => {
    if (invalid) return;
    setBusy(true); setError(null);
    try {
      onDone(await api<PurchaseRequestDto>('POST', `/requests/${pr.id}/actuals`, { amount: n, month: Number(month), description: description.trim() || null, close }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={L.recordTitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={invalid} onClick={() => void save()}>{L.saveActual}</Button>
    </>}>
      <p className="muted">{fmt(L.recordHint, { base })}</p>
      <div className="grid-2">
        <Field label={fmt(L.recordAmount, { base })} error={amount && n === null ? L.errAmount : undefined}>{(id) => (
          <Input id={id} inputMode="decimal" className="r num" value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}</Field>
        <Field label={L.recordMonth}>{(id) => (
          <Select id={id} value={month} onChange={(e) => setMonth(e.target.value)} options={MONTH_NAMES[lang].map((m, i) => ({ value: String(i + 1), label: `${m} ${pr.fiscalYear}` }))} />
        )}</Field>
      </div>
      <Field label={<>{L.recordDesc} <span className="muted">({t('common.optional')})</span></>}>{(id) => (
        <Input id={id} maxLength={300} value={description} placeholder={L.recordDescPh} onChange={(e) => setDescription(e.target.value)} />
      )}</Field>
      <label className="check"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /> {L.close}</label>
      <small className="hint">{L.closeHint}</small>
      <ErrorMessage error={error} />
    </Modal>
  );
}
