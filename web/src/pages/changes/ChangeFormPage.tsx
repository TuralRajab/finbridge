import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MONTH_SHORT, type BudgetDto, type BudgetLineDto, type ChangeRequestDto } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { Alert, Button, Card, Empty, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useDisplayName, useMasterData, usableAccounts } from '../../lib/masterdata';
import { money } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { AmountInput, Delta, DetailedError, sum } from '../budgets/budgetUi';
import '../../styles/budgets.css';

const az = {
  newTitle: 'Yeni büdcə dəyişikliyi sorğusu',
  editTitle: 'Dəyişiklik sorğusunu redaktə et',
  crumbs: 'Büdcə dəyişiklikləri',
  subtitle: 'Kilidlənmiş büdcənin konkret xərc mərkəzi üzrə aylıq məbləğlərinə düzəliş. Təsdiqləndikdə yeni versiya yaranır; cari versiya dəyişməz saxlanılır.',
  budget: 'Büdcə',
  budgetHint: 'Yalnız cari versiyası kilidlənmiş büdcələr seçilə bilər. Qaralama büdcəni sətirlər cədvəlində birbaşa redaktə edin.',
  noLocked: 'Kilidlənmiş büdcə yoxdur. Dəyişiklik sorğusu yalnız təsdiqlənib kilidlənmiş büdcəyə verilir; qaralama büdcə birbaşa redaktə olunur.',
  costCenter: 'Xərc mərkəzi',
  costCenterHint: 'Bir sorğu bir xərc mərkəzini əhatə edir.',
  showAllCc: 'Büdcə sətri olmayan xərc mərkəzlərini də göstər',
  title: 'Mövzu',
  titlePlaceholder: 'məs. Marketinq kampaniyasının genişləndirilməsi',
  reason: 'Əsaslandırma',
  reasonPlaceholder: 'Dəyişikliyin səbəbi, gözlənilən nəticə, maliyyələşmə mənbəyi…',
  items: 'Dəyişiklik bəndləri',
  itemsHint: 'Hər xanada boz rəqəm təsdiqlənmiş (kilidlənmiş) məbləğdir. Yeni məbləği daxil edin; boş qalan xanalar dəyişmir.',
  account: 'Hesab',
  current: 'Təsdiqlənmiş',
  requested: 'Tələb olunan',
  delta: 'Fərq',
  rowTotal: 'İl üzrə',
  addAccount: 'Hesab əlavə et',
  addAccountHint: 'Bu xərc mərkəzində hələ büdcəsi olmayan hesab',
  noAccountsLeft: 'Əlavə ediləcək hesab yoxdur',
  noLines: 'Bu xərc mərkəzinin təsdiqlənmiş büdcəsində sətir yoxdur. Aşağıdan hesab əlavə edin.',
  pickCc: 'Əvvəlcə xərc mərkəzini seçin.',
  changedItems: 'Dəyişən bənd',
  totals: 'Cəmi',
  increase: 'Artım',
  decrease: 'Azalma',
  net: 'Xalis dəyişiklik',
  saveDraft: 'Qaralama kimi saxla',
  saveSubmit: 'Saxla və təsdiqə göndər',
  cancel: 'Ləğv et',
  saved: 'Qaralama yadda saxlanıldı.',
  needItems: 'Ən azı bir məbləği dəyişin.',
  needTitle: 'Mövzu ən azı 3 simvol olmalıdır.',
  needReason: 'Əsaslandırma ən azı 3 simvol olmalıdır.',
  notEditable: 'Bu sorğu redaktə edilə bilməz (yalnız qaralama və ya düzəlişə qaytarılmış sorğular redaktə olunur).',
  openDetail: 'Sorğuya bax',
  ccChangeConfirm: 'Xərc mərkəzi dəyişdirilsə, daxil edilmiş məbləğlər silinəcək. Davam edilsin?',
  reset: 'Sıfırla',
  resetRow: 'Sətri təsdiqlənmiş məbləğə qaytar',
  version: 'v{n} (kilidlənib)',
  tooMany: 'Bir sorğuda ən çox 200 bənd ola bilər.',
};
const TEXT = {
  az,
  en: {
    newTitle: 'New budget change request',
    editTitle: 'Edit change request',
    crumbs: 'Budget changes',
    subtitle: 'Amend the monthly amounts of one cost center in a locked budget. On approval a new version is created; the current version is preserved unchanged.',
    budget: 'Budget',
    budgetHint: 'Only budgets whose current version is locked can be selected. Edit a draft budget directly in its lines grid.',
    noLocked: 'There is no locked budget. Change requests apply only to approved and locked budgets; a draft budget is edited directly.',
    costCenter: 'Cost center',
    costCenterHint: 'One request covers one cost center.',
    showAllCc: 'Also show cost centers without budget lines',
    title: 'Title',
    titlePlaceholder: 'e.g. Extend the marketing campaign',
    reason: 'Justification',
    reasonPlaceholder: 'Why the change is needed, expected outcome, source of funding…',
    items: 'Change items',
    itemsHint: 'The grey figure in each cell is the approved (locked) amount. Enter the new amount; empty cells stay unchanged.',
    account: 'Account',
    current: 'Approved',
    requested: 'Requested',
    delta: 'Difference',
    rowTotal: 'Full year',
    addAccount: 'Add account',
    addAccountHint: 'An account with no budget on this cost center yet',
    noAccountsLeft: 'No accounts left to add',
    noLines: 'The approved budget has no lines for this cost center. Add an account below.',
    pickCc: 'Choose a cost center first.',
    changedItems: 'Changed items',
    totals: 'Total',
    increase: 'Increase',
    decrease: 'Decrease',
    net: 'Net change',
    saveDraft: 'Save as draft',
    saveSubmit: 'Save and submit',
    cancel: 'Cancel',
    saved: 'Draft saved.',
    needItems: 'Change at least one amount.',
    needTitle: 'The title needs at least 3 characters.',
    needReason: 'The justification needs at least 3 characters.',
    notEditable: 'This request cannot be edited (only draft or returned requests can be edited).',
    openDetail: 'Open request',
    ccChangeConfirm: 'Changing the cost center clears the amounts entered. Continue?',
    reset: 'Reset',
    resetRow: 'Reset row to approved amounts',
    version: 'v{n} (locked)',
    tooMany: 'A request can contain at most 200 items.',
  } satisfies typeof az,
};

