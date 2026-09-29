import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Permission } from '@finbridge/shared';
import { useAuth } from '../auth/AuthContext';
import { useI18n, type TKey } from '../i18n';
import { date } from '../lib/format';
import { LanguageSwitch } from './LanguageSwitch';
import { Badge, Icon, Logo } from './ui';

interface NavItem { to: string; label: TKey; icon: string; permission: Permission }

const SECTIONS: { title: TKey; items: NavItem[] }[] = [
  {
    title: 'nav.planning',
    items: [
      { to: '/', label: 'nav.dashboard', icon: 'dashboard', permission: 'reports.view' },
      { to: '/budgets', label: 'nav.budgets', icon: 'budget', permission: 'budget.view' },
      { to: '/plan-vs-actual', label: 'nav.planVsActual', icon: 'pva', permission: 'reports.view' },
      { to: '/actuals', label: 'nav.actuals', icon: 'actuals', permission: 'actuals.view' },
    ],
  },
  {
    title: 'nav.masterData',
    items: [
      { to: '/departments', label: 'nav.departments', icon: 'departments', permission: 'masterdata.view' },
      { to: '/cost-centers', label: 'nav.costCenters', icon: 'costCenters', permission: 'masterdata.view' },
      { to: '/accounts', label: 'nav.accounts', icon: 'accounts', permission: 'masterdata.view' },
    ],
  },
  {
    title: 'nav.administration',
    items: [
      { to: '/users', label: 'nav.users', icon: 'users', permission: 'users.manage' },
      { to: '/company', label: 'nav.company', icon: 'company', permission: 'masterdata.view' },
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo light /></div>
        {user.company && <div className="sidebar-company" title={user.company.name}>{user.company.name}</div>}
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter((i) => can(i.permission));
            if (!items.length) return null;
            return (
              <div key={s.title} className="nav-section">
                <div className="nav-title">{t(s.title)}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                    <Icon name={i.icon} size={18} />
                    <span>{t(i.label)}</span>
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
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
