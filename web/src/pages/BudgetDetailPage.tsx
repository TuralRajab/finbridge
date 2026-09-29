import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BUDGET_STATUSES, BUDGET_TRANSITIONS, DEPT_TRANSITIONS, MONTH_SHORT,
  type AccountDto, type BudgetAction, type BudgetDetailDto, type BudgetEventDto, type BudgetLineDto, type CostCenterDto, type DeptAction,
} from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ImportDialog } from '../components/ImportDialog';
import {
  ActionDialog, Alert, BudgetStatusBadge, Button, Card, DeptStatusBadge, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal,
  PageHeader, Select, Spinner, Tabs,
} from '../components/ui';
import { useI18n, type TKey } from '../i18n';
import { date, money, parseAmount } from '../lib/format';
import { useAsync } from '../lib/useAsync';

type Tab = 'departments' | 'lines' | 'history';
type Pending =
  | { kind: 'budget'; action: BudgetAction }
  | { kind: 'dept'; action: DeptAction; departmentId: number; name: string };

export function BudgetDetailPage() {
  const { id } = useParams();
  const budgetId = Number(id);
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: budget, setData: setBudget, loading, error, reload } = useAsync(() => api<BudgetDetailDto>('GET', `/budgets/${budgetId}`), [budgetId]);
  const [tab, setTab] = useState<Tab>('departments');
  const [deptFilter, setDeptFilter] = useState<number | ''>('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [importing, setImporting] = useState(false);
  const [linesVersion, setLinesVersion] = useState(0);

  if (loading && !budget) return <Spinner />;
  if (error || !budget) return <ErrorMessage error={error} />;

  const reviewed = budget.departments.filter((d) => d.status === 'REVIEWED').length;
  const allReviewed = budget.departments.length > 0 && reviewed === budget.departments.length;

  const runAction = async (comment: string) => {
    if (!pending) return;
    const path = pending.kind === 'budget'
      ? `/budgets/${budgetId}/actions/${pending.action}`
      : `/budgets/${budgetId}/departments/${pending.departmentId}/actions/${pending.action}`;
    setBudget(await api<BudgetDetailDto>('POST', path, { comment }));
    setLinesVersion((v) => v + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/budgets">← {t('budgets.title')}</Link>}
        title={<>{budget.name} <BudgetStatusBadge status={budget.status} /></>}
        subtitle={`${budget.year} · ${money(budget.total, locale)} AZN · ${budget.lineCount} ${t('budgets.lines').toLocaleLowerCase(locale)}`}
        actions={<>
          <ExportButton path={`/export/budget/${budget.id}`} filename={`budget-${budget.year}.xlsx`} />
          {budget.canImport && <Button onClick={() => setImporting(true)}><Icon name="upload" /> {t('common.importExcel')}</Button>}
          {budget.status === 'DRAFT' && can('budget.create') && (
            <Button variant="ghost" onClick={async () => {
              if (!window.confirm(t('common.confirmDelete'))) return;
              await api('DELETE', `/budgets/${budget.id}`);
              navigate('/budgets');
            }}><Icon name="trash" /> {t('budgets.deleteDraft')}</Button>
          )}
          {budget.allowedActions.map((a) => (
            <Button key={a} variant={a === 'reject' ? 'danger' : 'primary'} disabled={a === 'submit_to_cfo' && !allReviewed}
              title={a === 'submit_to_cfo' && !allReviewed ? t('budgets.notReviewedYet', { done: reviewed, total: budget.departments.length }) : undefined}
              onClick={() => setPending({ kind: 'budget', action: a })}>
              {a === 'lock' && <Icon name="lock" />}{t(`budgetActions.${a}`)}
            </Button>
          ))}
        </>}
      />

      <Stepper status={budget.status} />
      {budget.allowedActions.includes('submit_to_cfo') && !allReviewed && (
        <Alert kind="info">{t('budgets.notReviewedYet', { done: reviewed, total: budget.departments.length })}</Alert>
      )}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'departments', label: t('budgets.tabDepartments') },
        { value: 'lines', label: t('budgets.tabLines') },
        { value: 'history', label: t('budgets.tabHistory') },
      ]} />

      {tab === 'departments' && (
        <Card flush>
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{t('lines.department')}</th><th>{t('budgets.manager')}</th><th>{t('common.status')}</th>
                <th className="r">{t('budgets.lines')}</th><th className="r">{t('common.total')} (AZN)</th><th>{t('budgets.lastComment')}</th><th className="r">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {budget.departments.map((d) => (
                  <tr key={d.departmentId}>
                    <td><b>{d.name}</b><div className="muted small">{d.code}</div></td>
                    <td>{d.managerName ?? '—'}</td>
                    <td>{budget.status === 'DRAFT' ? <span className="muted">—</span> : <DeptStatusBadge status={d.status} />}</td>
                    <td className="r num">{d.lineCount}</td>
                    <td className="r num">{money(d.total, locale)}</td>
                    <td className="comment-cell">{d.lastComment ? <span className="quote">“{d.lastComment}”</span> : <span className="muted">—</span>}</td>
                    <td className="r">
                      <div className="row-actions">
                        <Button size="sm" variant="ghost" onClick={() => { setDeptFilter(d.departmentId); setTab('lines'); }}>{t('budgets.openLines')}</Button>
                        {d.allowedActions.map((a) => (
                          <Button key={a} size="sm" variant={a === 'request_changes' ? 'danger' : a === 'review' ? 'success' : 'primary'}
                            onClick={() => setPending({ kind: 'dept', action: a, departmentId: d.departmentId, name: d.name })}>
                            {t(`deptActions.${a}`)}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'lines' && (
        <LinesEditor key={linesVersion} budget={budget} departmentId={deptFilter} onDepartmentChange={setDeptFilter} onChanged={() => void reload()} />
      )}

      {tab === 'history' && <History budgetId={budget.id} version={linesVersion} />}

      {pending && (
        <ActionDialog
          title={pending.kind === 'budget' ? t(`budgetActions.${pending.action}`) : `${t(`deptActions.${pending.action}`)} — ${pending.name}`}
          hint={pending.kind === 'budget' ? t(`budgetActionHints.${pending.action}`) : t(`deptActionHints.${pending.action}`)}
          commentRequired={pending.kind === 'budget' ? BUDGET_TRANSITIONS[pending.action].commentRequired : DEPT_TRANSITIONS[pending.action].commentRequired}
          danger={pending.action === 'reject' || pending.action === 'request_changes'}
          confirmLabel={pending.kind === 'budget' ? t(`budgetActions.${pending.action}`) : t(`deptActions.${pending.action}`)}
          onConfirm={runAction}
          onClose={() => setPending(null)}
        />
      )}
      {importing && (
        <ImportDialog kind="budget" endpoint={`/budgets/${budget.id}/import`} templatePath="/export/templates/budget"
          onClose={() => setImporting(false)} onDone={() => { void reload(); setLinesVersion((v) => v + 1); }} />
      )}
    </>
  );
}

function Stepper({ status }: { status: BudgetDetailDto['status'] }) {
  const { t } = useI18n();
  const idx = BUDGET_STATUSES.indexOf(status);
  return (
    <ol className="stepper" aria-label={t('budgets.workflow')}>
      {BUDGET_STATUSES.map((s, i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}>
          <span className="step-dot">{i < idx ? '✓' : i + 1}</span>
          <span>{t(`budgetStatus.${s}` as TKey)}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ lines grid */

function LinesEditor({ budget, departmentId, onDepartmentChange, onChanged }: {
  budget: BudgetDetailDto; departmentId: number | ''; onDepartmentChange: (d: number | '') => void; onChanged: () => void;
}) {
  const { t, lang, locale } = useI18n();
  const [ccFilter, setCcFilter] = useState<number | ''>('');
  const { data: lines, setData: setLines, loading, error, reload } = useAsync(
    () => api<BudgetLineDto[]>('GET', `/budgets/${budget.id}/lines${departmentId ? `?departmentId=${departmentId}` : ''}`),
    [budget.id, departmentId],
  );
  const [drafts, setDrafts] = useState<Record<number, { months?: number[]; description?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { setDrafts({}); setCcFilter(''); }, [departmentId]);

  const visible = useMemo(() => (lines ?? []).filter((l) => !ccFilter || l.costCenterId === ccFilter), [lines, ccFilter]);
  const costCenters = useMemo(() => {
    const m = new Map<number, string>();
    (lines ?? []).forEach((l) => m.set(l.costCenterId, `${l.costCenterCode} · ${l.costCenterName}`));
    return [...m.entries()];
  }, [lines]);
  const anyEditable = budget.departments.some((d) => d.canEdit);
  const dirty = Object.keys(drafts).length;

  const monthsOf = (l: BudgetLineDto) => drafts[l.id]?.months ?? l.months;
  const setMonth = (l: BudgetLineDto, i: number, v: number) => {
    const months = [...monthsOf(l)];
    months[i] = v;
    setDrafts((d) => ({ ...d, [l.id]: { ...d[l.id], months } }));
  };

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const updated = await api<BudgetLineDto[]>('PATCH', `/budgets/${budget.id}/lines`, {
        lines: Object.entries(drafts).map(([id, d]) => ({ id: Number(id), ...d })),
      });
      setLines(departmentId ? updated.filter((l) => l.departmentId === departmentId) : updated);
      setDrafts({});
      onChanged();
    } catch (e) { setSaveError(e); } finally { setSaving(false); }
  };

  const monthTotals = Array.from({ length: 12 }, (_, i) => visible.reduce((s, l) => s + monthsOf(l)[i], 0));
  const grand = monthTotals.reduce((a, b) => a + b, 0);

  return (
    <Card flush>
      <div className="table-toolbar">
        <Select value={departmentId} onChange={(e) => onDepartmentChange(e.target.value ? Number(e.target.value) : '')} aria-label={t('lines.filterDepartment')}
          options={[{ value: '', label: `${t('lines.filterDepartment')}: ${t('common.all')}` }, ...budget.departments.map((d) => ({ value: d.departmentId, label: d.name }))]} />
        <Select value={ccFilter} onChange={(e) => setCcFilter(e.target.value ? Number(e.target.value) : '')} aria-label={t('lines.filterCostCenter')}
          options={[{ value: '', label: `${t('lines.filterCostCenter')}: ${t('common.all')}` }, ...costCenters.map(([id, label]) => ({ value: id, label }))]} />
        <span className="muted small">{anyEditable ? t('budgets.editableHint') : t('budgets.readOnly')}</span>
        <div className="toolbar-right">
          {dirty > 0 && <span className="dirty">{t('common.unsavedChanges', { n: dirty })}</span>}
          {dirty > 0 && <Button variant="ghost" onClick={() => setDrafts({})}>{t('lines.discard')}</Button>}
          {anyEditable && <Button onClick={() => setAdding(true)}><Icon name="plus" /> {t('lines.addLine')}</Button>}
          {anyEditable && <Button variant="primary" busy={saving} disabled={!dirty} onClick={save}><Icon name="check" /> {t('lines.saveChanges')}</Button>}
        </div>
      </div>
      <ErrorMessage error={saveError} />
      {loading && !lines ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : visible.length === 0 ? <Empty>{t('lines.empty')}</Empty> : (
        <div className="table-scroll grid-scroll">
          <table className="table grid-table">
            <thead><tr>
              <th className="sticky-col">{t('lines.costCenter')}</th>
              <th>{t('lines.account')}</th>
              {MONTH_SHORT[lang].map((m) => <th key={m} className="r">{m}</th>)}
              <th className="r">{t('common.total')}</th>
              <th />
            </tr></thead>
            <tbody>
              {visible.map((l) => {
                const months = monthsOf(l);
                const total = months.reduce((a, b) => a + b, 0);
                return (
                  <tr key={l.id} className={drafts[l.id] ? 'is-dirty' : ''}>
                    <td className="sticky-col">
                      <b>{l.costCenterCode}</b> <span className="muted small">{l.costCenterName}</span>
                      <div className="muted small">{l.departmentName}</div>
                    </td>
                    <td>
                      <span className="acc-code">{l.accountCode}</span> {l.accountName}
                      {l.accountType === 'CAPEX' && <span className="badge badge-neutral ml-4">CAPEX</span>}
                      {l.description && l.description !== l.accountName && <div className="muted small">{l.description}</div>}
                    </td>
                    {months.map((v, i) => (
                      <td key={i} className="r num cell">
                        {l.canEdit ? <AmountInput value={v} onChange={(n) => setMonth(l, i, n)} /> : money(v, locale)}
                      </td>
                    ))}
                    <td className="r num"><b>{money(total, locale)}</b></td>
                    <td className="r">
                      {l.canEdit && (
                        <button type="button" className="icon-btn" title={t('lines.deleteLine')} aria-label={t('lines.deleteLine')} onClick={async () => {
                          if (!window.confirm(t('common.confirmDelete'))) return;
                          try { await api('DELETE', `/budgets/${budget.id}/lines/${l.id}`); await reload(); onChanged(); } catch (e) { setSaveError(e); }
                        }}><Icon name="trash" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td className="sticky-col"><b>{t('common.total')}</b></td><td />
              {monthTotals.map((v, i) => <td key={i} className="r num"><b>{money(v, locale)}</b></td>)}
              <td className="r num"><b>{money(grand, locale)}</b></td><td />
            </tr></tfoot>
          </table>
        </div>
      )}
      {adding && (
        <AddLineModal budget={budget} defaultDepartment={departmentId} onClose={() => setAdding(false)}
          onAdded={async () => { setAdding(false); await reload(); onChanged(); }} />
      )}
    </Card>
  );
}

function AmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className={`cell-input${text !== null && parseAmount(text) === null ? ' invalid' : ''}`}
      inputMode="decimal"
      value={text ?? money(value, locale)}
      onFocus={(e) => { setText(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = text === null ? value : parseAmount(text);
        if (n !== null && n !== value) onChange(n);
        setText(null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function AddLineModal({ budget, defaultDepartment, onClose, onAdded }: {
  budget: BudgetDetailDto; defaultDepartment: number | ''; onClose: () => void; onAdded: () => void;
}) {
  const { t } = useI18n();
  const { data: ccs } = useAsync(() => api<CostCenterDto[]>('GET', '/cost-centers'), []);
  const { data: accounts } = useAsync(() => api<AccountDto[]>('GET', '/accounts'), []);
  const editableDepts = new Set(budget.departments.filter((d) => d.canEdit).map((d) => d.departmentId));
  const options = (ccs ?? []).filter((c) => c.isActive && editableDepts.has(c.departmentId) && (!defaultDepartment || c.departmentId === defaultDepartment));
  const [cc, setCc] = useState('');
  const [account, setAccount] = useState('');
  const [description, setDescription] = useState('');
  const [annual, setAnnual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ccValue = cc || (options[0] ? String(options[0].id) : '');
  const accValue = account || (accounts?.[0] ? String(accounts[0].id) : '');

  const submit = async () => {
    setBusy(true); setError(null);
    const total = parseAmount(annual) ?? 0;
    const each = Math.floor((total / 12) * 100) / 100;
    const months = Array.from({ length: 12 }, (_, i) => (i === 11 ? Math.round((total - each * 11) * 100) / 100 : each));
    try {
      await api('POST', `/budgets/${budget.id}/lines`, { costCenterId: Number(ccValue), accountId: Number(accValue), description, months });
      onAdded();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={t('lines.newLine')} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!ccValue || !accValue} onClick={submit}>{t('common.add')}</Button>
    </>}>
      <Field label={t('lines.costCenter')}>
        {(id) => <Select id={id} value={ccValue} onChange={(e) => setCc(e.target.value)} options={options.map((c) => ({ value: c.id, label: `${c.code} · ${c.name} (${c.departmentName})` }))} />}
      </Field>
      <Field label={t('lines.account')}>
        {(id) => <Select id={id} value={accValue} onChange={(e) => setAccount(e.target.value)} options={(accounts ?? []).filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (${a.type})` }))} />}
      </Field>
      <Field label={t('lines.description')}>{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Field label={t('lines.annualAmount')} hint={t('lines.fillEvenly')}>{(id) => <Input id={id} inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />}</Field>
      <ErrorMessage error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ history */

function History({ budgetId, version }: { budgetId: number; version: number }) {
  const { t, locale } = useI18n();
  const { data, loading, error } = useAsync(() => api<BudgetEventDto[]>('GET', `/budgets/${budgetId}/events`), [budgetId, version]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!data?.length) return <Empty>{t('budgets.noHistory')}</Empty>;
  return (
    <Card>
      <ol className="timeline">
        {data.map((e) => (
          <li key={e.id} className={`tl-${e.action}`}>
            <div className="tl-head">
              <b>{t(`events.${e.action}` as TKey)}</b>
              {e.departmentName && <span className="badge badge-neutral">{e.departmentName}</span>}
              <span className="muted small">{e.userName} · {date(e.createdAt, locale, true)}</span>
            </div>
            {e.comment && <div className="tl-comment">{e.comment}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

