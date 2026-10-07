import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY_ROLES, type CompanyDto, type CompanyRoleDto, type JobFamilyDto, type Lang, type OrgUnitDto, type Permission, type Role, type UserDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { BulkImportButton } from '../../components/BulkImportDialog';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date } from '../../lib/format';
import { treeOptions, useDisplayName } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-security.css';

const az = {
  title: 'İstifadəçilər və rollar',
  subtitle: 'Şirkət istifadəçiləri, onların struktur vahidi, rəhbəri və rolu. Rol imkanları müəyyən edir, məlumat görünürlüyü isə struktur vahidi və xərc mərkəzi üzrə məhdudlaşır.',
  tabUsers: 'İstifadəçilər',
  tabRoles: 'Rollar və icazələr',
  newUser: 'Yeni istifadəçi',
  editUser: 'İstifadəçini redaktə et',
  searchPh: 'Ad, e-poçt və ya vəzifə…',
  allRoles: 'Bütün rollar',
  activeOnly: 'Yalnız aktivlər',
  inactiveOnly: 'Yalnız deaktivlər',
  jobFamily: 'Peşə ailəsi',
  lastLogin: 'Son giriş',
  never: 'Heç vaxt',
  seats: 'Lisenziya yerləri: {used} / {max} istifadə olunur',
  seatsFull: 'Lisenziyadakı bütün yerlər doludur. Yeni istifadəçi yaratmaq və ya deaktiv istifadəçini aktivləşdirmək üçün lisenziyanı genişləndirin.',
  seatsFullShort: 'Lisenziya yerləri doludur',
  shown: '{n} / {total} istifadəçi',
  noUnit: '— Vahid seçilməyib —',
  noManager: '— Rəhbər yoxdur —',
  noFamily: '— Peşə ailəsi yoxdur —',
  emailFixed: 'E-poçt ünvanı giriş adıdır və yaradıldıqdan sonra dəyişdirilmir.',
  languageFixed: 'İnterfeys dilini istifadəçi öz profilində dəyişir.',
  passwordNew: 'İlkin şifrə',
  passwordReset: 'Yeni şifrə (sıfırlamaq üçün)',
  passwordHint: 'Ən azı 8 simvol.',
  passwordResetHint: 'Boş saxlasanız, şifrə dəyişməyəcək.',
  roleHint: 'Rol imkanları verir; təsdiq hüququ isə təsdiq axınındakı təyinatdan gəlir.',
  managerHint: '“Sorğu edənin rəhbəri” növlü təsdiq mərhələləri bu sahədən istifadə edir.',
  self: 'Siz',
  selfLocked: 'Öz rolunuzu dəyişə və özünüzü deaktiv edə bilməzsiniz.',
  confirmDeactivateTitle: 'İstifadəçi deaktiv edilsin?',
  confirmDeactivate: '{name} sistemə daxil ola bilməyəcək. İstənilən vaxt yenidən aktivləşdirmək olar.',
  matrixTitle: 'Rollar üzrə icazələr matrisi',
  matrixSub: 'Hər rolun hansı imkanlara malik olduğunu göstərir. Matris sistemdə sabitdir.',
  approvalNote: 'Təsdiq etmə hüququ rol icazəsi deyil. İstifadəçi sənədi yalnız təsdiq axınının mərhələsində ona tapşırıq təyin edildikdə (rəhbər, xərc mərkəzi sahibi, vəzifə, konkret şəxs və s. kimi) və ya səlahiyyət ötürüldükdə təsdiqləyə bilər.',
  scopeNote: 'Məlumat görünürlüyü: Administrator, CEO, CFO, Maliyyə meneceri və Baxış hüququ olan istifadəçilər bütün şirkəti görür; digərləri yalnız öz struktur vahidini, sahibi olduqları xərc mərkəzlərini, öz sorğularını və onlara təyin edilmiş təsdiqləri görür.',
  workflowsLink: 'Təsdiq axınlarına keçin',
  permission: 'İcazə',
  has: 'Var',
  hasNot: 'Yoxdur',
  groupAdmin: 'Şirkət idarəetməsi',
  groupMaster: 'Struktur və ilkin məlumatlar',
  groupBudget: 'Büdcə',
  groupSpend: 'Xərc nəzarəti',
  groupReports: 'Hesabat, audit və Excel',
};

