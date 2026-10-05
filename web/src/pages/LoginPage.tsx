import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Role } from '@finbridge/shared';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Button, ErrorMessage, Field, Icon, Input, Logo } from '../components/ui';
import { useI18n } from '../i18n';

const DEMO_PASSWORD = 'Demo1234!';
const DEMO: { email: string; role: Role; password?: string; note?: string }[] = [
  { email: 'finance@demo.az', role: 'FINANCE_MANAGER' },
  { email: 'cfo@demo.az', role: 'CFO' },
  { email: 'ceo@demo.az', role: 'CEO' },
  { email: 'sales.manager@demo.az', role: 'DEPARTMENT_MANAGER' },
  { email: 'field.sales@demo.az', role: 'COST_CENTER_OWNER' },
  { email: 'employee@demo.az', role: 'EMPLOYEE' },
  { email: 'admin@demo.az', role: 'ADMIN' },
  { email: 'viewer@demo.az', role: 'VIEWER' },
  { email: 'finance@qafqazqida.az', role: 'FINANCE_MANAGER', note: 'Qafqaz Qida' },
  { email: 'setup@demo.az', role: 'ADMIN', note: 'Yeni Şirkət MMC' },
  { email: 'owner@finbridge.az', role: 'SUPER_ADMIN', password: 'Admin1234!' },
];
const SHOW_DEMO = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

export function LoginPage() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (user) return <Navigate to={user.role === 'SUPER_ADMIN' ? '/platform' : '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await login(email, password);
      navigate(me.role === 'SUPER_ADMIN' ? '/platform' : '/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <Logo light />
        <div className="login-hero-body">
          <h1>{t('login.heroTitle')}</h1>
          <p>{t('login.heroText')}</p>
          <ul>
            {t('login.heroPoints').split('|').map((p) => <li key={p}><Icon name="check" /> {p}</li>)}
          </ul>
        </div>
        <small className="login-foot">© {new Date().getFullYear()} FinBridge · Bakı</small>
      </section>

      <section className="login-panel">
        <div className="login-top"><LanguageSwitch /></div>
        <form className="login-form" onSubmit={submit}>
          <h2>{t('login.title')}</h2>
          <p className="muted">{t('login.subtitle')}</p>
          <Field label={t('login.email')}>
            {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label={t('login.password')}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full">{t('login.submit')}</Button>

          {SHOW_DEMO && (
            <div className="demo">
              <div className="demo-title">{t('login.demoTitle')}</div>
              <p className="muted small">{t('login.demoHint', { password: DEMO_PASSWORD })}<br />{t('login.demoCompanies')}</p>
              <div className="demo-list">
                {DEMO.map((d) => (
                  <button key={d.email} type="button" className="demo-item" onClick={() => { setEmail(d.email); setPassword(d.password ?? DEMO_PASSWORD); }}>
                    <b>{t(`roles.${d.role}`)}{d.note && <> · {d.note}</>}</b><span>{d.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
