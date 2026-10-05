import { useState } from 'react';
import { WORKFLOW_TYPES, type DelegationDto, type UserDto, type WorkflowType } from '@finbridge/shared';
import '../../styles/workflow.css';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { ServerErrors, todayIso } from './wfCommon';

const az = {
  title: 'Səlahiyyət ötürmə',
  subtitle: 'Məzuniyyət və ya ezamiyyət zamanı təsdiq səlahiyyətinizi müəyyən müddətə başqa əməkdaşa verin.',
  how: 'Ötürmə müddətində yeni və gözləyən təsdiq tapşırıqlarınız nümayəndənin siyahısında da görünür; o, sizin adınızdan qərar verir və bu, tarixçədə qeyd olunur. Siz də təsdiqləyə bilərsiniz.',
  newDelegation: 'Yeni ötürmə',
  fromUser: 'Kimin səlahiyyəti',
  toUser: 'Kimə ötürülür (nümayəndə)',
  scope: 'Sənəd növü',
  allTypes: 'Bütün təsdiq növləri',
  validFrom: 'Başlama tarixi',
  validTo: 'Bitmə tarixi (daxil)',
  reason: 'Səbəb',
  reasonPh: 'Məsələn: məzuniyyət',
  create: 'Ötür',
  mine: 'Mənim ötürmələrim',
  mineSub: 'Sizin təsdiq səlahiyyətinizi alan əməkdaşlar',
  toMe: 'Mənə ötürülənlər',
  toMeSub: 'Adından təsdiqləyə biləcəyiniz əməkdaşlar',
  others: 'Şirkət üzrə digər ötürmələr',
  othersSub: 'Administrator görünüşü',
  tabCurrent: 'Aktiv və planlaşdırılan',
  tabHistory: 'Tarixçə',
  colFrom: 'Kimdən',
  colTo: 'Kimə',
  colScope: 'Əhatə',
  colPeriod: 'Müddət',
  colReason: 'Səbəb',
  st: { active: 'Qüvvədədir', scheduled: 'Planlaşdırılıb', expired: 'Bitib', revoked: 'Ləğv edilib' },
  revoke: 'Ləğv et',
  revokeTitle: 'Ötürmə ləğv edilsin?',
  revokeHint: '{from} → {to} ({period}). Nümayəndə artıq bu əməkdaşın adından təsdiqləyə bilməyəcək.',
  none: 'Qeyd yoxdur.',
  errSame: 'Başqa əməkdaş seçin.',
  errDates: 'Bitmə tarixi başlama tarixindən əvvəl ola bilməz.',
  errTo: 'Nümayəndəni seçin.',
  created: 'Səlahiyyət ötürüldü: {to}, {period}.',
  you: 'siz',
};
const TEXT = {
  az,
  en: {
    title: 'Delegations',
    subtitle: 'Hand over your approval authority to a colleague for a period, e.g. during leave or travel.',
    how: 'During the delegation your new and pending approval tasks also appear in the delegate\'s inbox; they decide on your behalf and the history records it. You can still approve yourself.',
    newDelegation: 'New delegation',
    fromUser: 'Whose authority',
    toUser: 'Delegate to',
    scope: 'Document type',
    allTypes: 'All approval types',
    validFrom: 'From',
    validTo: 'To (inclusive)',
    reason: 'Reason',
    reasonPh: 'e.g. annual leave',
    create: 'Delegate',
    mine: 'My delegations',
    mineSub: 'Colleagues who receive your approval authority',
    toMe: 'Delegated to me',
    toMeSub: 'Colleagues you can approve on behalf of',
    others: 'Other delegations in the company',
    othersSub: 'Administrator view',
    tabCurrent: 'Active & scheduled',
    tabHistory: 'History',
    colFrom: 'From',
    colTo: 'To',
    colScope: 'Scope',
    colPeriod: 'Period',
    colReason: 'Reason',
    st: { active: 'In effect', scheduled: 'Scheduled', expired: 'Ended', revoked: 'Revoked' },
    revoke: 'Revoke',
    revokeTitle: 'Revoke delegation?',
    revokeHint: '{from} → {to} ({period}). The delegate will no longer be able to approve on this person\'s behalf.',
    none: 'No records.',
    errSame: 'Choose another person.',
    errDates: 'The end date cannot be before the start date.',
    errTo: 'Choose the delegate.',
    created: 'Delegated to {to}, {period}.',
    you: 'you',
  } satisfies typeof az,
};
type Txt = typeof az;
type State = keyof Txt['st'];