type T = typeof az;
const en: T = {
  title: 'Users & roles',
  subtitle: 'Company users with their org unit, manager and role. The role grants capabilities; data visibility is limited by org unit and cost center scope.',
  tabUsers: 'Users',
  tabRoles: 'Roles & permissions',
  newUser: 'New user',
  editUser: 'Edit user',
  searchPh: 'Name, email or job title…',
  allRoles: 'All roles',
  activeOnly: 'Active only',
  inactiveOnly: 'Inactive only',
  jobFamily: 'Job family',
  lastLogin: 'Last login',
  never: 'Never',
  seats: 'Licence seats: {used} / {max} in use',
  seatsFull: 'All licence seats are in use. Extend the licence to create a user or reactivate an inactive one.',
  seatsFullShort: 'Licence seats are full',
  shown: '{n} of {total} users',
  noUnit: '— No unit —',
  noManager: '— No manager —',
  noFamily: '— No job family —',
  emailFixed: 'The email address is the login name and cannot be changed after creation.',
  languageFixed: 'Users change their interface language in their own profile.',
  passwordNew: 'Initial password',
  passwordReset: 'New password (to reset)',
  passwordHint: 'At least 8 characters.',
  passwordResetHint: 'Leave empty to keep the current password.',
  roleHint: 'The role grants capabilities; approval rights come from workflow assignment.',
  managerHint: 'Workflow steps of type “Requester’s manager” use this field.',
  self: 'You',
  selfLocked: 'You cannot change your own role or deactivate yourself.',
  confirmDeactivateTitle: 'Deactivate user?',
  confirmDeactivate: '{name} will no longer be able to sign in. You can reactivate the user at any time.',
  matrixTitle: 'Permission matrix by role',
  matrixSub: 'Shows which capabilities each role has. The matrix is fixed by the system.',
  approvalNote: 'Approving is not a role permission. A user can approve a document only when a workflow step assigns the task to them (as manager, cost center owner, position holder, a named person, etc.) or when approval authority has been delegated to them.',
  scopeNote: 'Data visibility: Administrator, CEO, CFO, Finance manager and Viewer see the whole company; everyone else sees only their own org unit, the cost centers they own, their own requests and the approvals assigned to them.',
  workflowsLink: 'Go to approval workflows',
  permission: 'Permission',
  has: 'Yes',
  hasNot: 'No',
  groupAdmin: 'Company administration',
  groupMaster: 'Structure & master data',
  groupBudget: 'Budget',
  groupSpend: 'Spend control',
  groupReports: 'Reports, audit & Excel',
};
const TEXT = { az, en };

