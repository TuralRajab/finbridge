import { useMemo, useState } from 'react';
import type { AccountDto, CostCenterDto, CurrencyDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';
import { BulkImportButton } from '../../components/BulkImportDialog';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date } from '../../lib/format';
import { treeOptions, useDisplayName, useMasterData } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-org.css';

const az = {
  title: 'Xərc mərkəzləri',
  subtitle: 'Büdcə və xərclərin uçota alındığı vahidlər. Hər xərc mərkəzi struktur vahidinə bağlıdır və onun büdcə bölməsinə düşür.',
  newCc: 'Yeni xərc mərkəzi', editTitle: 'Xərc mərkəzini redaktə et',
  unitPath: 'Struktur vahidi', validity: 'Qüvvədədir', restricted: 'Hesab məhdudiyyəti', allAccounts: 'Bütün hesablar', nAccounts: '{n} hesab',
  allUnits: 'Bütün vahidlər', allStatus: 'Hamısı', onlyActive: 'Yalnız aktiv', onlyInactive: 'Yalnız deaktiv', includeSub: 'alt vahidlər daxil',
  count: '{n} xərc mərkəzi', from: '{d}-dən', to: '{d}-dək', always: 'Müddətsiz',
  noOwner: '— Təyin edilməyib —', ownerHint: 'Büdcəni hazırlayan və sorğuları təsdiqləyən şəxs.', responsibleHint: 'Gündəlik nəzarətə cavabdeh şəxs.',
  unitHint: 'Xərc mərkəzi bu vahidin büdcə bölməsinə daxil edilir.',
  restrictTitle: 'İcazəli hesablar', restrictHint: 'Heç biri seçilməyibsə, bütün büdcə hesablarına icazə verilir.',
  selectShown: 'Görünənləri seç', clear: 'Təmizlə', selected: '{n} seçilib', noAccounts: 'Hesab tapılmadı.',
  confirmDeactivate: '{code} xərc mərkəzi deaktiv edilsin? Yeni büdcə sətirləri və sorğular üçün seçilə bilməz.',
  dateOrder: 'Bitmə tarixi başlama tarixindən əvvəl ola bilməz.',
  noMatch: 'Filtrə uyğun xərc mərkəzi yoxdur.',
};
const TEXT = {
  az,
  en: {
    title: 'Cost centers',
    subtitle: 'Units where budgets and spend are recorded. Each cost center belongs to an org unit and rolls up into its budget section.',
    newCc: 'New cost center', editTitle: 'Edit cost center',
    unitPath: 'Org unit', validity: 'Validity', restricted: 'Account restriction', allAccounts: 'All accounts', nAccounts: '{n} accounts',
    allUnits: 'All units', allStatus: 'All', onlyActive: 'Active only', onlyInactive: 'Inactive only', includeSub: 'incl. sub-units',
    count: '{n} cost centers', from: 'from {d}', to: 'until {d}', always: 'Open-ended',
    noOwner: '— Not assigned —', ownerHint: 'Prepares the budget and approves requests.', responsibleHint: 'Responsible for day-to-day control.',
    unitHint: 'The cost center is included in this unit’s budget section.',
    restrictTitle: 'Allowed accounts', restrictHint: 'If none are selected, all budget accounts are allowed.',
    selectShown: 'Select shown', clear: 'Clear', selected: '{n} selected', noAccounts: 'No accounts found.',
    confirmDeactivate: 'Deactivate cost center {code}? It can no longer be used for new budget lines and requests.',
    dateOrder: 'The end date cannot be before the start date.',
    noMatch: 'No cost centers match the filter.',
  } satisfies typeof az,
};

interface Form {
  code: string; name: string; description: string; orgUnitId: string; ownerUserId: string; responsibleUserId: string;
  currency: string; validFrom: string; validTo: string; isActive: boolean; allowedAccountIds: number[];
}

