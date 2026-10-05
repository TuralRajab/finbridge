import { useMemo, useState } from 'react';
import type { AccountDto, AccountType, CurrencyDto, ExpenseClass } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useDisplayName } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import { ACCOUNT_TYPE_TEXT, ClassBadge } from '../setup/templateView';
import '../../styles/admin-org.css';

const az = {
  title: 'Hesablar planı',
  subtitle: 'Büdcələşdirmə və sorğular üçün idarəetmə hesabları. Xərc sinfi (OPEX/CAPEX) yuxarı qrupdan miras alınır.',
  newAccount: 'Yeni hesab', addChild: 'Alt hesab', editTitle: 'Hesabı redaktə et',
  account: 'Hesab', type: 'Növ', cls: 'Xərc sinfi', kind: 'Qrup / hesab', group: 'Qrup', leaf: 'Hesab',
  budgeting: 'Büdcə', requests: 'Sorğu', allType: 'Bütün növlər', allClass: 'Bütün siniflər', showInactive: 'Deaktivləri göstər',
  expandAll: 'Hamısını aç', collapseAll: 'Hamısını bağla',
  summary: '{n} hesab · {leaf} büdcə hesabı · {inactive} deaktiv',
  parent: 'Yuxarı hesab', noParent: '— Yuxarı səviyyə (qrup) —', parentHint: 'Postinqi olmayan hesab alt hesab əlavə edildikdə avtomatik qrupa çevrilir.',
  category: 'Kateqoriya', inheritClass: 'Yuxarıdan miras al', inheritedFrom: 'Miras: {cls}', currency: 'Valyuta', companyCurrency: 'Şirkətin əsas valyutası',
  isGroup: 'Qrup hesabı (birbaşa büdcələşdirilmir)', allowBudgeting: 'Büdcələşdirməyə icazə', allowRequests: 'Sorğulara icazə', active: 'Aktiv',
  sortOrder: 'Sıra', confirmDeactivate: '{code} hesabı deaktiv edilsin? Mövcud məlumatlar qalır, yeni büdcə və sorğularda seçilə bilməz.',
  readOnly: 'Hesablar planını yalnız maliyyə meneceri və ya administrator dəyişə bilər.',
  noMatch: 'Filtrə uyğun hesab tapılmadı.',
};
const TEXT = {
  az,
  en: {
    title: 'Chart of accounts',
    subtitle: 'Management accounts used for budgeting and requests. The expense class (OPEX/CAPEX) is inherited from the parent group.',
    newAccount: 'New account', addChild: 'Sub-account', editTitle: 'Edit account',
    account: 'Account', type: 'Type', cls: 'Expense class', kind: 'Group / account', group: 'Group', leaf: 'Account',
    budgeting: 'Budget', requests: 'Requests', allType: 'All types', allClass: 'All classes', showInactive: 'Show inactive',
    expandAll: 'Expand all', collapseAll: 'Collapse all',
    summary: '{n} accounts · {leaf} budget accounts · {inactive} inactive',
    parent: 'Parent account', noParent: '— Top level (group) —', parentHint: 'An account without postings becomes a group automatically when a sub-account is added.',
    category: 'Category', inheritClass: 'Inherit from parent', inheritedFrom: 'Inherited: {cls}', currency: 'Currency', companyCurrency: 'Company base currency',
    isGroup: 'Group account (not budgeted directly)', allowBudgeting: 'Allow budgeting', allowRequests: 'Allow requests', active: 'Active',
    sortOrder: 'Sort order', confirmDeactivate: 'Deactivate account {code}? Existing data stays; it can no longer be chosen in new budgets and requests.',
    readOnly: 'Only a finance manager or administrator can change the chart of accounts.',
    noMatch: 'No accounts match the filter.',
  } satisfies typeof az,
};

const TYPES: AccountType[] = ['REVENUE', 'EXPENSE', 'CAPEX', 'OTHER'];

interface Form {
  parentId: string; code: string; name: string; nameEn: string; description: string; accountType: AccountType; category: string;
  expenseClass: '' | ExpenseClass; isGroup: boolean; allowBudgeting: boolean; allowRequests: boolean; currency: string; isActive: boolean; sortOrder: string;
}

const toForm = (a: AccountDto): Form => ({
  parentId: a.parentId ? String(a.parentId) : '', code: a.code, name: a.name, nameEn: a.nameEn ?? '', description: a.description ?? '', accountType: a.accountType,
  category: a.category ?? '', expenseClass: a.expenseClass ?? '', isGroup: a.isGroup, allowBudgeting: a.allowBudgeting, allowRequests: a.allowRequests,
  currency: a.currency ?? '', isActive: a.isActive, sortOrder: String(a.sortOrder),
});

