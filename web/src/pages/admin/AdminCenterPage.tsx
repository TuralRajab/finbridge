import { Link } from 'react-router-dom';
import type { CompanyDto, CompanyRoleDto, Permission, UserDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Card, Icon, PageHeader } from '../../components/ui';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { useMasterData } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import '../../styles/roles.css';

const az = {
  title: 'İdarəetmə mərkəzi',
  subtitle: 'Şirkətin bütün ayarları bir yerdə: struktur, maliyyə məlumatları, təsdiq axınları, istifadəçilər, rollar və səlahiyyətlər.',
  groups: { org: 'Təşkilat', finance: 'Maliyyə məlumatları', process: 'Proseslər', security: 'Təhlükəsizlik və giriş', company: 'Şirkət' },
  cards: {
    organization: 'Vahidlər ağacı, vahid növləri, peşə ailələri, vəzifələr; ağac görünüşü',
    costCenters: 'Xərc mərkəzləri, sahiblər, icazəli hesablar',
    accounts: 'Qrup və alt hesablar, OPEX / CAPEX',
    financial: 'Büdcə nəzarəti ayarları, valyutalar, məzənnələr',
    templates: 'Sənaye şablonları və quraşdırma ustası',
    bulkImport: 'Bütün bölmələr üçün Excel şablonları və idxal',
    workflows: 'Mərhələlər, təsdiqləyənlər, şərtlər, SLA, eskalasiya',
    delegations: 'Məzuniyyət dövründə səlahiyyət ötürmə',
    users: 'İstifadəçilər, struktur vahidi, rəhbər, rol',
    roles: 'Rollar: görünən səhifələr, redaktə hüquqları, məlumat görünürlüyü',
    audit: 'Dəyişikliklər, təsdiq əməliyyatları və idxal tarixçəsi',
    company: 'Şirkət profili və lisenziya',
  },
  stats: { units: '{n} vahid', ccs: '{n} xərc mərkəzi', accounts: '{n} hesab', users: '{n} aktiv istifadəçi', roles: '{n} rol ({c} şirkətin)', seats: '{u} / {m} yer' },
  setupPending: 'Quraşdırma tamamlanmayıb',
  open: 'Aç',
};
const TEXT = {
  az,
  en: {
    title: 'Admin center',
    subtitle: 'All company settings in one place: structure, financial master data, approval workflows, users, roles and permissions.',
    groups: { org: 'Organisation', finance: 'Financial master data', process: 'Processes', security: 'Security & access', company: 'Company' },
    cards: {
      organization: 'Unit tree, unit types, job families, positions; org chart',
      costCenters: 'Cost centers, owners, allowed accounts',
      accounts: 'Group and postable accounts, OPEX / CAPEX',
      financial: 'Budget-control settings, currencies, exchange rates',
      templates: 'Industry templates and the setup wizard',
      bulkImport: 'Excel templates and import for every section',
      workflows: 'Stages, approvers, conditions, SLA, escalation',
      delegations: 'Delegating approvals during leave',
      users: 'Users, org unit, manager, role',
      roles: 'Roles: visible pages, edit rights, data visibility',
      audit: 'Changes, approval actions and import history',
      company: 'Company profile and licence',
    },
    stats: { units: '{n} units', ccs: '{n} cost centers', accounts: '{n} accounts', users: '{n} active users', roles: '{n} roles ({c} custom)', seats: '{u} / {m} seats' },
    setupPending: 'Setup not completed',
    open: 'Open',
  } satisfies typeof az,
};

interface Tile { to: string; label: TKey; icon: string; desc: keyof typeof az.cards; perms: Permission[]; stat?: string | null }

