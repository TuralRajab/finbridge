import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MONTH_SHORT, type ChangeRequestDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { ActionDialog, Alert, Button, Card, Empty, ErrorMessage, Icon, Modal, PageHeader, RequestStatusBadge, Spinner } from '../../components/ui';
import { WorkflowPanel } from '../../components/WorkflowPanel';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Delta, DetailedError, sum } from '../budgets/budgetUi';
import '../../styles/budgets.css';

const az = {
  crumbs: 'Büdcə dəyişiklikləri',
  budget: 'Büdcə',
  budgetValue: '{year} · v{n}',
  costCenter: 'Xərc mərkəzi',
  requester: 'Sorğu edən',
  created: 'Yaradılıb',
  submitted: 'Göndərilib',
  decided: 'Qərar tarixi',
  reason: 'Əsaslandırma',
  items: 'Dəyişiklik bəndləri',
  account: 'Hesab',
  month: 'Ay',
  current: 'Təsdiqlənmiş',
  requested: 'Tələb olunan',
  delta: 'Fərq',
  totals: 'Cəmi',
  increase: 'Artım',
  decrease: 'Azalma',
  net: 'Xalis dəyişiklik',
  byAccount: 'Hesab üzrə cəm',
  byMonth: 'Ay üzrə',
  noItems: 'Bənd yoxdur.',
  edit: 'Redaktə et',
  submit: 'Təsdiqə göndər',
  submitTitle: 'Sorğunu təsdiqə göndər',
  submitHint: 'Sorğu konfiqurasiya olunmuş büdcə dəyişikliyi təsdiq axınına göndəriləcək.',
  withdraw: 'Geri çək',
  cancelDraft: 'Sorğunu ləğv et',
  withdrawHint: 'Sorğu təsdiq prosesindən geri çəkilir və bağlanır.',
  cancelHint: 'Qaralama ləğv ediləcək və bağlanacaq.',
  resultTitle: 'Yeni büdcə versiyası yaradıldı',
  resultText: 'Təsdiqdən sonra dəyişikliklər v{n} versiyasına tətbiq edildi və o, qüvvədə olan büdcədir.',
  openResult: 'v{n} versiyasını aç',
  compare: 'Versiyaları müqayisə et',
  preserved: 'Orijinal v{n} versiyası dəyişməz saxlanılır və tarixçədə əlçatandır.',
  baseNote: 'Sorğu kilidlənmiş v{n} versiyasına əsaslanır. Təsdiqləndikdə yeni versiya yaradılacaq; v{n} dəyişməyəcək.',
  openBase: 'v{n} versiyasına bax',
  close: 'Bağla',
};
const TEXT = {
  az,
  en: {
    crumbs: 'Budget changes',
    budget: 'Budget',
    budgetValue: '{year} · v{n}',
    costCenter: 'Cost center',
    requester: 'Requested by',
    created: 'Created',
    submitted: 'Submitted',
    decided: 'Decided',
    reason: 'Justification',
    items: 'Change items',
    account: 'Account',
    month: 'Month',
    current: 'Approved',
    requested: 'Requested',
    delta: 'Difference',
    totals: 'Total',
    increase: 'Increase',
    decrease: 'Decrease',
    net: 'Net change',
    byAccount: 'Totals per account',
    byMonth: 'By month',
    noItems: 'No items.',
    edit: 'Edit',
    submit: 'Submit for approval',
    submitTitle: 'Submit the request',
    submitHint: 'The request goes into the configured budget change approval workflow.',
    withdraw: 'Withdraw',
    cancelDraft: 'Cancel request',
    withdrawHint: 'The request is withdrawn from approval and closed.',
    cancelHint: 'The draft will be cancelled and closed.',
    resultTitle: 'New budget version created',
    resultText: 'After approval the changes were applied in version v{n}, which is now the budget in force.',
    openResult: 'Open version v{n}',
    compare: 'Compare versions',
    preserved: 'The original version v{n} is preserved unchanged and remains available in the history.',
    baseNote: 'The request is based on locked version v{n}. On approval a new version will be created; v{n} will not change.',
    openBase: 'View version v{n}',
    close: 'Close',
  } satisfies typeof az,
};