/** Effective expense class: own value or the nearest ancestor's. */
export function effectiveClass(accounts: AccountDto[]): Map<number, { cls: ExpenseClass | null; inherited: boolean }> {
  const by = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<number, { cls: ExpenseClass | null; inherited: boolean }>();
  for (const a of accounts) {
    let cur: AccountDto | undefined = a;
    let hops = 0;
    while (cur && !cur.expenseClass && cur.parentId) { cur = by.get(cur.parentId); hops++; }
    out.set(a.id, { cls: cur?.expenseClass ?? null, inherited: hops > 0 && !!cur?.expenseClass });
  }
  return out;
}

export function AccountsPage() {
  const L = useLocal(TEXT);
  const types = useLocal(ACCOUNT_TYPE_TEXT);
  const { t, lang } = useI18n();
  const { can, user } = useAuth();
  const dn = useDisplayName();
  const canManage = can('coa.manage');
  const { data, loading, error, reload } = useAsync(() => api<AccountDto[]>('GET', '/accounts'), []);
  const currencies = useAsync(() => api<CurrencyDto[]>('GET', '/company/currencies'), []);

  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [cls, setCls] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ row: AccountDto | null; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [rowError, setRowError] = useState<unknown>(null);

  const accounts = data ?? [];
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const classes = useMemo(() => effectiveClass(accounts), [accounts]);
  const hasChildren = useMemo(() => new Set(accounts.map((a) => a.parentId).filter((x): x is number => x !== null)), [accounts]);

  const filtering = !!(query || type || cls || !showInactive);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const match = (a: AccountDto) =>
      (!q || `${a.code} ${a.name} ${a.nameEn ?? ''} ${a.category ?? ''}`.toLocaleLowerCase().includes(q))
      && (!type || a.accountType === type) && (!cls || classes.get(a.id)?.cls === cls) && (showInactive || a.isActive);
    if (filtering) {
      // matches plus their ancestors, so the hierarchy stays readable
      const keep = new Set<number>();
      for (const a of accounts) if (match(a)) { let cur: AccountDto | undefined = a; while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; } }
      return accounts.filter((a) => keep.has(a.id)).map((a) => ({ a, hit: match(a) }));
    }
    const hidden = (a: AccountDto): boolean => { let p = a.parentId; while (p) { if (collapsed.has(p)) return true; p = byId.get(p)?.parentId ?? null; } return false; };
    return accounts.filter((a) => !hidden(a)).map((a) => ({ a, hit: true }));
  }, [accounts, byId, classes, query, type, cls, showInactive, collapsed, filtering]);

  const leafCount = accounts.filter((a) => !a.isGroup).length;
  const inactiveCount = accounts.filter((a) => !a.isActive).length;

  const descendants = (id: number): Set<number> => {
    const out = new Set<number>([id]);
    let grew = true;
    while (grew) { grew = false; for (const a of accounts) if (a.parentId && out.has(a.parentId) && !out.has(a.id)) { out.add(a.id); grew = true; } }
    return out;
  };

  const openNew = (parent?: AccountDto) => {
    setFormError(null);
    setEditing({ row: null, form: {
      parentId: parent ? String(parent.id) : '', code: parent ? `${parent.code}-` : '', name: '', nameEn: '', description: '',
      accountType: parent?.accountType ?? 'EXPENSE', category: parent?.category ?? '', expenseClass: '', isGroup: !parent, allowBudgeting: true, allowRequests: true,
      currency: '', isActive: true, sortOrder: '0',
    } });
  };
  const openEdit = (a: AccountDto) => { setFormError(null); setEditing({ row: a, form: toForm(a) }); };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    setBusy(true); setFormError(null);
    const body = {
      parentId: f.parentId ? Number(f.parentId) : null, code: f.code.trim(), name: f.name.trim(), nameEn: f.nameEn.trim() || null,
      description: f.description.trim() || null, accountType: f.accountType, category: f.category.trim() || null, expenseClass: f.expenseClass || null,
      isGroup: f.isGroup, allowBudgeting: f.allowBudgeting, allowRequests: f.allowRequests, currency: f.currency || null, isActive: f.isActive,
      sortOrder: Number(f.sortOrder) || 0,
    };
    try {
      if (editing.row) await api('PATCH', `/accounts/${editing.row.id}`, body);
      else await api('POST', '/accounts', body);
      setEditing(null);
      await reload();
    } catch (e) { setFormError(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!editing?.row || !window.confirm(t('common.confirmDelete'))) return;
    setBusy(true); setFormError(null);
    try { await api('DELETE', `/accounts/${editing.row.id}`); setEditing(null); await reload(); } catch (e) { setFormError(e); } finally { setBusy(false); }
  };
  const toggleActive = async (a: AccountDto) => {
    if (a.isActive && !window.confirm(fmt(L.confirmDeactivate, { code: a.code }))) return;
    setRowError(null);
    try { await api('PATCH', `/accounts/${a.id}`, { isActive: !a.isActive }); await reload(); } catch (e) { setRowError(e); }
  };

  const parentOptions = useMemo(() => {
    if (!editing) return [];
    const exclude = editing.row ? descendants(editing.row.id) : new Set<number>();
    return [{ value: '', label: L.noParent }, ...accounts.filter((a) => !exclude.has(a.id)).map((a) => ({
      value: String(a.id), label: `${'  '.repeat(a.level)}${a.code} · ${dn(a)}${a.isGroup ? '' : ` (${L.leaf.toLowerCase()})`}`,
    }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.row, accounts, lang]);

  const parentClass = editing?.form.parentId ? classes.get(Number(editing.form.parentId))?.cls ?? null : null;
  const yn = (v: boolean) => <span className={`yes-no ${v ? 'is-yes' : 'is-no'}`}>{v ? '✓' : '—'} <span className="sr-only">{v ? t('common.yes') : t('common.no')}</span></span>;

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<>
        {can('excel.export') && <ExportButton path="/export/accounts" filename="chart-of-accounts.xlsx" />}
        {canManage && <Button variant="primary" onClick={() => openNew()}><Icon name="plus" /> {L.newAccount}</Button>}
      </>} />
      {!canManage && user && <p className="hint mb-8">{L.readOnly}</p>}
      <ErrorMessage error={rowError} />
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select aria-label={L.type} value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto', height: 34 }}
            options={[{ value: '', label: L.allType }, ...TYPES.map((x) => ({ value: x, label: types[x] }))]} />
          <Select aria-label={L.cls} value={cls} onChange={(e) => setCls(e.target.value)} style={{ width: 'auto', height: 34 }}
            options={[{ value: '', label: L.allClass }, { value: 'OPEX', label: t('expenseClass.OPEX') }, { value: 'CAPEX', label: t('expenseClass.CAPEX') }]} />
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {L.showInactive}</label>
          {!filtering && <>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>{L.expandAll}</Button>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(hasChildren))}>{L.collapseAll}</Button>
          </>}
          <span className="toolbar-right muted small">{fmt(L.summary, { n: accounts.length, leaf: leafCount, inactive: inactiveCount })}</span>
        </div>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : visible.length === 0 ? <Empty>{accounts.length ? L.noMatch : t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{L.account}</th><th>{L.type}</th><th>{L.cls}</th><th>{L.kind}</th>
                  <th className="r">{L.budgeting}</th><th className="r">{L.requests}</th><th>{t('common.status')}</th>{canManage && <th className="r">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ a, hit }) => {
                  const isParent = hasChildren.has(a.id);
                  const open = !collapsed.has(a.id);
                  const c = classes.get(a.id);
                  return (
                    <tr key={a.id} className={`tree-row${a.isGroup ? ' tree-group' : ''}${a.isActive ? '' : ' is-inactive'}`} style={hit ? undefined : { opacity: 0.6 }}>
                      <td>
                        <div className="tree-name" style={{ paddingLeft: a.level * 18 }}>
                          {isParent && !filtering ? (
                            <button type="button" className={`tree-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-label={`${a.code}: ${open ? L.collapseAll : L.expandAll}`}
                              onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}>
                              <Icon name="chevron" size={14} />
                            </button>
                          ) : <span className="tree-spacer" />}
                          <span className="acc-code">{a.code}</span>
                          <span className="tree-label">{dn(a)}</span>
                          {a.category && <span className="muted small">· {a.category}</span>}
                        </div>
                      </td>
                      <td>{types[a.accountType]}</td>
                      <td><ClassBadge cls={c?.cls ?? null} inherited={c?.inherited} /></td>
                      <td>{a.isGroup ? <Badge tone="dark">{L.group}</Badge> : <Badge tone="muted">{L.leaf}</Badge>}</td>
                      <td className="r">{a.isGroup ? <span className="muted">—</span> : yn(a.allowBudgeting)}</td>
                      <td className="r">{a.isGroup ? <span className="muted">—</span> : yn(a.allowRequests)}</td>
                      <td>{a.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>}</td>
                      {canManage && (
                        <td className="r">
                          <span className="row-actions">
                            {a.isGroup && <Button size="sm" variant="ghost" onClick={() => openNew(a)} aria-label={`${L.addChild}: ${a.code}`}><Icon name="plus" /> {L.addChild}</Button>}
                            <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>{t('common.edit')}</Button>
                            <Button size="sm" variant={a.isActive ? 'ghost' : 'success'} onClick={() => toggleActive(a)}>{a.isActive ? t('common.deactivate') : t('common.activate')}</Button>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal wide title={editing.row ? `${L.editTitle} · ${editing.row.code}` : L.newAccount} onClose={() => setEditing(null)} footer={<>
          {editing.row && <Button variant="danger" className="mr-auto" onClick={remove} disabled={busy}><Icon name="trash" /> {t('common.delete')}</Button>}
          <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={save} disabled={!editing.form.code.trim() || !editing.form.name.trim()}>{editing.row ? t('common.save') : t('common.create')}</Button>
        </>}>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label={L.parent} hint={L.parentHint}>
              {(id) => <Select id={id} value={editing.form.parentId} options={parentOptions} onChange={(e) => {
                const p = byId.get(Number(e.target.value));
                setEditing((x) => (x ? { ...x, form: { ...x.form, parentId: e.target.value, accountType: !x.row && p ? p.accountType : x.form.accountType } } : x));
              }} />}
            </Field>
            <div className="grid-2">
              <Field label={t('common.code')}>{(id) => <Input id={id} required maxLength={30} value={editing.form.code} onChange={(e) => set('code', e.target.value)} />}</Field>
              <Field label={L.type}>{(id) => <Select id={id} value={editing.form.accountType} onChange={(e) => set('accountType', e.target.value as AccountType)} options={TYPES.map((x) => ({ value: x, label: types[x] }))} />}</Field>
              <Field label={t('common.name')}>{(id) => <Input id={id} required maxLength={200} value={editing.form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
              <Field label={t('common.nameEn')}>{(id) => <Input id={id} maxLength={200} value={editing.form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />}</Field>
              <Field label={L.cls} hint={!editing.form.expenseClass && parentClass ? fmt(L.inheritedFrom, { cls: parentClass }) : undefined}>
                {(id) => <Select id={id} value={editing.form.expenseClass} onChange={(e) => set('expenseClass', e.target.value as Form['expenseClass'])}
                  options={[{ value: '', label: L.inheritClass }, { value: 'OPEX', label: t('expenseClass.OPEX') }, { value: 'CAPEX', label: t('expenseClass.CAPEX') }]} />}
              </Field>
              <Field label={L.category}>{(id) => <Input id={id} maxLength={60} value={editing.form.category} onChange={(e) => set('category', e.target.value)} />}</Field>
              <Field label={L.currency}>
                {(id) => <Select id={id} value={editing.form.currency} onChange={(e) => set('currency', e.target.value)}
                  options={[{ value: '', label: L.companyCurrency }, ...(currencies.data ?? []).map((c) => ({ value: c.code, label: `${c.code} · ${lang === 'en' ? c.nameEn : c.nameAz}` }))]} />}
              </Field>
              <Field label={L.sortOrder}>{(id) => <Input id={id} type="number" value={editing.form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />}</Field>
            </div>
            <Field label={t('common.description')}>
              {(id) => <textarea id={id} className="input textarea" rows={2} maxLength={500} value={editing.form.description} onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <div className="check-grid">
              <label className="check"><input type="checkbox" checked={editing.form.isGroup} onChange={(e) => set('isGroup', e.target.checked)} /> {L.isGroup}</label>
              <label className="check"><input type="checkbox" checked={editing.form.allowBudgeting} disabled={editing.form.isGroup} onChange={(e) => set('allowBudgeting', e.target.checked)} /> {L.allowBudgeting}</label>
              <label className="check"><input type="checkbox" checked={editing.form.allowRequests} disabled={editing.form.isGroup} onChange={(e) => set('allowRequests', e.target.checked)} /> {L.allowRequests}</label>
              <label className="check"><input type="checkbox" checked={editing.form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> {L.active}</label>
            </div>
            <button type="submit" hidden />
          </form>
          <ErrorMessage error={formError} />
        </Modal>
      )}
    </>
  );
}