export function AdminCenterPage() {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const { can, user } = useAuth();
  const md = useMasterData();
  const roles = useAsync(() => api<CompanyRoleDto[]>('GET', '/roles'), []);
  const users = useAsync(() => (can('users.view') ? api<UserDto[]>('GET', '/users') : Promise.resolve([] as UserDto[])), []);
  const company = useAsync(() => api<CompanyDto>('GET', '/company'), []);
  const lic = company.data?.license;

  const groups: { key: keyof typeof az.groups; tiles: Tile[] }[] = [
    { key: 'org', tiles: [
      { to: '/admin/organization', label: 'nav.organization', icon: 'org', desc: 'organization', perms: ['org.view'], stat: md.data ? fmt(L.stats.units, { n: md.data.units.length }) : null },
      { to: '/admin/cost-centers', label: 'nav.costCenters', icon: 'costCenters', desc: 'costCenters', perms: ['org.view'], stat: md.data ? fmt(L.stats.ccs, { n: md.data.costCenters.length }) : null },
    ] },
    { key: 'finance', tiles: [
      { to: '/admin/accounts', label: 'nav.accounts', icon: 'accounts', desc: 'accounts', perms: ['coa.view'], stat: md.data ? fmt(L.stats.accounts, { n: md.data.accounts.length }) : null },
      { to: '/admin/financial', label: 'nav.financial', icon: 'settings', desc: 'financial', perms: ['coa.view', 'company.manage'] },
      { to: '/admin/templates', label: 'nav.templates', icon: 'template', desc: 'templates', perms: ['templates.apply'] },
      { to: '/admin/import', label: 'nav.bulkImport', icon: 'upload', desc: 'bulkImport', perms: ['excel.import'] },
    ] },
    { key: 'process', tiles: [
      { to: '/admin/workflows', label: 'nav.workflows', icon: 'workflow', desc: 'workflows', perms: ['workflow.view'] },
      { to: '/delegations', label: 'nav.delegations', icon: 'delegate', desc: 'delegations', perms: ['masterdata.view'] },
    ] },
    { key: 'security', tiles: [
      { to: '/admin/users', label: 'nav.users', icon: 'users', desc: 'users', perms: ['users.view'], stat: users.data?.length ? fmt(L.stats.users, { n: users.data.filter((u) => u.isActive).length }) : null },
      { to: '/admin/roles', label: 'nav.roles', icon: 'lock', desc: 'roles', perms: ['users.view'], stat: roles.data ? fmt(L.stats.roles, { n: roles.data.length, c: roles.data.filter((r) => !r.isSystem).length }) : null },
      { to: '/admin/audit', label: 'nav.audit', icon: 'audit', desc: 'audit', perms: ['audit.view'] },
    ] },
    { key: 'company', tiles: [
      { to: '/admin/company', label: 'nav.company', icon: 'company', desc: 'company', perms: ['company.view'], stat: lic ? fmt(L.stats.seats, { u: lic.usedUsers, m: lic.maxUsers }) : null },
    ] },
  ];

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={user?.company && !user.company.setupCompleted && can('templates.apply') ? <Link className="btn btn-primary" to="/setup">{L.setupPending} →</Link> : null} />
      <div className="ac-groups">
        {groups.map((g) => {
          const tiles = g.tiles.filter((tile) => tile.perms.some((p) => can(p)));
          if (!tiles.length) return null;
          return (
            <section key={g.key}>
              <h2 className="ac-title">{L.groups[g.key]}</h2>
              <div className="ac-grid">
                {tiles.map((tile) => (
                  <Link key={tile.to} to={tile.to} className="ac-tile">
                    <span className="ac-icon"><Icon name={tile.icon} size={20} /></span>
                    <span className="ac-body">
                      <b>{t(tile.label)}</b>
                      <span className="muted small">{L.cards[tile.desc]}</span>
                      {tile.stat && <Badge tone="neutral">{tile.stat}</Badge>}
                    </span>
                    <span className="ac-go" aria-hidden="true"><Icon name="chevron" /></span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <Card className="ac-note"><p className="muted small">{L.cards.roles}</p></Card>
    </>
  );
}
