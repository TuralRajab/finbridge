import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Lang, UserDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Icon, Input, PageHeader, Select, isErrorCode } from '../components/ui';
import { fmt, useI18n, useLocal } from '../i18n';
import { date } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import '../styles/admin-security.css';

const az = {
  title: 'Profil',
  subtitle: 'Şəxsi məlumatlarınız, dil seçimi və şifrə.',
  myProfile: 'Mənim profilim',
  company: 'Şirkət',
  lastLogin: 'Son giriş',
  noUnit: 'Təyin edilməyib',
  noManager: 'Təyin edilməyib',
  infoHint: 'Rol, struktur vahidi və rəhbər administrator tərəfindən təyin edilir.',
  preferences: 'Dil seçimi',
  languageHint: 'Seçim dərhal tətbiq olunur və hesabınızda saxlanılır.',
  changePassword: 'Şifrəni dəyiş',
  currentPassword: 'Cari şifrə',
  newPassword: 'Yeni şifrə',
  repeatPassword: 'Yeni şifrəni təkrarlayın',
  passwordHint: 'Ən azı 8 simvol.',
  mismatch: 'Şifrələr eyni deyil.',
  sameAsOld: 'Yeni şifrə cari şifrədən fərqli olmalıdır.',
  wrongCurrent: 'Cari şifrə yanlışdır.',
  passwordChanged: 'Şifrə dəyişdirildi.',
  work: 'İşim',
  pendingTasks: 'Təsdiqimi gözləyən tapşırıqlar',
  pendingTasksHint: '{n} tapşırıq gözləyir',
  noTasks: 'Gözləyən tapşırıq yoxdur',
  delegations: 'Səlahiyyət ötürmələrim',
  delegationsHint: 'Məzuniyyət və ya ezamiyyət zamanı təsdiq səlahiyyətinizi həmkarınıza ötürün.',
  approvalNote: 'Təsdiq hüququ rolunuzdan deyil, təsdiq axınında sizə təyin edilmiş mərhələlərdən gəlir.',
};
const en: typeof az = {
  title: 'Profile',
  subtitle: 'Your personal details, language and password.',
  myProfile: 'My profile',
  company: 'Company',
  lastLogin: 'Last login',
  noUnit: 'Not assigned',
  noManager: 'Not assigned',
  infoHint: 'Role, org unit and manager are assigned by the administrator.',
  preferences: 'Language',
  languageHint: 'Applied immediately and saved to your account.',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  repeatPassword: 'Repeat new password',
  passwordHint: 'At least 8 characters.',
  mismatch: 'The passwords do not match.',
  sameAsOld: 'The new password must differ from the current one.',
  wrongCurrent: 'The current password is incorrect.',
  passwordChanged: 'Your password has been changed.',
  work: 'My work',
  pendingTasks: 'Tasks awaiting my approval',
  pendingTasksHint: '{n} tasks waiting',
  noTasks: 'No pending tasks',
  delegations: 'My delegations',
  delegationsHint: 'Hand over your approval authority to a colleague during leave or travel.',
  approvalNote: 'Approval rights come from workflow steps assigned to you, not from your role.',
};
const TEXT = { az, en };

export function ProfilePage() {
  const L = useLocal(TEXT);
  return <><PageHeader title={L.title} subtitle={L.subtitle} /><ProfileCard /></>;
}