export function ChangeDetailPage() {
  const { id } = useParams();
  const crId = Number(id);
  const L = useLocal(TEXT);
  const { lang, locale } = useI18n();
  const navigate = useNavigate();
  const { data: cr, setData, error, loading, reload } = useAsync(() => api<ChangeRequestDto>('GET', `/changes/${crId}`), [crId]);
  const [dialog, setDialog] = useState<'submit' | 'cancel' | null>(null);
  const [view, setView] = useState<'month' | 'account'>('month');
  const [actionError, setActionError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const byAccount = useMemo(() => {
    const m = new Map<number, { code: string; name: string; current: number; requested: number; difference: number; months: number[] }>();
    for (const i of cr?.items ?? []) {
      const r = m.get(i.accountId) ?? { code: i.accountCode, name: i.accountName, current: 0, requested: 0, difference: 0, months: [] };
      r.current += i.currentAmount; r.requested += i.requestedAmount; r.difference += i.difference; r.months.push(i.month);
      m.set(i.accountId, r);
    }
    return [...m.entries()];
  }, [cr]);

  if (loading && !cr) return <Spinner />;
  if (error || !cr) return <ErrorMessage error={error} />;

  const up = sum(cr.items.filter((i) => i.difference > 0).map((i) => i.difference));
  const down = sum(cr.items.filter((i) => i.difference < 0).map((i) => i.difference));
  const months = MONTH_SHORT[lang];
  const inApproval = cr.status === 'IN_APPROVAL';

  const cancel = async (comment: string) => {
    setData(await api<ChangeRequestDto>('POST', `/changes/${cr.id}/cancel`, { comment: comment || null }));
  };
  const submit = async () => {
    setSubmitting(true); setActionError(null);
    try { setData(await api<ChangeRequestDto>('POST', `/changes/${cr.id}/submit`)); setDialog(null); } catch (e) { setActionError(e); } finally { setSubmitting(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/changes">← {L.crumbs}</Link>}
        title={<>{cr.number} <RequestStatusBadge status={cr.status} /></>}
        subtitle={cr.title}
        actions={<>
          {cr.canEdit && <Button onClick={() => navigate(`/changes/${cr.id}/edit`)}><Icon name="settings" /> {L.edit}</Button>}
          {cr.canCancel && <Button variant="danger" onClick={() => setDialog('cancel')}>{inApproval ? L.withdraw : L.cancelDraft}</Button>}
          {cr.canSubmit && <Button variant="primary" onClick={() => setDialog('submit')}><Icon name="check" /> {L.submit}</Button>}
        </>}
      />

      {cr.resultVersionId && cr.resultVersionNo ? (
        <Alert kind="success">
          <b>{L.resultTitle}.</b> {fmt(L.resultText, { n: cr.resultVersionNo })} {fmt(L.preserved, { n: cr.baseVersionNo })}
          <div className="banner-links">
            <Link to={`/budgets/${cr.budgetId}?versionId=${cr.resultVersionId}`}>{fmt(L.openResult, { n: cr.resultVersionNo })}</Link>
            <Link to={`/budgets/${cr.budgetId}?versionId=${cr.baseVersionId}`}>{fmt(L.openBase, { n: cr.baseVersionNo })}</Link>
          </div>
        </Alert>
      ) : (
        <Alert kind="info">
          <Icon name="lock" /> {fmt(L.baseNote, { n: cr.baseVersionNo })}{' '}
          <Link to={`/budgets/${cr.budgetId}?versionId=${cr.baseVersionId}`}>{fmt(L.openBase, { n: cr.baseVersionNo })}</Link>
        </Alert>
      )}

      <div className="change-layout">
        <div>
          <Card>
            <dl className="facts">
              <div><dt>{L.budget}</dt><dd><Link to={`/budgets/${cr.budgetId}`}>{fmt(L.budgetValue, { year: cr.fiscalYear, n: cr.baseVersionNo })}</Link></dd></div>
              <div><dt>{L.costCenter}</dt><dd>{cr.costCenterCode} · {cr.costCenterName}</dd></div>
              <div><dt>{L.requester}</dt><dd>{cr.requestedBy}</dd></div>
              <div><dt>{L.created}</dt><dd>{date(cr.createdAt, locale, true)}</dd></div>
              <div><dt>{L.submitted}</dt><dd>{date(cr.submittedAt, locale, true)}</dd></div>
              <div><dt>{L.decided}</dt><dd>{date(cr.decidedAt, locale, true)}</dd></div>
            </dl>
            <h3 className="h3">{L.reason}</h3>
            <p className="reason-text">{cr.reason}</p>
          </Card>

          <Card>
            <dl className="facts change-summary">
              <div><dt>{L.current}</dt><dd className="num">{money(cr.totalCurrent, locale)}</dd></div>
              <div><dt>{L.requested}</dt><dd className="num">{money(cr.totalRequested, locale)}</dd></div>
              <div><dt>{L.increase} / {L.decrease}</dt><dd><Delta value={up} /> · <Delta value={down} /></dd></div>
              <div><dt>{L.net}</dt><dd><Delta value={cr.totalDifference} strong /></dd></div>
            </dl>
          </Card>

          <Card flush title={L.items} actions={
            <div className="seg" role="group" aria-label={L.items}>
              <button type="button" className={view === 'month' ? 'is-active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>{L.byMonth}</button>
              <button type="button" className={view === 'account' ? 'is-active' : ''} aria-pressed={view === 'account'} onClick={() => setView('account')}>{L.byAccount}</button>
            </div>
          }>
            {cr.items.length === 0 ? <Empty>{L.noItems}</Empty> : (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr>
                    <th>{L.account}</th><th>{L.month}</th>
                    <th className="r">{L.current}</th><th className="r">{L.requested}</th><th className="r">{L.delta}</th>
                  </tr></thead>
                  <tbody>
                    {view === 'month' ? cr.items.map((i) => (
                      <tr key={i.id}>
                        <td><span className="acc-code">{i.accountCode}</span> {i.accountName}</td>
                        <td>{months[i.month - 1]}</td>
                        <td className="r num">{money(i.currentAmount, locale)}</td>
                        <td className="r num"><b>{money(i.requestedAmount, locale)}</b></td>
                        <td className="r num"><Delta value={i.difference} /></td>
                      </tr>
                    )) : byAccount.map(([accId, r]) => (
                      <tr key={accId}>
                        <td><span className="acc-code">{r.code}</span> {r.name}</td>
                        <td className="small">{r.months.map((m) => months[m - 1]).join(', ')}</td>
                        <td className="r num">{money(r.current, locale)}</td>
                        <td className="r num"><b>{money(r.requested, locale)}</b></td>
                        <td className="r num"><Delta value={r.difference} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={2}><b>{L.totals}</b></td>
                    <td className="r num"><b>{money(cr.totalCurrent, locale)}</b></td>
                    <td className="r num"><b>{money(cr.totalRequested, locale)}</b></td>
                    <td className="r num"><Delta value={cr.totalDifference} strong /></td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div>
          <WorkflowPanel key={cr.status} instanceId={cr.workflowInstanceId} onChanged={() => void reload()} />
        </div>
      </div>

      {dialog === 'cancel' && (
        <ActionDialog
          title={inApproval ? L.withdraw : L.cancelDraft}
          hint={inApproval ? L.withdrawHint : L.cancelHint}
          danger
          confirmLabel={inApproval ? L.withdraw : L.cancelDraft}
          onConfirm={cancel}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'submit' && (
        <Modal title={L.submitTitle} onClose={() => setDialog(null)} footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>{L.close}</Button>
          <Button variant="primary" busy={submitting} onClick={submit}><Icon name="check" /> {L.submit}</Button>
        </>}>
          <p>{L.submitHint}</p>
          <p className="small muted">{fmt(L.baseNote, { n: cr.baseVersionNo })}</p>
          <DetailedError error={actionError} />
        </Modal>
      )}
    </>
  );
}
