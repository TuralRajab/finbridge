import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COMPANY_ROLES, DATA_SCOPES, PERMISSION_AREAS, PERMISSION_IMPLIES, type CompanyRoleDto, type DataScope, type Permission, type Role, type UserDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { NAV_SECTIONS } from '../../components/Layout';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import '../../styles/roles.css';

type BaseRole = Exclude<Role, 'SUPER_ADMIN'>;

const az = {
  title: 'Rollar və səlahiyyətlər',
  subtitle: 'Hər rol üçün hansı səhifələri görəcəyini, harada redaktə edəcəyini və hansı məlumatları görəcəyini təyin edin. Yeni rollar yaradın (məs. Nəzarətçi, Regional direktor).',
  tabEditor: 'Rollar',
  tabMatrix: 'Müqayisə cədvəli',
  system: 'Standart rollar',
  custom: 'Şirkətin rolları',
  newRole: 'Yeni rol',
  copy: 'Kopyala',
  users: '{n} istifadəçi',
  customized: 'Dəyişdirilib',
  locked: 'Kilidli',
  inactive: 'Deaktiv',
  code: 'Kod',
  codeHint: 'Latın hərfləri, rəqəm, _ və -. Sonradan dəyişmir. Təsdiq axınlarında "Rol üzrə" təsdiqləyən kimi bu kod seçilir.',
  name: 'Ad',
  nameEn: 'Ad (ingiliscə)',
  description: 'Təsvir',
  baseRole: 'Əsas götürülən standart rol',
  baseHint: 'İstifadəçi təsdiq axınlarında "CEO", "CFO", "Maliyyə meneceri" mərhələləri üçün bu standart rol kimi sayılır. Səlahiyyətlərə təsir etmir.',
  scope: 'Məlumat görünürlüyü',
  scopes: {
    COMPANY: ['Bütün şirkət', 'Bütün departamentlərin, xərc mərkəzlərinin və sorğuların məlumatları.'],
    UNIT: ['Rəhbəri olduğu vahidlər', 'Rəhbər təyin olunduğu struktur vahidləri (bütün alt vahidlərlə) və sahibi olduğu xərc mərkəzləri.'],
    COST_CENTERS: ['Öz xərc mərkəzləri', 'Yalnız sahibi və ya məsulu olduğu xərc mərkəzləri.'],
    OWN: ['Yalnız öz sorğuları', 'Yalnız özünün yaratdığı sorğular; sorğunu öz vahidinin xərc mərkəzlərinə yarada bilər.'],
  },
  pages: 'Səhifələr və əməliyyatlar',
  pagesHint: 'Redaktə hüququ görmə hüququnu da verir. Təsdiq etmək rol səlahiyyəti deyil — təsdiq axınının mərhələsinə təyinatla verilir.',
  colPage: 'Səhifə / modul',
  colView: 'Görür',
  colEdit: 'Redaktə edir',
  colExtra: 'Əlavə əməliyyatlar',
  areas: {
    dashboard: ['İdarəetmə paneli', 'KPI, aylıq qrafik, təsdiqlərin vəziyyəti'],
    budgets: ['Büdcələr', 'Büdcə versiyaları, bölmələr və sətirlər'],
    changes: ['Büdcə dəyişiklikləri', 'Kilidli büdcəyə dəyişiklik sorğuları'],
    requests: ['Satınalma və xərc sorğuları', 'Sorğular və büdcə yoxlaması'],
    actuals: ['Faktiki xərclər', 'Fakt məlumatlarının daxil edilməsi və idxalı'],
    reports: ['Hesabatlar', 'Büdcə istifadəsi, təsdiq axınları, dəyişikliklər'],
    organization: ['Təşkilati struktur və xərc mərkəzləri', 'Vahidlər, növlər, peşə ailələri, vəzifələr, xərc mərkəzləri'],
    accounts: ['Hesablar planı və valyutalar', 'Hesablar, məzənnələr, maliyyə ayarları'],
    setup: ['Quraşdırma və sənaye şablonları', 'Şablonun tətbiqi'],
    workflows: ['Təsdiq axınları', 'Axınların konfiqurasiyası'],
    users: ['İstifadəçilər, rollar və səlahiyyətlər', 'İstifadəçilər, bu səhifə, başqalarının səlahiyyət ötürməsi'],
    company: ['Şirkət və lisenziya', 'Şirkət profili və büdcə nəzarəti ayarları'],
    audit: ['Audit jurnalı', 'Dəyişikliklər və təsdiq əməliyyatlarının tarixçəsi'],
    excel: ['Excel', 'İxrac və idxal (toplu idxal daxil)'],
  } as Record<string, [string, string]>,
  perms: {
    'budget.create': 'Büdcə yaratmaq',
    'budget.submit': 'Bölməni təqdim etmək',
    'budget.manage': 'Versiyanı göndərmək, kilidləmək, bölməni açmaq',
    'excel.export': 'Excel-ə ixrac',
    'excel.import': 'Excel-dən idxal',
  } as Record<string, string>,
  preview: 'Bu rolun menyusu',
  previewHint: 'İstifadəçi menyuda yalnız bu bölmələri görəcək.',
  roleUsers: 'Bu roldakı istifadəçilər',
  noUsers: 'Bu rolda istifadəçi yoxdur.',
  manageUsers: 'İstifadəçilərə rol təyin et',
  save: 'Yadda saxla',
  create: 'Rolu yarat',
  reset: 'Standarta qaytar',
  resetConfirm: 'Bu standart rolun səlahiyyətləri FinBridge-in standart dəyərlərinə qaytarılsın?',
  delete: 'Sil',
  deleteConfirm: 'Rol silinsin? Bu əməliyyat geri qaytarıla bilməz.',
  deleteBlocked: 'Rolu silmək üçün əvvəlcə istifadəçilərinə başqa rol təyin edin.',
  active: 'Aktiv',
  lockedNote: 'Administrator rolu həmişə bütün səlahiyyətlərə malikdir və dəyişdirilə bilməz — şirkət öz idarəetməsindən kənarda qala bilməz.',
  readOnly: 'Rolları dəyişmək üçün "İstifadəçilər və rollar — redaktə" səlahiyyəti lazımdır.',
  saved: 'Yadda saxlanıldı.',
  updated: 'Son dəyişiklik: {d}',
  presets: 'Tez seçim',
  presetViewAll: 'Hamısına baxış',
  presetNone: 'Hamısını təmizlə',
  copyFrom: 'Başqa roldan köçür…',
  unsaved: 'Yadda saxlanmamış dəyişikliklər var',
  approvalNote: 'Təsdiq hüququ: istifadəçi yalnız təsdiq axınının ona təyin olunan mərhələsində qərar verir. Rolu axında istifadə etmək üçün: Təsdiq axınları → mərhələ → "Rol üzrə".',
  workflowsLink: 'Təsdiq axınlarına keç',
  yes: 'Bəli',
  matrixLegend: 'G — görür, R — redaktə edir, + — əlavə əməliyyat',
};
type T = typeof az;
const TEXT: { az: T; en: T } = {
  az,
  en: {
    title: 'Roles & permissions',
    subtitle: 'Define for every role which pages it sees, where it may edit and which data it sees. Create your own roles (e.g. Supervisor, Regional director).',
    tabEditor: 'Roles',
    tabMatrix: 'Comparison matrix',
    system: 'Built-in roles',
    custom: 'Company roles',
    newRole: 'New role',
    copy: 'Duplicate',
    users: '{n} users',
    customized: 'Customised',
    locked: 'Locked',
    inactive: 'Inactive',
    code: 'Code',
    codeHint: 'Latin letters, digits, _ and -. Cannot change later. Approval workflows use this code for "By role" approvers.',
    name: 'Name',
    nameEn: 'Name (English)',
    description: 'Description',
    baseRole: 'Based on built-in role',
    baseHint: 'In approval workflows the user counts as this built-in role for "CEO", "CFO" and "Finance manager" steps. It does not change permissions.',
    scope: 'Data visibility',
    scopes: {
      COMPANY: ['Whole company', 'Data of all departments, cost centers and requests.'],
      UNIT: ['Units they head', 'Units the user is head of (with all sub-units) and cost centers they own.'],
      COST_CENTERS: ['Own cost centers', 'Only cost centers the user owns or is responsible for.'],
      OWN: ['Own requests only', 'Only requests the user created; may raise requests for cost centers of their own unit.'],
    },
    pages: 'Pages and actions',
    pagesHint: 'Edit rights include view rights. Approving is not a role permission — it comes from being assigned a workflow stage.',
    colPage: 'Page / module',
    colView: 'Sees',
    colEdit: 'Edits',
    colExtra: 'Additional actions',
    areas: {
      dashboard: ['Dashboard', 'KPIs, monthly chart, approval status'],
      budgets: ['Budgets', 'Budget versions, sections and lines'],
      changes: ['Budget changes', 'Change requests on locked budgets'],
      requests: ['Purchase & expense requests', 'Requests and funds check'],
      actuals: ['Actuals', 'Entering and importing actuals'],
      reports: ['Reports', 'Consumption, workflows, changes'],
      organization: ['Organisation & cost centers', 'Units, types, job families, positions, cost centers'],
      accounts: ['Chart of accounts & currencies', 'Accounts, exchange rates, financial settings'],
      setup: ['Setup & industry templates', 'Applying a template'],
      workflows: ['Approval workflows', 'Workflow configuration'],
      users: ['Users, roles & permissions', 'Users, this page, delegations of others'],
      company: ['Company & licence', 'Company profile and budget-control settings'],
      audit: ['Audit log', 'History of changes and approval actions'],
      excel: ['Excel', 'Export and import (incl. bulk import)'],
    },
    perms: {
      'budget.create': 'Create budgets',
      'budget.submit': 'Submit a section',
      'budget.manage': 'Submit / lock versions, reopen sections',
      'excel.export': 'Export to Excel',
      'excel.import': 'Import from Excel',
    },
    preview: "This role's menu",
    previewHint: 'Users will only see these sections in the menu.',
    roleUsers: 'Users with this role',
    noUsers: 'No users have this role.',
    manageUsers: 'Assign roles to users',
    save: 'Save',
    create: 'Create role',
    reset: 'Reset to default',
    resetConfirm: "Reset this built-in role's permissions to FinBridge defaults?",
    delete: 'Delete',
    deleteConfirm: 'Delete the role? This cannot be undone.',
    deleteBlocked: 'Assign its users another role before deleting it.',
    active: 'Active',
    lockedNote: 'The Administrator role always has every permission and cannot be changed — the company can never lock itself out.',
    readOnly: 'Changing roles needs the "Users & roles — edit" permission.',
    saved: 'Saved.',
    updated: 'Last change: {d}',
    presets: 'Quick select',
    presetViewAll: 'View everything',
    presetNone: 'Clear all',
    copyFrom: 'Copy from another role…',
    unsaved: 'You have unsaved changes',
    approvalNote: 'Approval rights: a user decides only on the workflow stage assigned to them. To use a role in a workflow: Approval workflows → stage → "By role".',
    workflowsLink: 'Go to approval workflows',
    yes: 'Yes',
    matrixLegend: 'S — sees, E — edits, + — additional actions',
  },
};