export function CostCentersPage() {
  const L = useLocal(TEXT);
  const { t, lang, locale } = useI18n();
  const { can, user } = useAuth();
  const dn = useDisplayName();
  const canManage = can('org.manage');
  const md = useMasterData({ users: true });
  const currencies = useAsync(() => api<CurrencyDto[]>('GET', '/company/currencies'), []);
  const base = user?.company?.baseCurrency ?? 'AZN';

  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [editing, setEditing] = useState<{ row: CostCenterDto | null; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [rowError, setRowError] = useState<unknown>(null);

  const units = md.data?.units ?? [];
  const ccs = md.data?.costCenters ?? [];
  const users = (md.data?.users ?? []).filter((u) => u.isActive);
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const subtree = useMemo(() => {
    if (!unit) return null;
    const out = new Set<number>([Number(unit)]);
    let grew = true;
    while (grew) { grew = false; for (const u of units) if (u.parentId && out.has(u.parentId) && !out.has(u.id)) { out.add(u.id); grew = true; } }
    return out;
  }, [unit, units]);

  const rows = ccs.filter((c) => {
    const q = query.trim().toLocaleLowerCase();
    return (!q || `${c.code} ${c.name} ${c.ownerName ?? ''} ${c.responsibleName ?? ''} ${c.orgUnitName}`.toLocaleLowerCase().includes(q))
      && (!subtree || subtree.has(c.orgUnitId))
      && (!status || (status === 'active') === c.isActive);
  });

  const unitPath = (c: CostCenterDto) => {
    const u = unitById.get(c.orgUnitId);
    if (!u) return c.orgUnitName;
    return [...u.path.slice(1), dn(u)].join(' › ') || dn(u);
  };

  const userOptions = [{ value: '', label: L.noOwner }, ...users.map((u) => ({ value: String(u.id), label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}` }))];
  const unitOptions = treeOptions(units, dn, (u) => u.isActive).map((o) => ({ value: String(o.value), label: o.label.replace(/^( +)/, (s) => '  '.repeat(s.length / 2)) }));

  const openNew = () => {
    setFormError(null);
    setEditing({ row: null, form: { code: '', name: '', description: '', orgUnitId: unit || '', ownerUserId: '', responsibleUserId: '', currency: base, validFrom: '', validTo: '', isActive: true, allowedAccountIds: [] } });
  };
  const openEdit = (c: CostCenterDto) => {
    setFormError(null);
    setEditing({ row: c, form: {
      code: c.code, name: c.name, description: c.description ?? '', orgUnitId: String(c.orgUnitId), ownerUserId: c.ownerUserId ? String(c.ownerUserId) : '',
      responsibleUserId: c.responsibleUserId ? String(c.responsibleUserId) : '', currency: c.currency, validFrom: c.validFrom ?? '', validTo: c.validTo ?? '',
      isActive: c.isActive, allowedAccountIds: [...c.allowedAccountIds],
    } });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  const dateError = editing && editing.form.validFrom && editing.form.validTo && editing.form.validTo < editing.form.validFrom ? L.dateOrder : undefined;

  const save = async () => {
    if (!editing || dateError) return;
    const f = editing.form;
    setBusy(true); setFormError(null);
    const body = {
      code: f.code.trim(), name: f.name.trim(), description: f.description.trim() || null, orgUnitId: Number(f.orgUnitId),
      ownerUserId: f.ownerUserId ? Number(f.ownerUserId) : null, responsibleUserId: f.responsibleUserId ? Number(f.responsibleUserId) : null,
      currency: f.currency || undefined, validFrom: f.validFrom || null, validTo: f.validTo || null, isActive: f.isActive, allowedAccountIds: f.allowedAccountIds,
    };
    try {
      if (editing.row) await api('PATCH', `/cost-centers/${editing.row.id}`, body);
      else await api('POST', '/cost-centers', body);
      setEditing(null);
      await md.reload();
    } catch (e) { setFormError(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!editing?.row || !window.confirm(t('common.confirmDelete'))) return;
    setBusy(true); setFormError(null);
    try { await api('DELETE', `/cost-centers/${editing.row.id}`); setEditing(null); await md.reload(); } catch (e) { setFormError(e); } finally { setBusy(false); }
  };
  const toggleActive = async (c: CostCenterDto) => {
    if (c.isActive && !window.confirm(fmt(L.confirmDeactivate, { code: c.code }))) return;
    setRowError(null);
    try { await api('PATCH', `/cost-centers/${c.id}`, { isActive: !c.isActive }); await md.reload(); } catch (e) { setRowError(e); }
  };

  const validity = (c: CostCenterDto) => {
    if (!c.validFrom && !c.validTo) return <span className="muted">{L.always}</span>;
    if (c.validFrom && c.validTo) return <span className="num">{date(c.validFrom, locale)} – {date(c.validTo, locale)}</span>;
    return <span className="num">{c.validFrom ? fmt(L.from, { d: date(c.validFrom, locale) }) : fmt(L.to, { d: date(c.validTo, locale) })}</span>;
  };

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<>
        {can('excel.export') && <ExportButton path="/export/cost-centers" filename="cost-centers.xlsx" />}
        {canManage && <BulkImportButton kind="COST_CENTERS" onDone={() => void md.reload()} />}
        {canManage && <Button variant="primary" onClick={openNew}><Icon name="plus" /> {L.newCc}</Button>}
      </>} />
      <ErrorMessage error={rowError} />
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select aria-label={L.unitPath} value={unit} onChange={(e) => setUnit(e.target.value)}
            options={[{ value: '', label: L.allUnits }, ...treeOptions(units, dn).map((o) => ({ value: String(o.value), label: o.label.replace(/^( +)/, (s) => '  '.repeat(s.length / 2)) }))]} />
          <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
            options={[{ value: '', label: L.allStatus }, { value: 'active', label: L.onlyActive }, { value: 'inactive', label: L.onlyInactive }]} />
          {unit && <span className="muted small">({L.includeSub})</span>}
          <span className="toolbar-right muted small">{fmt(L.count, { n: rows.length })}</span>
        </div>
        {md.loading && !md.data ? <Spinner /> : md.error ? <div className="card-body"><ErrorMessage error={md.error} /></div> : rows.length === 0 ? <Empty>{ccs.length ? L.noMatch : t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.code')}</th><th>{t('common.name')}</th><th>{L.unitPath}</th><th>{t('common.section')}</th>
                  <th>{t('common.owner')}</th><th>{t('common.responsible')}</th><th>{t('common.currency')}</th><th>{L.validity}</th>
                  <th className="r">{L.restricted}</th><th>{t('common.status')}</th>{canManage && <th className="r">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={`tree-row${c.isActive ? '' : ' is-inactive'}`}>
                    <td><span className="acc-code">{c.code}</span></td>
                    <td>{c.name}{c.description && <span className="cell-sub">{c.description}</span>}</td>
                    <td className="small">{unitPath(c)}</td>
                    <td>{c.sectionName}</td>
                    <td>{c.ownerName ?? <span className="muted">—</span>}</td>
                    <td>{c.responsibleName ?? <span className="muted">—</span>}</td>
                    <td>{c.currency}</td>
                    <td className="small">{validity(c)}</td>
                    <td className="r num">{c.allowedAccountIds.length ? <Badge tone="warning">{fmt(L.nAccounts, { n: c.allowedAccountIds.length })}</Badge> : <span className="muted">{L.allAccounts}</span>}</td>
                    <td>{c.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>}</td>
                    {canManage && (
                      <td className="r">
                        <span className="row-actions">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>{t('common.edit')}</Button>
                          <Button size="sm" variant={c.isActive ? 'ghost' : 'success'} onClick={() => toggleActive(c)}>{c.isActive ? t('common.deactivate') : t('common.activate')}</Button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal wide title={editing.row ? `${L.editTitle} · ${editing.row.code}` : L.newCc} onClose={() => setEditing(null)} footer={<>
          {editing.row && <Button variant="danger" className="mr-auto" onClick={remove} disabled={busy}><Icon name="trash" /> {t('common.delete')}</Button>}
          <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={save} disabled={!editing.form.code.trim() || !editing.form.name.trim() || !editing.form.orgUnitId || !!dateError}>
            {editing.row ? t('common.save') : t('common.create')}
          </Button>
        </>}>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid-2">
              <Field label={t('common.code')}>{(id) => <Input id={id} required maxLength={30} value={editing.form.code} onChange={(e) => set('code', e.target.value)} />}</Field>
              <Field label={t('common.name')}>{(id) => <Input id={id} required maxLength={200} value={editing.form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
            </div>
            <Field label={t('common.unit')} hint={L.unitHint}>
              {(id) => <Select id={id} required value={editing.form.orgUnitId} onChange={(e) => set('orgUnitId', e.target.value)} options={[{ value: '', label: t('common.select') }, ...unitOptions]} />}
            </Field>
            <div className="grid-2">
              <Field label={t('common.owner')} hint={L.ownerHint}>{(id) => <Select id={id} value={editing.form.ownerUserId} onChange={(e) => set('ownerUserId', e.target.value)} options={userOptions} />}</Field>
              <Field label={t('common.responsible')} hint={L.responsibleHint}>{(id) => <Select id={id} value={editing.form.responsibleUserId} onChange={(e) => set('responsibleUserId', e.target.value)} options={userOptions} />}</Field>
              <Field label={t('common.currency')}>
                {(id) => <Select id={id} value={editing.form.currency} onChange={(e) => set('currency', e.target.value)}
                  options={(currencies.data ?? [{ code: editing.form.currency || base, nameAz: '', nameEn: '', symbol: '', decimals: 2 }]).map((c) => ({ value: c.code, label: c.nameAz ? `${c.code} · ${lang === 'en' ? c.nameEn : c.nameAz}` : c.code }))} />}
              </Field>
              <div />
              <Field label={t('common.validFrom')}>{(id) => <Input id={id} type="date" value={editing.form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />}</Field>
              <Field label={t('common.validTo')} error={dateError}>{(id) => <Input id={id} type="date" value={editing.form.validTo} onChange={(e) => set('validTo', e.target.value)} />}</Field>
            </div>
            <Field label={t('common.description')}>
              {(id) => <textarea id={id} className="input textarea" rows={2} maxLength={500} value={editing.form.description} onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <AccountPicker accounts={md.data?.accounts ?? []} value={editing.form.allowedAccountIds} onChange={(v) => set('allowedAccountIds', v)} />
            <label className="check"><input type="checkbox" checked={editing.form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> {t('common.active')}</label>
            <button type="submit" hidden />
          </form>
          <ErrorMessage error={formError} />
        </Modal>
      )}
    </>
  );
}

/** Multi-select of postable leaf accounts, grouped by parent, with search. Empty selection = all allowed. */
function AccountPicker({ accounts, value, onChange }: { accounts: AccountDto[]; value: number[]; onChange: (v: number[]) => void }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const [q, setQ] = useState('');
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const selected = new Set(value);
  const leaves = accounts.filter((a) => !a.isGroup && (a.isActive || selected.has(a.id)));
  const needle = q.trim().toLocaleLowerCase();
  const shown = leaves.filter((a) => !needle || `${a.code} ${a.name} ${a.nameEn ?? ''}`.toLocaleLowerCase().includes(needle));
  const groups: { parent: AccountDto | undefined; items: AccountDto[] }[] = [];
  for (const a of shown) {
    const last = groups[groups.length - 1];
    if (last && last.parent?.id === a.parentId) last.items.push(a);
    else groups.push({ parent: a.parentId ? byId.get(a.parentId) : undefined, items: [a] });
  }
  const toggle = (id: number, on: boolean) => onChange(on ? [...value, id] : value.filter((x) => x !== id));
  return (
    <fieldset className="fieldset">
      <legend>{L.restrictTitle}</legend>
      <p className="hint" style={{ marginBottom: 8 }}>{L.restrictHint}</p>
      <div className="picker">
        <div className="picker-head">
          <Input type="search" placeholder={t('common.search')} aria-label={`${L.restrictTitle}: ${t('common.search')}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => onChange([...new Set([...value, ...shown.map((a) => a.id)])])}>{L.selectShown}</Button>
          <Button size="sm" variant="ghost" disabled={!value.length} onClick={() => onChange([])}>{L.clear}</Button>
        </div>
        <div className="picker-list">
          {groups.length === 0 ? <div className="picker-item muted">{L.noAccounts}</div> : groups.map((g, i) => (
            <div key={`${g.parent?.id ?? 'root'}-${i}`}>
              {g.parent && <div className="picker-group">{g.parent.code} · {dn(g.parent)}</div>}
              {g.items.map((a) => (
                <label key={a.id} className="picker-item">
                  <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                  <span className="acc-code">{a.code}</span>
                  <span>{dn(a)}</span>
                  {!a.isActive && <Badge tone="muted">{t('common.inactive')}</Badge>}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="picker-foot">{value.length ? fmt(L.selected, { n: value.length }) : L.allAccounts}</div>
      </div>
    </fieldset>
  );
}