function stateOf(d: DelegationDto, day: string): State {
  if (!d.isActive) return 'revoked';
  if (d.validTo < day) return 'expired';
  if (d.validFrom > day) return 'scheduled';
  return 'active';
}
const TONE: Record<State, string> = { active: 'success', scheduled: 'info', expired: 'muted', revoked: 'muted' };

export function DelegationsPage() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { user, can } = useAuth();
  const isAdmin = can('users.manage');
  const seesAll = isAdmin || can('workflow.manage');
  const { data, error, loading, reload } = useAsync(() => api<DelegationDto[]>('GET', '/workflows/delegations'), []);
  const users = useAsync(() => api<UserDto[]>('GET', '/users'), []);
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<DelegationDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const day = todayIso();
  const period = (d: Pick<DelegationDto, 'validFrom' | 'validTo'>) => `${date(d.validFrom, locale)} – ${date(d.validTo, locale)}`;

  const rows = (data ?? []).filter((d) => {
    const s = stateOf(d, day);
    return tab === 'current' ? s === 'active' || s === 'scheduled' : s === 'expired' || s === 'revoked';
  });
  const me = user?.id;
  const mine = rows.filter((d) => d.fromUserId === me);
  const toMe = rows.filter((d) => d.toUserId === me);
  const others = seesAll ? rows.filter((d) => d.fromUserId !== me && d.toUserId !== me) : [];

  const table = (list: DelegationDto[]) => !list.length ? <div className="card-body muted small">{L.none}</div> : (
    <div className="table-scroll">
      <table className="table wfd-table">
        <thead><tr>
          <th>{L.colFrom}</th><th>{L.colTo}</th><th>{L.colScope}</th><th>{L.colPeriod}</th><th>{L.colReason}</th><th>{t('common.status')}</th><th className="r">{t('common.actions')}</th>
        </tr></thead>
        <tbody>
          {list.map((d) => {
            const s = stateOf(d, day);
            const canRevoke = d.isActive && s !== 'expired' && (d.fromUserId === me || isAdmin);
            return (
              <tr key={d.id} className={s === 'revoked' || s === 'expired' ? 'wfl-inactive' : ''}>
                <td>{d.fromName}{d.fromUserId === me && <span className="muted small"> ({L.you})</span>}</td>
                <td>{d.toName}{d.toUserId === me && <span className="muted small"> ({L.you})</span>}</td>
                <td>{d.workflowType ? t(`workflowType.${d.workflowType}` as TKey) : <span className="muted">{L.allTypes}</span>}</td>
                <td className="num wfd-period">{period(d)}</td>
                <td className="comment-cell">{d.reason ?? <span className="muted">—</span>}</td>
                <td><Badge tone={TONE[s]}>{L.st[s]}</Badge></td>
                <td className="r">{canRevoke && <Button size="sm" variant="ghost" onClick={() => setRevoke(d)} aria-label={`${L.revoke}: ${d.fromName} → ${d.toName}`}><Icon name="x" /> {L.revoke}</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="wfd">
      <PageHeader eyebrow={t('nav.overview')} title={L.title} subtitle={L.subtitle}
        actions={<Button variant="primary" onClick={() => { setCreating(true); setNotice(null); }}><Icon name="delegate" /> {L.newDelegation}</Button>} />
      <div className="alert alert-info">{L.how}</div>
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'current', label: L.tabCurrent }, { value: 'history', label: L.tabHistory }]} />

      {loading && !data ? <Spinner /> : error ? <ErrorMessage error={error} /> : !data?.length ? (
        <Card><Empty><Icon name="delegate" size={28} /><div>{L.none}</div></Empty></Card>
      ) : (
        <>
          <Card flush title={L.mine} subtitle={L.mineSub}>{table(mine)}</Card>
          <Card flush title={L.toMe} subtitle={L.toMeSub}>{table(toMe)}</Card>
          {seesAll && <Card flush title={L.others} subtitle={L.othersSub}>{table(others)}</Card>}
        </>
      )}

      {creating && (
        <CreateDialog L={L} users={users.data ?? []} usersError={users.error} isAdmin={isAdmin} meId={me ?? 0}
          onClose={() => setCreating(false)}
          onCreated={async (d) => { setCreating(false); setNotice(fmt(L.created, { to: d.toName, period: period(d) })); setTab('current'); await reload(); }} />
      )}
      {revoke && <RevokeDialog L={L} d={revoke} period={period(revoke)} onClose={() => setRevoke(null)} onDone={async () => { setRevoke(null); await reload(); }} />}
    </div>
  );
}

function CreateDialog({ L, users, usersError, isAdmin, meId, onClose, onCreated }: {
  L: Txt; users: UserDto[]; usersError: unknown; isAdmin: boolean; meId: number; onClose: () => void; onCreated: (d: DelegationDto) => Promise<void>;
}) {
  const { t } = useI18n();
  const [fromId, setFromId] = useState<number>(meId);
  const [toId, setToId] = useState<number | ''>('');
  const [wt, setWt] = useState<WorkflowType | ''>('');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  const problems = [
    !toId && L.errTo,
    toId && toId === fromId && L.errSame,
    to < from && L.errDates,
  ].filter(Boolean) as string[];
  const active = users.filter((u) => u.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const opt = (u: UserDto) => ({ value: u.id, label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}` });

  const submit = async () => {
    setTouched(true);
    if (problems.length) return;
    setBusy(true); setErr(null);
    try {
      const d = await api<DelegationDto>('POST', '/workflows/delegations', {
        ...(isAdmin && fromId !== meId ? { fromUserId: fromId } : {}), toUserId: toId, workflowType: wt || null,
        validFrom: from, validTo: to, reason: reason.trim() || null,
      });
      await onCreated(d);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={L.newDelegation} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} onClick={() => void submit()}><Icon name="delegate" /> {L.create}</Button>
    </>}>
      <ErrorMessage error={usersError} />
      {isAdmin && (
        <Field label={L.fromUser}>{(id) => (
          <Select id={id} value={fromId} onChange={(e) => setFromId(Number(e.target.value))} options={active.map((u) => (u.id === meId ? { ...opt(u), label: `${opt(u).label} (${L.you})` } : opt(u)))} />
        )}</Field>
      )}
      <Field label={L.toUser} error={touched && !toId ? L.errTo : touched && toId === fromId ? L.errSame : undefined}>{(id) => (
        <Select id={id} value={toId} onChange={(e) => setToId(e.target.value ? Number(e.target.value) : '')}
          options={[{ value: '', label: t('common.select') }, ...active.filter((u) => u.id !== fromId).map(opt)]} />
      )}</Field>
      <Field label={L.scope}>{(id) => (
        <Select id={id} value={wt} onChange={(e) => setWt(e.target.value as WorkflowType | '')}
          options={[{ value: '', label: L.allTypes }, ...WORKFLOW_TYPES.map((w) => ({ value: w, label: t(`workflowType.${w}` as TKey) }))]} />
      )}</Field>
      <div className="grid-2">
        <Field label={L.validFrom}>{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />}</Field>
        <Field label={L.validTo} error={touched && to < from ? L.errDates : undefined}>{(id) => <Input id={id} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />}</Field>
      </div>
      <Field label={<>{L.reason} <span className="muted">({t('common.optional')})</span></>}>{(id) => (
        <Input id={id} value={reason} maxLength={300} placeholder={L.reasonPh} onChange={(e) => setReason(e.target.value)} />
      )}</Field>
      <ServerErrors error={err} />
    </Modal>
  );
}

function RevokeDialog({ L, d, period, onClose, onDone }: { L: Txt; d: DelegationDto; period: string; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title={L.revokeTitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="danger" busy={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api('DELETE', `/workflows/delegations/${d.id}`); await onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
      }}>{L.revoke}</Button>
    </>}>
      <p>{fmt(L.revokeHint, { from: d.fromName, to: d.toName, period })}</p>
      <ErrorMessage error={err} />
    </Modal>
  );
}