interface Draft { id: number | null; code: string; name: string; nameEn: string; description: string; baseRole: BaseRole; dataScope: DataScope; isActive: boolean; perms: Set<Permission> }

const toDraft = (r: CompanyRoleDto): Draft => ({
  id: r.id, code: r.code, name: r.name, nameEn: r.nameEn ?? '', description: r.description ?? '', baseRole: r.baseRole, dataScope: r.dataScope, isActive: r.isActive, perms: new Set(r.permissions),
});
const blank = (): Draft => ({ id: null, code: '', name: '', nameEn: '', description: '', baseRole: 'VIEWER', dataScope: 'UNIT', isActive: true, perms: new Set(['dashboard.view']) });

/** Permissions implied by `p` (edit → view), so the grid shows what the server will grant. */
const implied = (perms: Set<Permission>) => {
  const out = new Set(perms);
  for (const p of perms) for (const i of PERMISSION_IMPLIES[p] ?? []) out.add(i);
  out.add('masterdata.view');
  return out;
};

export function RolesPage() {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'editor' | 'matrix'>('editor');
  const roles = useAsync(() => api<CompanyRoleDto[]>('GET', '/roles'), []);
  const users = useAsync(() => api<UserDto[]>('GET', '/users'), []);
  const selectedId = params.get('role') === 'new' ? 'new' : Number(params.get('role')) || null;
  const select = (id: number | 'new') => setParams((p) => { const n = new URLSearchParams(p); n.set('role', String(id)); return n; }, { replace: true });

  useEffect(() => {
    if (!selectedId && roles.data?.length) select(roles.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.data, selectedId]);

  const label = (r: CompanyRoleDto) => (r.isSystem ? t(`roles.${r.code}` as TKey) : r.name);
  if (roles.loading && !roles.data) return <Spinner />;
  if (!roles.data) return <ErrorMessage error={roles.error} />;
  const current = selectedId === 'new' ? null : roles.data.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<>
        <Link className="btn btn-secondary" to="/admin/users"><Icon name="users" /> {L.manageUsers}</Link>
        {can('users.manage') && <Button variant="primary" onClick={() => { setTab('editor'); select('new'); }}><Icon name="plus" /> {L.newRole}</Button>}
      </>} />
      <Alert kind="info">{L.approvalNote} <Link to="/admin/workflows">{L.workflowsLink} →</Link></Alert>
      {!can('users.manage') && <Alert kind="warning">{L.readOnly}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'editor', label: L.tabEditor }, { value: 'matrix', label: L.tabMatrix }]} />
      {tab === 'matrix' ? <Matrix roles={roles.data} label={label} onOpen={(id) => { setTab('editor'); select(id); }} /> : (
        <div className="rl-layout">
          <aside className="rl-list" aria-label={L.tabEditor}>
            {[{ title: L.system, list: roles.data.filter((r) => r.isSystem) }, { title: L.custom, list: roles.data.filter((r) => !r.isSystem) }].map((g) => (
              <div key={g.title} className="rl-group">
                <div className="rl-group-title">{g.title}</div>
                {g.list.map((r) => (
                  <button key={r.id} type="button" className={`rl-item${r.id === selectedId ? ' is-active' : ''}${r.isActive ? '' : ' is-inactive'}`} onClick={() => select(r.id)}>
                    <span className="rl-item-name">{label(r)}</span>
                    <span className="rl-item-meta">
                      <code>{r.code}</code> · {fmt(L.users, { n: r.userCount })}
                      {r.isLocked && <Badge tone="dark">{L.locked}</Badge>}
                      {r.isCustomized && <Badge tone="warning">{L.customized}</Badge>}
                      {!r.isActive && <Badge tone="muted">{L.inactive}</Badge>}
                    </span>
                  </button>
                ))}
                {!g.list.length && <p className="muted small">—</p>}
              </div>
            ))}
          </aside>
          <Editor key={String(selectedId)} role={current} isNew={selectedId === 'new'} roles={roles.data} users={users.data ?? []} label={label}
            onSaved={async (id) => { await roles.reload(); await users.reload(); if (id) select(id); else setParams({}, { replace: true }); }}
            onCopy={(r) => { select('new'); setCopySource(r); }} />
        </div>
      )}
    </>
  );
}