export function ProfileCard() {
  const L = useLocal(TEXT);
  const { t, lang, locale } = useI18n();
  const { user, can, changeLanguage } = useAuth();
  const inCompany = !!user?.companyId && can('masterdata.view');
  const users = useAsync(() => (inCompany ? api<UserDto[]>('GET', '/users') : Promise.resolve([] as UserDto[])), [inCompany]);
  const [langBusy, setLangBusy] = useState(false);
  const [langError, setLangError] = useState<unknown>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wrongCurrent, setWrongCurrent] = useState(false);
  const [ok, setOk] = useState(false);
  if (!user) return null;

  const manager = user.managerId ? users.data?.find((u) => u.id === user.managerId) : undefined;
  const mismatch = repeat !== '' && next !== repeat;
  const same = next !== '' && next === current;
  const canSubmit = current !== '' && next.length >= 8 && next === repeat && !same;

  const setLanguage = async (l: Lang) => {
    setLangBusy(true); setLangError(null);
    try { await changeLanguage(l); } catch (e) { setLangError(e); } finally { setLangBusy(false); }
  };

  const change = async () => {
    setBusy(true); setError(null); setWrongCurrent(false); setOk(false);
    try {
      await api('PATCH', '/auth/me', { currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setRepeat(''); setOk(true);
    } catch (e) {
      if (isErrorCode(e, 'INVALID_CREDENTIALS')) setWrongCurrent(true); else setError(e);
    } finally { setBusy(false); }
  };

  return (
    <div className="sec-grid">
      <div>
        <Card title={L.myProfile} subtitle={`${user.fullName} · ${user.email}`}>
          <dl className="facts">
            <div><dt>{t('common.role')}</dt><dd>{t(`roles.${user.role}`)}</dd></div>
            {user.company && <div><dt>{L.company}</dt><dd>{user.company.name}</dd></div>}
            {user.companyId && <div><dt>{t('common.unit')}</dt><dd>{user.orgUnitName ?? <span className="muted">{L.noUnit}</span>}</dd></div>}
            {user.companyId && (
              <div><dt>{t('common.manager')}</dt>
                <dd>{manager ? <>{manager.fullName}{manager.jobTitle && <span className="sec-cell-sub">{manager.jobTitle}</span>}</> : <span className="muted">{user.managerId && users.loading ? t('common.loading') : L.noManager}</span>}</dd>
              </div>
            )}
            {user.jobTitle && <div><dt>{t('common.jobTitle')}</dt><dd>{user.jobTitle}</dd></div>}
            <div><dt>{L.lastLogin}</dt><dd>{date(user.lastLoginAt, locale, true)}</dd></div>
          </dl>
          <p className="hint small">{L.infoHint}</p>
        </Card>

        <Card title={L.changePassword}>
          <Field label={L.currentPassword} error={wrongCurrent ? L.wrongCurrent : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setWrongCurrent(false); setOk(false); }} />}
          </Field>
          <div className="grid-2">
            <Field label={L.newPassword} hint={L.passwordHint} error={same ? L.sameAsOld : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setOk(false); }} />}
            </Field>
            <Field label={L.repeatPassword} error={mismatch ? L.mismatch : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={repeat} onChange={(e) => { setRepeat(e.target.value); setOk(false); }} />}
            </Field>
          </div>
          <ErrorMessage error={error} />
          {ok && <Alert kind="success">{L.passwordChanged}</Alert>}
          <div className="sec-form-actions">
            <Button variant="primary" busy={busy} disabled={!canSubmit} onClick={change}><Icon name="lock" /> {L.changePassword}</Button>
          </div>
        </Card>
      </div>

      <div>
        <Card title={L.preferences}>
          <Field label={t('common.language')} hint={L.languageHint}>
            {(id) => <Select id={id} value={lang} disabled={langBusy} onChange={(e) => void setLanguage(e.target.value as Lang)}
              options={[{ value: 'az', label: 'Azərbaycan dili' }, { value: 'en', label: 'English' }]} />}
          </Field>
          <ErrorMessage error={langError} />
        </Card>

        {user.companyId && can('masterdata.view') && (
          <Card title={L.work}>
            <div className="sec-links">
              <Link to="/approvals" className="sec-link">
                <Icon name="inbox" size={20} />
                <span className="sec-link-body"><b>{L.pendingTasks}</b><small>{user.pendingTasks ? fmt(L.pendingTasksHint, { n: user.pendingTasks }) : L.noTasks}</small></span>
                {user.pendingTasks > 0 && <Badge tone="warning">{user.pendingTasks}</Badge>}
                <Icon name="chevron" />
              </Link>
              <Link to="/delegations" className="sec-link">
                <Icon name="delegate" size={20} />
                <span className="sec-link-body"><b>{L.delegations}</b><small>{L.delegationsHint}</small></span>
                <Icon name="chevron" />
              </Link>
            </div>
            <p className="hint small" style={{ marginTop: 12 }}>{L.approvalNote}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