type Requested = Record<string, number>;
const key = (acc: number, month: number) => `${acc}:${month}`;

export function ChangeFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const [params] = useSearchParams();
  const L = useLocal(TEXT);
  const navigate = useNavigate();
  const location = useLocation();
  const justSaved = !!(location.state as { saved?: boolean } | null)?.saved;

  const budgets = useAsync(() => api<BudgetDto[]>('GET', '/budgets'), []);
  const existing = useAsync(() => (editId ? api<ChangeRequestDto>('GET', `/changes/${editId}`) : Promise.resolve(null)), [editId]);

  if (budgets.loading && !budgets.data) return <Spinner />;
  if (editId && existing.loading && !existing.data) return <Spinner />;
  if (budgets.error) return <ErrorMessage error={budgets.error} />;
  if (existing.error) return <ErrorMessage error={existing.error} />;

  const cr = existing.data;
  const head = (
    <PageHeader eyebrow={<Link to="/changes">← {L.crumbs}</Link>} title={cr ? `${L.editTitle} · ${cr.number}` : L.newTitle} subtitle={L.subtitle} />
  );
  if (cr && !cr.canEdit) {
    return <>{head}<Alert kind="warning">{L.notEditable} <Link to={`/changes/${cr.id}`}>{L.openDetail}</Link></Alert></>;
  }
  const locked = (budgets.data ?? []).filter((b) => b.currentStatus === 'LOCKED');
  const initialBudget = cr?.budgetId ?? (params.get('budgetId') ? Number(params.get('budgetId')) : locked[0]?.id ?? null);

  return (
    <>
      {head}
      {justSaved && <Alert kind="success"><Icon name="check" /> {L.saved}</Alert>}
      {!cr && locked.length === 0 ? <Alert kind="warning"><Icon name="lock" /> {L.noLocked}</Alert> : (
        <ChangeForm key={cr?.id ?? 'new'} L={L} budgets={budgets.data ?? []} locked={locked} initialBudget={initialBudget} cr={cr}
          onSaved={(saved, submitted) => navigate(submitted ? `/changes/${saved.id}` : `/changes/${saved.id}/edit`, { replace: !submitted && !!cr, state: { saved: true } })} />
      )}
    </>
  );
}