// a tiny module-level hand-over for "duplicate": the next new-role editor starts from this role
let copySource: CompanyRoleDto | null = null;
function setCopySource(r: CompanyRoleDto) { copySource = r; }

function Editor({ role, isNew, roles, users, label, onSaved, onCopy }: {
  role: CompanyRoleDto | null; isNew: boolean; roles: CompanyRoleDto[]; users: UserDto[]; label: (r: CompanyRoleDto) => string;
  onSaved: (id: number | null) => Promise<void>; onCopy: (r: CompanyRoleDto) => void;
}) {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { can, refresh } = useAuth();
  const initial = useMemo(() => {
    if (isNew && copySource) {
      const d = toDraft(copySource);
      const src = copySource;
      copySource = null;
      return { ...d, id: null, code: `${src.code}_2`.slice(0, 30), name: `${label(src)} (2)`, nameEn: src.nameEn ? `${src.nameEn} (2)` : '', baseRole: src.baseRole };
    }
    return role ? toDraft(role) : blank();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role?.id, isNew]);
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  if (!isNew && !role) return <Card><p className="muted">—</p></Card>;
  const editable = can('users.manage') && !(role?.isLocked);
  const effective = implied(d.perms);
  const dirty = JSON.stringify({ ...d, perms: [...d.perms].sort() }) !== JSON.stringify({ ...initial, perms: [...initial.perms].sort() });

  const toggle = (perms: Permission[], on: boolean) => {
    const next = new Set(d.perms);
    for (const p of perms) { if (on) next.add(p); else next.delete(p); }
    // turning a view off also removes the edits that need it
    if (!on) for (const [k, v] of Object.entries(PERMISSION_IMPLIES)) if (v?.some((x) => perms.includes(x))) next.delete(k as Permission);
    setD({ ...d, perms: next });
    setOk(false);
  };
  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD({ ...d, [k]: v }); setOk(false); };

  const save = async () => {
    setBusy(true); setError(null); setOk(false);
    const body = { name: d.name.trim(), nameEn: d.nameEn.trim() || null, description: d.description.trim() || null, dataScope: d.dataScope, isActive: d.isActive, permissions: [...d.perms] };
    try {
      if (isNew) {
        const r = await api<CompanyRoleDto>('POST', '/roles', { ...body, code: d.code.trim(), baseRole: d.baseRole });
        await onSaved(r.id);
      } else {
        await api('PATCH', `/roles/${role!.id}`, role!.isSystem ? body : { ...body, baseRole: d.baseRole });
        await onSaved(role!.id);
        setOk(true);
      }
      await refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm(L.resetConfirm)) return;
    setBusy(true); setError(null);
    try { await api('POST', `/roles/${role!.id}/reset`); await onSaved(role!.id); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(L.deleteConfirm)) return;
    setBusy(true); setError(null);
    try { await api('DELETE', `/roles/${role!.id}`); await onSaved(null); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const members = role ? users.filter((u) => u.roleId === role.id || (!u.roleId && role.isSystem && u.roleCode === role.code)) : [];
  const menu = NAV_SECTIONS.map((s) => ({ title: t(s.title), items: s.items.filter((i) => i.permission !== 'platform.manage' && (i.any ?? [i.permission]).some((p) => effective.has(p))).map((i) => t(i.label)) }))
    .filter((s) => s.items.length);

  return (
    <div className="rl-editor">
      <Card
        title={isNew ? L.newRole : label(role!)}
        subtitle={role ? <>{role.isSystem ? L.system : L.custom} · <code>{role.code}</code>{role.updatedAt && <> · {fmt(L.updated, { d: date(role.updatedAt, locale, true) })}</>}</> : null}
        actions={<>
          {role && can('users.manage') && <Button size="sm" onClick={() => onCopy(role)}><Icon name="copy" /> {L.copy}</Button>}
          {role?.isSystem && !role.isLocked && can('users.manage') && <Button size="sm" disabled={!role.isCustomized || busy} onClick={reset}>{L.reset}</Button>}
          {role && !role.isSystem && can('users.manage') && <Button size="sm" variant="danger" disabled={busy || role.userCount > 0} title={role.userCount > 0 ? L.deleteBlocked : undefined} onClick={remove}><Icon name="trash" /> {L.delete}</Button>}
        </>}
      >
        {role?.isLocked && <Alert kind="info"><Icon name="lock" /> {L.lockedNote}</Alert>}
        <div className="grid-2">
          {isNew && (
            <Field label={L.code} hint={L.codeHint}>
              {(id) => <Input id={id} value={d.code} maxLength={30} onChange={(e) => setField('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="SUPERVISOR" />}
            </Field>
          )}
          <Field label={L.name}>{(id) => <Input id={id} value={d.name} disabled={!editable} onChange={(e) => setField('name', e.target.value)} placeholder="Nəzarətçi" />}</Field>
          <Field label={L.nameEn}>{(id) => <Input id={id} value={d.nameEn} disabled={!editable} onChange={(e) => setField('nameEn', e.target.value)} placeholder="Supervisor" />}</Field>
          {(isNew || (role && !role.isSystem)) && (
            <Field label={L.baseRole} hint={L.baseHint}>
              {(id) => <Select id={id} value={d.baseRole} disabled={!editable} onChange={(e) => setField('baseRole', e.target.value as BaseRole)}
                options={COMPANY_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />}
            </Field>
          )}
        </div>
        <Field label={L.description}>{(id) => <textarea id={id} className="input textarea" rows={2} value={d.description} disabled={!editable} onChange={(e) => setField('description', e.target.value)} />}</Field>
        {role && !role.isSystem && (
          <label className="check"><input type="checkbox" checked={d.isActive} disabled={!editable} onChange={(e) => setField('isActive', e.target.checked)} /> {L.active}</label>
        )}

        <h3 className="rl-h">{L.scope}</h3>
        <div className="rl-scopes" role="radiogroup" aria-label={L.scope}>
          {DATA_SCOPES.map((s) => (
            <label key={s} className={`rl-scope${d.dataScope === s ? ' is-active' : ''}`}>
              <input type="radio" name="rl-scope" checked={d.dataScope === s} disabled={!editable} onChange={() => setField('dataScope', s)} />
              <b>{L.scopes[s][0]}</b>
              <span>{L.scopes[s][1]}</span>
            </label>
          ))}
        </div>

        <div className="rl-h-row">
          <h3 className="rl-h">{L.pages}</h3>
          {editable && (
            <div className="rl-presets">
              <span className="muted small">{L.presets}:</span>
              <Button size="sm" variant="ghost" onClick={() => toggle(PERMISSION_AREAS.map((a) => a.view).filter((v): v is Permission => !!v), true)}>{L.presetViewAll}</Button>
              <Button size="sm" variant="ghost" onClick={() => setD({ ...d, perms: new Set() })}>{L.presetNone}</Button>
              <Select aria-label={L.copyFrom} value="" onChange={(e) => { const src = roles.find((r) => String(r.id) === e.target.value); if (src) setD({ ...d, perms: new Set(src.permissions), dataScope: src.dataScope }); }}
                options={[{ value: '', label: L.copyFrom }, ...roles.filter((r) => r.id !== role?.id).map((r) => ({ value: String(r.id), label: label(r) }))]} />
            </div>
          )}
        </div>
        <p className="hint">{L.pagesHint}</p>
        <div className="table-scroll">
          <table className="table rl-grid">
            <thead><tr><th>{L.colPage}</th><th className="rl-c">{L.colView}</th><th className="rl-c">{L.colEdit}</th><th>{L.colExtra}</th></tr></thead>
            <tbody>
              {PERMISSION_AREAS.map((a) => {
                const viewOn = a.view ? effective.has(a.view) : false;
                const viewForced = a.view ? !d.perms.has(a.view) && viewOn : false;
                const editOn = a.edit.length > 0 && a.edit.every((p) => d.perms.has(p));
                return (
                  <tr key={a.key}>
                    <td><b>{L.areas[a.key][0]}</b><div className="muted small">{L.areas[a.key][1]}</div></td>
                    <td className="rl-c">
                      {a.view ? (
                        <input type="checkbox" aria-label={`${L.areas[a.key][0]} — ${L.colView}`} checked={viewOn} disabled={!editable || viewForced}
                          title={viewForced ? L.pagesHint : undefined} onChange={(e) => toggle([a.view!], e.target.checked)} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="rl-c">
                      {a.edit.length ? (
                        <input type="checkbox" aria-label={`${L.areas[a.key][0]} — ${L.colEdit}`} checked={editOn} disabled={!editable} onChange={(e) => toggle(a.edit, e.target.checked)} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="rl-extras">
                        {a.extra.map((p) => (
                          <label key={p} className={`rl-chip${d.perms.has(p) ? ' is-on' : ''}`}>
                            <input type="checkbox" checked={d.perms.has(p)} disabled={!editable} onChange={(e) => toggle([p], e.target.checked)} /> {L.perms[p] ?? p}
                          </label>
                        ))}
                        {!a.extra.length && <span className="muted">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ErrorMessage error={error} />
        {ok && <Alert kind="success">{L.saved}</Alert>}
        {editable && (
          <div className="rl-actions">
            {dirty && <span className="muted small">{L.unsaved}</span>}
            <Button variant="primary" busy={busy} disabled={!dirty || d.name.trim().length < 2 || (isNew && d.code.length < 2)} onClick={save}>
              <Icon name="check" /> {isNew ? L.create : L.save}
            </Button>
          </div>
        )}
      </Card>

      <div className="rl-side">
        <Card title={L.preview} subtitle={L.previewHint}>
          <div className="rl-menu">
            {menu.map((s) => (
              <div key={s.title}>
                <div className="rl-menu-title">{s.title}</div>
                <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="hint"><b>{L.scope}:</b> {L.scopes[d.dataScope][0]}</p>
        </Card>
        {role && (
          <Card title={L.roleUsers} subtitle={fmt(L.users, { n: members.length })}>
            {members.length ? (
              <ul className="rl-members">
                {members.map((u) => <li key={u.id}><b>{u.fullName}</b> <span className="muted small">{u.email}{u.orgUnitName ? ` · ${u.orgUnitName}` : ''}{u.isActive ? '' : ` · ${L.inactive}`}</span></li>)}
              </ul>
            ) : <p className="muted">{L.noUsers}</p>}
          </Card>
        )}
      </div>
    </div>
  );
}

function Matrix({ roles, label, onOpen }: { roles: CompanyRoleDto[]; label: (r: CompanyRoleDto) => string; onOpen: (id: number) => void }) {
  const L = useLocal(TEXT);
  const list = roles.filter((r) => r.isActive);
  return (
    <Card flush subtitle={L.matrixLegend}>
      <div className="table-scroll">
        <table className="table rl-matrix">
          <thead>
            <tr>
              <th>{L.colPage}</th>
              {list.map((r) => <th key={r.id} className="rl-c"><button type="button" className="link-btn" onClick={() => onOpen(r.id)}>{label(r)}</button></th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_AREAS.map((a) => (
              <tr key={a.key}>
                <td><b>{L.areas[a.key][0]}</b></td>
                {list.map((r) => {
                  const eff = implied(new Set(r.permissions));
                  const v = a.view && eff.has(a.view);
                  const e = a.edit.length > 0 && a.edit.every((p) => eff.has(p));
                  const x = a.extra.filter((p) => eff.has(p)).length;
                  return (
                    <td key={r.id} className="rl-c">
                      {e ? <span className="rl-cell rl-e" title={L.colEdit}>{L.colEdit.charAt(0)}</span> : v ? <span className="rl-cell rl-v" title={L.colView}>{L.colView.charAt(0)}</span> : <span className="muted">·</span>}
                      {x > 0 && <span className="rl-plus" title={L.colExtra}>+{x}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td><b>{L.scope}</b></td>
              {list.map((r) => <td key={r.id} className="rl-c small">{L.scopes[r.dataScope][0]}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
