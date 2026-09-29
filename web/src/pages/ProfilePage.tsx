import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, ErrorMessage, Field, Input, PageHeader, Select } from '../components/ui';
import { useI18n } from '../i18n';

export function ProfilePage() {
  const { t } = useI18n();
  return <><PageHeader title={t('profile.title')} /><ProfileCard /></>;
}

export function ProfileCard() {
  const { t, lang } = useI18n();
  const { user, changeLanguage } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  if (!user) return null;
  const change = async () => {
    setBusy(true); setError(null); setOk(false);
    try {
      await api('PATCH', '/auth/me', { currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setOk(true);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title={t('company.myProfile')} subtitle={`${user.fullName} · ${user.email} · ${t(`roles.${user.role}`)}`}>
      <div className="grid-2 gap-lg">
        <div>
          <Field label={t('company.language')}>
            {(id) => <Select id={id} value={lang} onChange={(e) => void changeLanguage(e.target.value as 'az' | 'en')}
              options={[{ value: 'az', label: 'Azərbaycan dili' }, { value: 'en', label: 'English' }]} />}
          </Field>
        </div>
        <div>
          <h3 className="h3">{t('company.changePassword')}</h3>
          <Field label={t('company.currentPassword')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
          <Field label={t('company.newPassword')} hint={t('users.passwordHint')}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
          <ErrorMessage error={error} />
          {ok && <Alert kind="success">{t('common.saved')}</Alert>}
          <Button variant="primary" busy={busy} disabled={!current || next.length < 8} onClick={change}>{t('company.changePassword')}</Button>
        </div>
      </div>
    </Card>
  );
}