function ChangeForm({ L, budgets, locked, initialBudget, cr, onSaved }: {
  L: typeof az; budgets: BudgetDto[]; locked: BudgetDto[]; initialBudget: number | null; cr: ChangeRequestDto | null;
  onSaved: (cr: ChangeRequestDto, submitted: boolean) => void;
}) {
  const { lang, locale } = useI18n();
  const display = useDisplayName();
  const md = useMasterData();
  const [budgetId, setBudgetId] = useState<number | null>(initialBudget && (cr || locked.some((b) => b.id === initialBudget)) ? initialBudget : locked[0]?.id ?? null);
  const [ccId, setCcId] = useState<number | null>(cr?.costCenterId ?? null);
  const [showAllCc, setShowAllCc] = useState(false);
  const [title, setTitle] = useState(cr?.title ?? '');
  const [reason, setReason] = useState(cr?.reason ?? '');
  const [requested, setRequested] = useState<Requested>(() => Object.fromEntries((cr?.items ?? []).map((i) => [key(i.accountId, i.month), i.requestedAmount])));
  const [extraAccounts, setExtraAccounts] = useState<number[]>(() => (cr?.items ?? []).map((i) => i.accountId));
  const [addPick, setAddPick] = useState('');
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const budget = budgets.find((b) => b.id === budgetId) ?? null;
  const lines = useAsync(
    () => (budgetId ? api<BudgetLineDto[]>('GET', `/budgets/${budgetId}/lines${qs({ versionId: budget?.currentVersionId ?? undefined })}`) : Promise.resolve([] as BudgetLineDto[])),
    [budgetId, budget?.currentVersionId],
  );

  // approved amounts per account × month for the chosen cost center
  const current = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const l of lines.data ?? []) {
      if (l.costCenterId !== ccId) continue;
      const cur = m.get(l.accountId) ?? Array(12).fill(0);
      l.months.forEach((v, i) => { cur[i] = Math.round((cur[i] + v) * 100) / 100; });
      m.set(l.accountId, cur);
    }
    return m;
  }, [lines.data, ccId]);
  const ccWithLines = useMemo(() => new Set((lines.data ?? []).map((l) => l.costCenterId)), [lines.data]);

  const ccs = (md.data?.costCenters ?? []).filter((c) => (c.isActive || c.id === ccId) && (showAllCc || ccWithLines.has(c.id) || c.id === ccId))
    .sort((a, b) => a.code.localeCompare(b.code));
  useEffect(() => {
    if (ccId === null && ccs.length && lines.data) setCcId(ccs[0].id);
  }, [ccId, ccs, lines.data]);
  const cc = md.data?.costCenters.find((c) => c.id === ccId);
  const accountsById = new Map((md.data?.accounts ?? []).map((a) => [a.id, a]));
  const lineAccount = new Map((lines.data ?? []).filter((l) => l.costCenterId === ccId).map((l) => [l.accountId, { code: l.accountCode, name: l.accountName }]));

  const rowIds = [...new Set([...current.keys(), ...extraAccounts])].sort((a, b) => {
    const ca = accountsById.get(a)?.code ?? lineAccount.get(a)?.code ?? '';
    const cb = accountsById.get(b)?.code ?? lineAccount.get(b)?.code ?? '';
    return ca.localeCompare(cb);
  });
  const addable = cc ? usableAccounts(md.data?.accounts ?? [], cc, 'budget').filter((a) => !rowIds.includes(a.id)).sort((a, b) => a.code.localeCompare(b.code)) : [];

  const curOf = (acc: number, m: number) => current.get(acc)?.[m - 1] ?? 0;
  const reqOf = (acc: number, m: number) => requested[key(acc, m)];
  const effective = (acc: number, m: number) => reqOf(acc, m) ?? curOf(acc, m);
  const items = rowIds.flatMap((acc) => Array.from({ length: 12 }, (_, i) => i + 1)
    .filter((m) => reqOf(acc, m) !== undefined && Math.round(reqOf(acc, m) * 100) !== Math.round(curOf(acc, m) * 100))
    .map((m) => ({ accountId: acc, month: m, requestedAmount: reqOf(acc, m), delta: Math.round((reqOf(acc, m) - curOf(acc, m)) * 100) / 100 })));
  const up = sum(items.filter((i) => i.delta > 0).map((i) => i.delta));
  const down = sum(items.filter((i) => i.delta < 0).map((i) => i.delta));

  const setCell = (acc: number, m: number, v: number | null) => {
    setSavedNote(false);
    setRequested((r) => {
      const next = { ...r };
      if (v === null) delete next[key(acc, m)]; else next[key(acc, m)] = v;
      return next;
    });
  };
  const resetRow = (acc: number) => setRequested((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith(`${acc}:`))));

  const changeCc = (next: number) => {
    if (items.length && !window.confirm(L.ccChangeConfirm)) return;
    setCcId(next); setRequested({}); setExtraAccounts([]);
  };
  const changeBudget = (next: number) => {
    if (items.length && !window.confirm(L.ccChangeConfirm)) return;
    setBudgetId(next); setRequested({}); setExtraAccounts([]); setCcId(null);
  };

  const titleErr = title.trim().length < 3 ? L.needTitle : undefined;
  const reasonErr = reason.trim().length < 3 ? L.needReason : undefined;
  const itemsErr = items.length === 0 ? L.needItems : items.length > 200 ? L.tooMany : undefined;
  const valid = !!budgetId && !!ccId && !titleErr && !reasonErr && !itemsErr;

  const save = async (submit: boolean) => {
    setTouched(true);
    if (!valid || !budgetId || !ccId) return;
    setBusy(submit ? 'submit' : 'draft'); setError(null);
    const body = { budgetId, costCenterId: ccId, title: title.trim(), reason: reason.trim(), items: items.map(({ accountId, month, requestedAmount }) => ({ accountId, month, requestedAmount })) };
    try {
      let saved = cr ? await api<ChangeRequestDto>('PUT', `/changes/${cr.id}`, body) : await api<ChangeRequestDto>('POST', '/changes', body);
      if (submit) saved = await api<ChangeRequestDto>('POST', `/changes/${saved.id}/submit`);
      setSavedNote(!submit);
      onSaved(saved, submit);
    } catch (e) { setError(e); } finally { setBusy(null); }
  };

  const months = MONTH_SHORT[lang];
  const accLabel = (acc: number) => {
    const a = accountsById.get(acc);
    const l = lineAccount.get(acc);
    return { code: a?.code ?? l?.code ?? '?', name: a ? display(a) : l?.name ?? '' };
  };
  const budgetOptions = (cr ? budgets.filter((b) => b.id === cr.budgetId) : locked).map((b) => ({
    value: b.id, label: `${b.fiscalYear} · ${b.name} · ${fmt(L.version, { n: b.currentVersionNo ?? '?' })}`,
  }));

  return (
    <>
      <Card>
        <div className="grid-2">
          <Field label={L.budget} hint={L.budgetHint}>
            {(fid) => <Select id={fid} value={budgetId ?? ''} disabled={!!cr} onChange={(e) => changeBudget(Number(e.target.value))} options={budgetOptions} />}
          </Field>
          <Field label={L.costCenter} hint={L.costCenterHint}>
            {(fid) => md.loading && !md.data ? <Spinner /> : (
              <Select id={fid} value={ccId ?? ''} onChange={(e) => changeCc(Number(e.target.value))}
                options={ccs.map((c) => ({ value: c.id, label: `${c.code} · ${c.name} (${c.sectionName})` }))} />
            )}
          </Field>
        </div>
        <label className="check small">
          <input type="checkbox" checked={showAllCc} onChange={(e) => setShowAllCc(e.target.checked)} /> {L.showAllCc}
        </label>
        <Field label={L.title} error={touched ? titleErr : undefined}>
          {(fid) => <Input id={fid} value={title} maxLength={200} placeholder={L.titlePlaceholder} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label={L.reason} error={touched ? reasonErr : undefined}>
          {(fid) => <textarea id={fid} className="input textarea" rows={3} maxLength={2000} value={reason} placeholder={L.reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Card>

      <Card flush title={L.items} subtitle={L.itemsHint}
        actions={<span className="muted small">{L.changedItems}: <b>{items.length}</b></span>}>
        {md.error ? <div className="card-body"><ErrorMessage error={md.error} /></div> : null}
        {lines.error ? <div className="card-body"><ErrorMessage error={lines.error} /></div> : null}
        {!ccId ? <Empty>{L.pickCc}</Empty> : lines.loading && !lines.data ? <Spinner /> : (
          <>
            {rowIds.length === 0 && <div className="card-body"><Alert kind="info">{L.noLines}</Alert></div>}
            {rowIds.length > 0 && (
              <div className="table-scroll grid-scroll">
                <table className="table grid-table change-grid">
                  <thead><tr>
                    <th className="sticky-col">{L.account}</th>
                    {months.map((m) => <th key={m} className="r">{m}</th>)}
                    <th className="r">{L.rowTotal}</th>
                    <th><span className="sr-only">{L.reset}</span></th>
                  </tr></thead>
                  <tbody>
                    {rowIds.map((acc) => {
                      const a = accLabel(acc);
                      const curTotal = sum(Array.from({ length: 12 }, (_, i) => curOf(acc, i + 1)));
                      const newTotal = sum(Array.from({ length: 12 }, (_, i) => effective(acc, i + 1)));
                      const rowDirty = Array.from({ length: 12 }, (_, i) => i + 1).some((m) => reqOf(acc, m) !== undefined);
                      return (
                        <tr key={acc} className={newTotal !== curTotal ? 'is-dirty' : ''}>
                          <td className="sticky-col"><span className="acc-code">{a.code}</span> {a.name}</td>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                            const cur = curOf(acc, m);
                            const req = reqOf(acc, m);
                            const d = req === undefined ? 0 : req - cur;
                            return (
                              <td key={m} className={`r num cell${req !== undefined && Math.round(d * 100) !== 0 ? ' cell-changed' : ''}`}>
                                <AmountInput value={req ?? null} placeholder={money(cur, locale)} min0
                                  label={`${a.code} ${months[m - 1]} — ${L.requested} (${L.current}: ${money(cur, locale)})`}
                                  onChange={(v) => setCell(acc, m, v)} />
                                <div className="cell-sub">{L.current}: {money(cur, locale)}</div>
                                {req !== undefined && Math.round(d * 100) !== 0 && <div className="cell-sub"><Delta value={d} /></div>}
                              </td>
                            );
                          })}
                          <td className="r num">
                            <b>{money(newTotal, locale)}</b>
                            <div className="cell-sub">{L.current}: {money(curTotal, locale)}</div>
                            {newTotal !== curTotal && <div className="cell-sub"><Delta value={newTotal - curTotal} /></div>}
                          </td>
                          <td>{rowDirty && <button type="button" className="icon-btn" title={L.resetRow} aria-label={`${L.resetRow}: ${a.code}`} onClick={() => resetRow(acc)}><Icon name="x" /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td className="sticky-col"><b>{L.totals}</b></td>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const c = sum(rowIds.map((acc) => curOf(acc, m)));
                      const e = sum(rowIds.map((acc) => effective(acc, m)));
                      return <td key={m} className="r num"><b>{money(e, locale)}</b>{e !== c && <div className="cell-sub"><Delta value={e - c} /></div>}</td>;
                    })}
                    <td className="r num"><b>{money(sum(rowIds.map((acc) => sum(Array.from({ length: 12 }, (_, i) => effective(acc, i + 1))))), locale)}</b></td>
                    <td />
                  </tr></tfoot>
                </table>
              </div>
            )}
            <div className="table-toolbar add-account">
              <Field label={L.addAccount} hint={L.addAccountHint}>
                {(fid) => <Select id={fid} value={addPick} disabled={!addable.length} onChange={(e) => setAddPick(e.target.value)}
                  options={addable.length ? [{ value: '', label: '—' }, ...addable.map((x) => ({ value: x.id, label: `${x.code} · ${display(x)}` }))] : [{ value: '', label: L.noAccountsLeft }]} />}
              </Field>
              <Button disabled={!addPick} onClick={() => { setExtraAccounts((x) => [...x, Number(addPick)]); setAddPick(''); }}><Icon name="plus" /> {L.addAccount}</Button>
            </div>
          </>
        )}
      </Card>

      <Card>
        <dl className="facts change-summary">
          <div><dt>{L.increase}</dt><dd><Delta value={up} /></dd></div>
          <div><dt>{L.decrease}</dt><dd><Delta value={down} /></dd></div>
          <div><dt>{L.net}</dt><dd><Delta value={up + down} strong /> {budget && <span className="muted small">{budget.currency}</span>}</dd></div>
          <div><dt>{L.changedItems}</dt><dd className="num">{items.length}</dd></div>
        </dl>
        {touched && itemsErr && <Alert kind="warning">{itemsErr}</Alert>}
        {savedNote && <Alert kind="success">{L.saved}</Alert>}
        <DetailedError error={error} />
        <div className="form-actions">
          <Link className="btn btn-ghost" to={cr ? `/changes/${cr.id}` : '/changes'}>{L.cancel}</Link>
          <Button busy={busy === 'draft'} disabled={!!busy} onClick={() => save(false)}>{L.saveDraft}</Button>
          <Button variant="primary" busy={busy === 'submit'} disabled={!!busy} onClick={() => save(true)}><Icon name="check" /> {L.saveSubmit}</Button>
        </div>
      </Card>
    </>
  );
}
