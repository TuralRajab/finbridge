import { useRef, useState } from 'react';
import {
  hasCompanyWideScope,
  type AttachmentDto, type BudgetCheckDto, type CostCenterDto, type MeDto, type OrgUnitDto,
} from '@finbridge/shared';
import { api, download, qs, upload } from '../../api/client';
import { BudgetCheckBadge, Button, Card, Empty, ErrorMessage, Icon, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date, money, pct } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

/* ------------------------------------------------------------------ scope */

/**
 * Cost centers the current user may raise requests on — mirrors the server's object scope
 * (server/src/lib/scope.ts). The server stays authoritative; this only narrows the picker.
 */
export function requestableCostCenters(user: MeDto | null, costCenters: CostCenterDto[], units: OrgUnitDto[]): CostCenterDto[] {
  const active = costCenters.filter((c) => c.isActive);
  if (!user) return [];
  if (hasCompanyWideScope(user.role)) return active;
  const children = new Map<number | null, number[]>();
  for (const u of units) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  const subtree = (root: number, into: Set<number>) => {
    into.add(root);
    for (const c of children.get(root) ?? []) subtree(c, into);
  };
  if (user.role === 'EMPLOYEE') {
    const ids = new Set<number>();
    if (user.orgUnitId) subtree(user.orgUnitId, ids);
    return active.filter((c) => ids.has(c.orgUnitId));
  }
  const unitIds = new Set<number>();
  if (user.role === 'DEPARTMENT_MANAGER') for (const u of units) if (u.headUserId === user.id) subtree(u.id, unitIds);
  return active.filter((c) => unitIds.has(c.orgUnitId) || c.ownerUserId === user.id || c.responsibleUserId === user.id);
}

/* ------------------------------------------------------------------ funds check */

const fcAz = {
  budget: 'Büdcə',
  used: 'İstifadə olunub',
  usedHint: 'fakt + öhdəlik',
  usedHintPending: 'fakt + öhdəlik + təsdiqdə olanlar',
  available: 'Mövcud qalıq',
  requested: 'Sorğu məbləği',
  availableAfter: 'Sorğudan sonra qalıq',
  usageAfter: 'Sorğudan sonra istifadə',
  basisANNUAL: 'Hesablama bazası: illik büdcə',
  basisYTD: 'Hesablama bazası: ilin əvvəlindən seçilmiş aya qədər',
  explainWITHIN: 'Sorğu mövcud büdcə qalığı daxilindədir. Təsdiqdən sonra məbləğ öhdəlik kimi qeydə alınacaq.',
  explainNEAR: 'Sorğu qalıq daxilindədir, lakin bu xərc mərkəzi və hesab üzrə büdcənin {pct} hissəsi istifadə olunmuş olacaq.',
  explainOVER: 'Sorğu mövcud qalığı {amount} {ccy} aşır.',
  explainNoBudget: 'Bu xərc mərkəzi və hesab üzrə büdcə nəzərdə tutulmayıb.',
  blocked: 'Şirkət ayarlarına görə büdcəni aşan sorğular təsdiqə göndərilə bilməz. Məbləği azaldın və ya əvvəlcə büdcə dəyişikliyi sorğusu yaradın.',
  allowed: 'Sorğunu göndərmək mümkündür, lakin təsdiqləyənlər büdcənin aşılması barədə xəbərdar ediləcək.',
  versionDraft: 'Diqqət: cari büdcə versiyası hələ təsdiqlənməyib ({status}).',
  breakdown: 'Fakt {a} · öhdəlik {c} · təsdiqdə {p}',
};
const FC_TEXT = {
  az: fcAz,
  en: {
    budget: 'Budget',
    used: 'Already used',
    usedHint: 'actual + committed',
    usedHintPending: 'actual + committed + pending approval',
    available: 'Available',
    requested: 'This request',
    availableAfter: 'Available after request',
    usageAfter: 'Usage after request',
    basisANNUAL: 'Basis: full-year budget',
    basisYTD: 'Basis: year-to-date through the selected month',
    explainWITHIN: 'The request fits within the available budget. Once approved it becomes a commitment.',
    explainNEAR: 'The request fits, but {pct} of the budget for this cost center and account will be used.',
    explainOVER: 'The request exceeds the available budget by {amount} {ccy}.',
    explainNoBudget: 'There is no budget for this cost center and account.',
    blocked: 'Company settings block over-budget requests from being submitted. Reduce the amount or raise a budget change request first.',
    allowed: 'You can still submit; approvers will see that the request exceeds the budget.',
    versionDraft: 'Note: the current budget version is not approved yet ({status}).',
    breakdown: 'Actual {a} · committed {c} · pending {p}',
  } satisfies typeof fcAz,
};