/** Human description of every company permission. */
const PERM_TEXT: Record<Lang, Partial<Record<Permission, string>>> = {
  az: {
    'company.manage': 'Şirkət profilini və büdcə nəzarəti ayarlarını (limit həddi, qalıq bazası, büdcəni aşan sorğuların bloklanması) dəyişmək.',
    'users.manage': 'İstifadəçiləri yaratmaq, rol və struktur vahidi təyin etmək, deaktiv etmək, şifrəni sıfırlamaq, başqaları üçün səlahiyyət ötürməni idarə etmək.',
    'org.manage': 'Təşkilati strukturu, vahid növlərini, xərc mərkəzlərini, peşə ailələrini və vəzifələri idarə etmək.',
    'coa.manage': 'Hesablar planını, valyutaları və valyuta məzənnələrini idarə etmək.',
    'templates.apply': 'Sənaye şablonunu tətbiq etmək və şirkətin ilkin quraşdırmasını aparmaq.',
    'workflow.manage': 'Təsdiq axınlarını (mərhələlər, şərtlər, təsdiqləyənlər, eskalasiya) qurmaq və dəyişmək.',
    'masterdata.view': 'Strukturu, hesabları, xərc mərkəzlərini və istifadəçi siyahısını görmək.',
    'budget.view': 'Büdcələrə, versiyalara və bölmələrə baxmaq (öz əhatə dairəsi daxilində).',
    'budget.create': 'Yeni illik büdcə və versiya (düzəlişli, proqnoz, idarəetmə) yaratmaq.',
    'budget.manage': 'Versiyanı təsdiqə göndərmək, kilidləmək, bölmələri yenidən açmaq və büdcəni Excel-dən idxal etmək.',
    'budget.edit': 'Öz əhatə dairəsindəki büdcə sətirlərini doldurmaq və redaktə etmək.',
    'budget.submit': 'Büdcə bölməsini təsdiq axınına təqdim etmək.',
    'request.create': 'Satınalma və xərc sorğuları yaratmaq və təsdiqə göndərmək.',
    'change.create': 'Kilidlənmiş büdcə üzrə dəyişiklik sorğusu (köçürmə, artırma, azaltma) yaratmaq.',
    'actuals.view': 'Faktiki xərclərə baxmaq.',
    'actuals.manage': 'Faktiki xərcləri daxil etmək, düzəltmək və Excel-dən idxal etmək.',
    'reports.view': 'İdarəetmə panelini, büdcə istifadəsi, plan-fakt və təsdiq hesabatlarını görmək.',
    'audit.view': 'Audit jurnalına və təsdiq əməliyyatlarının tarixçəsinə baxmaq.',
    'excel.import': 'Excel faylları idxal etmək və idxal tarixçəsinə baxmaq.',
    'excel.export': 'Siyahı və hesabatları Excel-ə ixrac etmək.',
  },
  en: {
    'company.manage': 'Change the company profile and budget-control settings (near-limit threshold, availability basis, blocking over-budget requests).',
    'users.manage': 'Create users, assign roles and org units, deactivate users, reset passwords and manage delegations on behalf of others.',
    'org.manage': 'Manage the org structure, unit types, cost centers, job families and positions.',
    'coa.manage': 'Manage the chart of accounts, currencies and exchange rates.',
    'templates.apply': 'Apply an industry template and run the initial company setup.',
    'workflow.manage': 'Build and change approval workflows (steps, conditions, approvers, escalation).',
    'masterdata.view': 'See the structure, accounts, cost centers and the user list.',
    'budget.view': 'View budgets, versions and sections (within the user’s scope).',
    'budget.create': 'Create a new annual budget and versions (revised, forecast, management).',
    'budget.manage': 'Submit a version for approval, lock it, reopen sections and import budgets from Excel.',
    'budget.edit': 'Fill in and edit budget lines within the user’s scope.',
    'budget.submit': 'Submit a budget section into its approval workflow.',
    'request.create': 'Create purchase and expense requests and submit them for approval.',
    'change.create': 'Create budget change requests (transfer, increase, decrease) on a locked budget.',
    'actuals.view': 'View actual spend.',
    'actuals.manage': 'Enter and correct actual spend and import it from Excel.',
    'reports.view': 'See the dashboard, consumption, plan vs actual and workflow reports.',
    'audit.view': 'View the audit log and the history of approval actions.',
    'excel.import': 'Import Excel files and view the import history.',
    'excel.export': 'Export lists and reports to Excel.',
  },
};

const PERM_GROUPS: { key: keyof T; perms: Permission[] }[] = [
  { key: 'groupAdmin', perms: ['company.manage', 'users.manage', 'templates.apply', 'workflow.manage'] },
  { key: 'groupMaster', perms: ['masterdata.view', 'org.manage', 'coa.manage'] },
  { key: 'groupBudget', perms: ['budget.view', 'budget.create', 'budget.edit', 'budget.submit', 'budget.manage', 'change.create'] },
  { key: 'groupSpend', perms: ['request.create', 'actuals.view', 'actuals.manage'] },
  { key: 'groupReports', perms: ['reports.view', 'audit.view', 'excel.import', 'excel.export'] },
];

type Tab = 'users' | 'roles';

export function UsersPage() {
  const L = useLocal(TEXT);
  const [tab, setTab] = useState<Tab>('users');
  const [version, setVersion] = useState(0);
  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<BulkImportButton kind="USERS" onDone={() => setVersion((v) => v + 1)} />} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'users', label: L.tabUsers }, { value: 'roles', label: L.tabRoles }]} />
      {tab === 'users' ? <UsersTab key={version} /> : <RolesLink />}
    </>
  );
}

