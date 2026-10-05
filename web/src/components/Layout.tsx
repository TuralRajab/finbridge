import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Permission } from '@finbridge/shared';
import { useAuth } from '../auth/AuthContext';
import { useI18n, type TKey } from '../i18n';
import { date } from '../lib/format';
import { LanguageSwitch } from './LanguageSwitch';
import { Badge, Icon, Logo } from './ui';

interface NavItem { to: string; label: TKey; icon: string; permission: Permission; end?: boolean; count?: 'tasks' }

const SECTIONS: { title: TKey; items: NavItem[] }[] = [
  {
    title: 'nav.overview',
    items: [
      { to: '/', label: 'nav.dashboard', icon: 'dashboard', permission: 'reports.view', end: true },
      { to: '/approvals', label: 'nav.approvals', icon: 'inbox', permission: 'masterdata.view', count: 'tasks' },
    ],
  },
  {
    title: 'nav.planning',
    items: [
      { to: '/budgets', label: 'nav.budgets', icon: 'budget', permission: 'budget.view' },
      { to: '/changes', label: 'nav.changes', icon: 'change', permission: 'budget.view' },
    ],
  },
  {
    title: 'nav.spend',
    items: [
      { to: '/requests', label: 'nav.requests', icon: 'request', permission: 'request.create' },
      { to: '/actuals', label: 'nav.actuals', icon: 'actuals', permission: 'actuals.view' },
    ],
  },
  {
    title: 'nav.reports',
    items: [
      { to: '/reports/consumption', label: 'nav.consumption', icon: 'pva', permission: 'reports.view' },
      { to: '/reports/workflows', label: 'nav.workflowReport', icon: 'report', permission: 'reports.view' },
      { to: '/reports/changes', label: 'nav.changeReport', icon: 'history', permission: 'reports.view' },
    ],
  },
  {
    title: 'nav.administration',
    items: [
      { to: '/setup', label: 'nav.setup', icon: 'wand', permission: 'templates.apply' },
      { to: '/admin/organization', label: 'nav.organization', icon: 'org', permission: 'masterdata.view' },
      { to: '/admin/cost-centers', label: 'nav.costCenters', icon: 'costCenters', permission: 'masterdata.view' },
      { to: '/admin/accounts', label: 'nav.accounts', icon: 'accounts', permission: 'masterdata.view' },
      { to: '/admin/templates', label: 'nav.templates', icon: 'template', permission: 'templates.apply' },
      { to: '/admin/financial', label: 'nav.financial', icon: 'settings', permission: 'coa.manage' },
      { to: '/admin/workflows', label: 'nav.workflows', icon: 'workflow', permission: 'workflow.manage' },
      { to: '/delegations', label: 'nav.delegations', icon: 'delegate', permission: 'masterdata.view' },
      { to: '/admin/users', label: 'nav.users', icon: 'users', permission: 'users.manage' },
      { to: '/admin/audit', label: 'nav.audit', icon: 'audit', permission: 'audit.view' },
      { to: '/admin/company', label: 'nav.company', icon: 'company', permission: 'masterdata.view' },
      { to: '/platform', label: 'nav.platform', icon: 'platform', permission: 'platform.manage' },
    ],
  },
];

export function Layout() {
  const { user, logout, can } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  if (!user) return null;
  const license = user.company?.license;
  const setupPending = user.company && !user.company.setupCompleted;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo light /></div>
        {user.company && <div className="sidebar-company" title={user.company.name}>{user.company.name}</div>}
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter((i) => can(i.permission) && (i.permission !== 'masterdata.view' || user.role !== 'SUPER_ADMIN'));
            if (!items.length) return null;
            return (
              <div key={s.title} className="nav-section">
                <div className="nav-title">{t(s.title)}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                    <Icon name={i.icon} size={18} />
                    <span>{t(i.label)}</span>
                    {i.count === 'tasks' && user.pendingTasks > 0 && <span className="nav-count">{user.pendingTasks}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        {license && (
          <div className="sidebar-license">
            <div>{t(`company.plans.${license.plan}`)} · {license.usedUsers}/{license.maxUsers}</div>
            <small>{t('company.validUntil')}: {date(license.validUntil, locale)}</small>
          </div>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            {user.company && <strong className="topbar-company">{user.company.name}</strong>}
            {user.company && <span className="muted small">{user.company.baseCurrency}</span>}
            {license && !license.isValid && <Badge tone="danger">{t('company.licenseInvalid')}</Badge>}
          </div>
          <div className="topbar-right">
            <LanguageSwitch />
            <button type="button" className="user-chip" onClick={() => navigate('/profile')} title={t('nav.profile')}>
              <span className="avatar">{user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
              <span className="user-meta"><b>{user.fullName}</b><small>{t(`roles.${user.role}`)}</small></span>
            </button>
            <button type="button" className="icon-btn" onClick={() => { logout(); navigate('/login'); }} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>
        {setupPending && can('templates.apply') && (
          <div className="setup-banner" role="status">
            <span><b>{t('nav.setupPending')}</b> — {t('nav.setupPendingHint')}</span>
            <Link className="btn btn-primary btn-sm" to="/setup">{t('nav.setup')}</Link>
          </div>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