/** Funds-check figures with WITHIN/NEAR/OVER badge and a plain-language explanation. */
export function FundsCheckView({ check, compact }: { check: BudgetCheckDto; compact?: boolean }) {
  const { locale, t } = useI18n();
  const L = useLocal(FC_TEXT);
  const m = (n: number) => `${money(n, locale, 2)} ${check.currency}`;
  const includesPending = check.used > check.actual + check.committed + 0.005;
  const explain = check.budget <= 0
    ? L.explainNoBudget
    : check.state === 'OVER'
      ? fmt(L.explainOVER, { amount: money(-check.availableAfter, locale, 2), ccy: check.currency })
      : check.state === 'NEAR'
        ? fmt(L.explainNEAR, { pct: pct(check.usagePctAfter, locale, false) })
        : L.explainWITHIN;
  const usage = check.usagePctAfter ?? (check.requested > 0 ? 100 : 0);
  return (
    <div className={`fc fc-${check.state}`}>
      <div className="fc-head">
        <BudgetCheckBadge state={check.state} />
        <span className="small muted">{check.basis === 'YTD' ? L.basisYTD : L.basisANNUAL}</span>
      </div>
      <dl className="fc-grid">
        <div><dt>{L.budget}</dt><dd className="num">{m(check.budget)}</dd></div>
        <div>
          <dt>{L.used} <span className="muted small">({includesPending ? L.usedHintPending : L.usedHint})</span></dt>
          <dd className="num">{m(check.used)}</dd>
        </div>
        <div><dt>{L.available}</dt><dd className="num">{m(check.available)}</dd></div>
        <div><dt>{L.requested}</dt><dd className="num">{m(check.requested)}</dd></div>
        <div className={check.availableAfter < 0 ? 'fc-neg' : ''}><dt>{L.availableAfter}</dt><dd className="num">{m(check.availableAfter)}</dd></div>
        <div><dt>{L.usageAfter}</dt><dd className="num">{pct(check.usagePctAfter, locale, false)}</dd></div>
      </dl>
      <div className="fc-meter" role="img" aria-label={`${L.usageAfter}: ${pct(check.usagePctAfter, locale, false)}`}>
        <span className="fc-meter-used" style={{ width: `${check.budget > 0 ? Math.min(100, (check.used / check.budget) * 100) : 0}%` }} />
        <span className="fc-meter-req" style={{ width: `${check.budget > 0 ? Math.max(0, Math.min(100, usage) - Math.min(100, (check.used / check.budget) * 100)) : 0}%` }} />
      </div>
      {!compact && <p className="small muted">{fmt(L.breakdown, { a: money(check.actual, locale), c: money(check.committed, locale), p: money(check.pending, locale) })}</p>}
      <p className="fc-explain">{explain}</p>
      {check.state === 'OVER' && !compact && <p className={`small ${check.blockOverBudget ? 'fc-block' : 'muted'}`}>{check.blockOverBudget ? L.blocked : L.allowed}</p>}
      {check.budgetVersionStatus && !['APPROVED', 'LOCKED'].includes(check.budgetVersionStatus) && (
        <p className="small muted">{fmt(L.versionDraft, { status: t(`versionStatus.${check.budgetVersionStatus}`) })}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ attachments */

const atAz = {
  title: 'Qoşma fayllar',
  empty: 'Fayl əlavə edilməyib.',
  upload: 'Fayl əlavə et',
  uploadedBy: '{who} · {when}',
  download: 'Yüklə',
  saveFirst: 'Fayl əlavə etmək üçün əvvəlcə sorğunu qaralama kimi yadda saxlayın.',
};
const AT_TEXT = {
  az: atAz,
  en: {
    title: 'Attachments',
    empty: 'No files attached.',
    upload: 'Attach file',
    uploadedBy: '{who} · {when}',
    download: 'Download',
    saveFirst: 'Save the request as a draft first to attach files.',
  } satisfies typeof atAz,
};

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Attachment list with download and upload for a purchase / expense request. */
export function AttachmentsCard({ requestId, canUpload = true }: { requestId: number | null; canUpload?: boolean }) {
  const L = useLocal(AT_TEXT);
  if (!requestId) return <Card title={L.title}><p className="muted small">{L.saveFirst}</p></Card>;
  return <AttachmentsInner requestId={requestId} canUpload={canUpload} />;
}

function AttachmentsInner({ requestId, canUpload }: { requestId: number; canUpload: boolean }) {
  const { locale } = useI18n();
  const L = useLocal(AT_TEXT);
  const { data, error, loading, reload } = useAsync(
    () => api<AttachmentDto[]>('GET', `/attachments${qs({ entityType: 'PURCHASE_REQUEST', entityId: requestId })}`), [requestId],
  );
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<unknown>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setOpError(null);
    try {
      const form = new FormData();
      form.append('entityType', 'PURCHASE_REQUEST');
      form.append('entityId', String(requestId));
      form.append('file', file);
      await upload('/attachments', form);
      await reload();
    } catch (e) { setOpError(e); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card title={L.title} actions={canUpload && (
      <>
        <input ref={input} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} aria-label={L.upload} />
        <Button size="sm" busy={busy} onClick={() => input.current?.click()}><Icon name="upload" /> {L.upload}</Button>
      </>
    )}>
      <ErrorMessage error={error ?? opError} />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty>{L.empty}</Empty> : (
        <ul className="att-list">
          {data.map((a) => (
            <li key={a.id}>
              <div className="att-name">
                <b>{a.fileName}</b>
                <span className="muted small">{sizeLabel(a.sizeBytes)} · {fmt(L.uploadedBy, { who: a.uploadedBy, when: date(a.createdAt, locale, true) })}</span>
              </div>
              <Button size="sm" variant="ghost" aria-label={`${L.download} ${a.fileName}`}
                onClick={() => { setOpError(null); download(`/attachments/${a.id}/download`, a.fileName).catch(setOpError); }}>
                <Icon name="download" /> {L.download}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