/* ------------------------------------------------------------------ users */

interface Refs { users: UserDto[]; units: OrgUnitDto[]; families: JobFamilyDto[]; company: CompanyDto; roles: CompanyRoleDto[] }

function UsersTab() {
  const L = useLocal(TEXT);
  const { t, locale, lang } = useI18n();
  const { user: me, can } = useAuth();
  const dn = useDisplayName();
  const { data, error, loading, reload } = useAsync<Refs>(async () => {
    const [users, units, families, company, roles] = await Promise.all([
      api<UserDto[]>('GET', '/users'),
      api<OrgUnitDto[]>('GET', '/org/units'),
      api<JobFamilyDto[]>('GET', '/org/job-families'),
      api<CompanyDto>('GET', '/company'),
      api<CompanyRoleDto[]>('GET', '/roles'),
    ]);
    return { users, units, families, company, roles };
  }, []);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('active');
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [confirm, setConfirm] = useState<UserDto | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLocaleLowerCase(locale);
    return data.users.filter((u) =>
      (!role || u.roleCode === role)
      && (active === '' || (active === 'active' ? u.isActive : !u.isActive))
      && (!needle || [u.fullName, u.email, u.jobTitle ?? ''].some((s) => s.toLocaleLowerCase(locale).includes(needle))));
  }, [data, q, role, active, locale]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error} />;

  const lic = data.company.license;
  const seatsFull = lic.usedUsers >= lic.maxUsers;
  const seatPct = lic.maxUsers ? Math.min(100, (lic.usedUsers / lic.maxUsers) * 100) : 100;
  const byId = new Map(data.users.map((u) => [u.id, u]));
  const famById = new Map(data.families.map((f) => [f.id, f]));
  const unitById = new Map(data.units.map((u) => [u.id, u]));

  const canManage = can('users.manage');
  const roleByCode = new Map(data.roles.map((r) => [r.code, r]));
  const roleLabel = (code: string) => {
    const r = roleByCode.get(code);
    return r && !r.isSystem ? r.name : (COMPANY_ROLES as readonly string[]).includes(code) ? t(`roles.${code as Role}`) : r?.name ?? code;
  };

  const toggle = async (u: UserDto, isActive: boolean) => {
    setRowBusy(u.id); setRowError(null);
    try { await api('PATCH', `/users/${u.id}`, { isActive }); await reload(); } catch (e) { setRowError(e); } finally { setRowBusy(null); }
  };

  return (
    <>
      {seatsFull && <Alert kind="warning">{L.seatsFull}</Alert>}
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" aria-label={t('common.search')} placeholder={L.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label={t('common.role')} value={role} onChange={(e) => setRole(e.target.value)}
            options={[{ value: '', label: L.allRoles }, ...data.roles.map((r) => ({ value: r.code, label: roleLabel(r.code) }))]} />
          <Select aria-label={t('common.status')} value={active} onChange={(e) => setActive(e.target.value)}
            options={[{ value: 'active', label: L.activeOnly }, { value: 'inactive', label: L.inactiveOnly }, { value: '', label: t('common.all') }]} />
          <span className="muted small">{fmt(L.shown, { n: rows.length, total: data.users.length })}</span>
          <div className="toolbar-right">
            <div className="sec-seats">
              <span>{fmt(L.seats, { used: lic.usedUsers, max: lic.maxUsers })}</span>
              <div className={`progress${seatsFull ? ' is-full' : seatPct >= 85 ? ' is-near' : ''}`} role="img" aria-label={fmt(L.seats, { used: lic.usedUsers, max: lic.maxUsers })}>
                <span style={{ width: `${seatPct}%` }} />
              </div>
            </div>
            <ExportButton path="/export/users" filename="finbridge-users.xlsx" />
            {canManage && <Button variant="primary" disabled={seatsFull} title={seatsFull ? L.seatsFullShort : undefined} onClick={() => setEditing('new')}>
              <Icon name="plus" /> {L.newUser}
            </Button>}
          </div>
        </div>
        {rowError ? <div className="card-body"><ErrorMessage error={rowError} /></div> : null}
        {!rows.length ? <Empty>{t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{t('common.fullName')}</th><th>{t('common.email')}</th><th>{t('common.role')}</th><th>{t('common.unit')}</th>
                <th>{t('common.manager')}</th><th>{L.jobFamily}</th><th>{t('common.jobTitle')}</th><th>{t('common.language')}</th>
                <th>{t('common.status')}</th><th>{L.lastLogin}</th><th className="r">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = u.id === me?.id;
                  const unit = u.orgUnitId ? unitById.get(u.orgUnitId) : undefined;
                  return (
                    <tr key={u.id}>
                      <td><b>{u.fullName}</b>{isSelf && <> <Badge tone="info">{L.self}</Badge></>}</td>
                      <td className="muted">{u.email}</td>
                      <td className="sec-nowrap">{roleLabel(u.roleCode)}</td>
                      <td>{unit ? dn(unit) : u.orgUnitName ?? '—'}{unit && <span className="sec-cell-sub">{unit.code}</span>}</td>
                      <td>{u.managerId ? byId.get(u.managerId)?.fullName ?? '—' : '—'}</td>
                      <td>{u.jobFamilyId ? famById.get(u.jobFamilyId)?.name ?? '—' : '—'}</td>
                      <td>{u.jobTitle ?? '—'}</td>
                      <td>{u.language.toUpperCase()}</td>
                      <td>{u.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>}</td>
                      <td className="sec-nowrap muted">{u.lastLoginAt ? date(u.lastLoginAt, locale, true) : L.never}</td>
                      <td className="r">
                        <div className="row-actions">
                          {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>{t('common.edit')}</Button>}
                          {!canManage ? null : u.isActive
                            ? <Button size="sm" variant="ghost" disabled={isSelf} title={isSelf ? L.selfLocked : undefined}
                                busy={rowBusy === u.id} onClick={() => setConfirm(u)}>{t('common.deactivate')}</Button>
                            : <Button size="sm" variant="ghost" disabled={seatsFull} title={seatsFull ? L.seatsFullShort : undefined}
                                busy={rowBusy === u.id} onClick={() => void toggle(u, true)}>{t('common.activate')}</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <UserModal user={editing === 'new' ? null : editing} refs={data} isSelf={editing !== 'new' && editing.id === me?.id}
          lang={lang} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}
      {confirm && (
        <Modal title={L.confirmDeactivateTitle} onClose={() => setConfirm(null)} footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { const u = confirm; setConfirm(null); void toggle(u, false); }}>{t('common.deactivate')}</Button>
        </>}>
          <p>{fmt(L.confirmDeactivate, { name: confirm.fullName })}</p>
        </Modal>
      )}
    </>
  );
}

function UserModal({ user, refs, isSelf, lang, onClose, onSaved }: {
  user: UserDto | null; refs: Refs; isSelf: boolean; lang: Lang; onClose: () => void; onSaved: () => void;
}) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const [f, setF] = useState({
    fullName: user?.fullName ?? '', email: user?.email ?? '', role: user?.roleCode ?? 'EMPLOYEE',
    orgUnitId: user?.orgUnitId ? String(user.orgUnitId) : '', managerId: user?.managerId ? String(user.managerId) : '',
    jobFamilyId: user?.jobFamilyId ? String(user.jobFamilyId) : '', jobTitle: user?.jobTitle ?? '',
    language: (user?.language ?? lang) as Lang, password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const idOrNull = (v: string) => (v ? Number(v) : null);

  const unitOptions = treeOptions(refs.units, dn, (u) => u.isActive || u.id === user?.orgUnitId);
  const managerOptions = refs.users.filter((u) => u.id !== user?.id && (u.isActive || u.id === user?.managerId));
  const familyOptions = refs.families.filter((j) => j.isActive || j.id === user?.jobFamilyId);

  const pwdOk = user ? f.password === '' || f.password.length >= 8 : f.password.length >= 8;
  const valid = f.fullName.trim().length >= 2 && (user || /\S+@\S+\.\S+/.test(f.email)) && pwdOk;

  const save = async () => {
    setBusy(true); setError(null);
    const common = {
      fullName: f.fullName.trim(), orgUnitId: idOrNull(f.orgUnitId), managerId: idOrNull(f.managerId),
      jobFamilyId: idOrNull(f.jobFamilyId), jobTitle: f.jobTitle.trim() || null,
    };
    try {
      if (user) {
        await api('PATCH', `/users/${user.id}`, { ...common, ...(isSelf ? {} : { role: f.role }), ...(f.password ? { password: f.password } : {}) });
      } else {
        await api('POST', '/users', { ...common, email: f.email.trim(), role: f.role, language: f.language, password: f.password });
      }
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={user ? L.editUser : L.newUser} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!valid} onClick={save}>{user ? t('common.save') : t('common.create')}</Button>
    </>}>
      <div className="grid-2">
        <Field label={t('common.fullName')}>{(id) => <Input id={id} value={f.fullName} onChange={set('fullName')} maxLength={120} required />}</Field>
        <Field label={t('common.email')} hint={user ? L.emailFixed : undefined}>
          {(id) => <Input id={id} type="email" autoComplete="off" value={f.email} onChange={set('email')} disabled={!!user} required />}
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('common.role')} hint={isSelf ? L.selfLocked : L.roleHint}>
          {(id) => <Select id={id} value={f.role} onChange={set('role')} disabled={isSelf}
            options={refs.roles.filter((r) => r.isActive || r.code === f.role).map((r) => ({ value: r.code, label: r.isSystem ? t(`roles.${r.code as Role}`) : r.name }))} />}
        </Field>
        <Field label={t('common.unit')}>
          {(id) => <Select id={id} value={f.orgUnitId} onChange={set('orgUnitId')}
            options={[{ value: '', label: L.noUnit }, ...unitOptions.map((o) => ({ value: o.value, label: o.label.replace(/^( +)/, (s) => '  '.repeat(s.length / 2)) }))]} />}
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('common.manager')} hint={L.managerHint}>
          {(id) => <Select id={id} value={f.managerId} onChange={set('managerId')}
            options={[{ value: '', label: L.noManager }, ...managerOptions.map((u) => ({ value: u.id, label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}` }))]} />}
        </Field>
        <Field label={L.jobFamily}>
          {(id) => <Select id={id} value={f.jobFamilyId} onChange={set('jobFamilyId')}
            options={[{ value: '', label: L.noFamily }, ...familyOptions.map((j) => ({ value: j.id, label: `${j.code} · ${j.name}` }))]} />}
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('common.jobTitle')}>{(id) => <Input id={id} value={f.jobTitle} onChange={set('jobTitle')} maxLength={120} />}</Field>
        <Field label={t('common.language')} hint={user ? L.languageFixed : undefined}>
          {(id) => <Select id={id} value={f.language} onChange={set('language')} disabled={!!user}
            options={[{ value: 'az', label: 'Azərbaycan dili' }, { value: 'en', label: 'English' }]} />}
        </Field>
      </div>
      <Field label={user ? L.passwordReset : L.passwordNew} hint={user ? L.passwordResetHint : L.passwordHint}
        error={f.password && f.password.length < 8 ? L.passwordHint : undefined}>
        {(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required={!user} />}
      </Field>
      <ErrorMessage error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ roles */

const rolesLinkText = {
  az: { body: 'Rollar artıq konfiqurasiya olunur: hər rol üçün görünən səhifələri, redaktə hüquqlarını və məlumat görünürlüyünü təyin edin, yeni rollar yaradın.', open: 'Rollar və səlahiyyətlər səhifəsini aç' },
  en: { body: 'Roles are configurable: define visible pages, edit rights and data visibility for each role, and create new roles.', open: 'Open Roles & permissions' },
};

function RolesLink() {
  const L = useLocal(rolesLinkText);
  return (
    <Card>
      <p>{L.body}</p>
      <Link className="btn btn-primary" to="/admin/roles"><Icon name="lock" /> {L.open}</Link>
    </Card>
  );
}

function FragmentRows({ label, span, children }: { label: string; span: number; children: ReactNode }) {
  return (
    <>
      <tr className="sec-group"><td colSpan={span}>{label}</td></tr>
      {children}
    </>
  );
}
