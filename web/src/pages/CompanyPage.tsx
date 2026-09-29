import { useState } from 'react';
import type { CompanyDto } from '@finbridge/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Input, PageHeader, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { date } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ProfileCard } from './ProfilePage';

export function CompanyPage() {
  const { t, locale } = useI18n();
  const { can, refresh } = useAuth();
  const { data, setData, loading, error } = useAsync(() => api<CompanyDto>('GET', '/company'), []);
  const [name, setName] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error} />;
  const l = data.license;
  const editable = can('company.manage');

  const save = async () => {
    setBusy(true); setSaveError(null); setSaved(false);
    try {
      setData(await api<CompanyDto>('PATCH', '/company', { name: name ?? data.name, taxId: taxId ?? data.taxId }));
      setSaved(true);
      await refresh();
    } catch (e) { setSaveError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={t('company.title')} />
      <div className="grid-2 gap-lg">
        <Card title={t('company.profile')}>
          <Field label={t('company.name')}>{(id) => <Input id={id} disabled={!editable} value={name ?? data.name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t('company.taxId')}>{(id) => <Input id={id} disabled={!editable} value={taxId ?? data.taxId ?? ''} onChange={(e) => setTaxId(e.target.value)} />}</Field>
          <ErrorMessage error={saveError} />
          {saved && <Alert kind="success">{t('common.saved')}</Alert>}
          {editable && <Button variant="primary" busy={busy} onClick={save}>{t('common.save')}</Button>}
        </Card>
        <Card title={t('company.license')} actions={<Badge tone={l.isValid ? 'success' : 'danger'}>{l.isValid ? t('company.licenseValid') : t('company.licenseInvalid')}</Badge>}>
          <dl className="facts">
            <div><dt>{t('company.plan')}</dt><dd>{t(`company.plans.${l.plan}`)}</dd></div>
            <div><dt>{t('company.seats')}</dt><dd>{l.usedUsers} / {l.maxUsers}</dd></div>
            <div><dt>{t('company.validUntil')}</dt><dd>{date(l.validUntil, locale)}</dd></div>
            <div><dt>{t('common.currency')}</dt><dd>{data.baseCurrency}</dd></div>
          </dl>
          <div className="progress"><span style={{ width: `${Math.min(100, (l.usedUsers / l.maxUsers) * 100)}%` }} /></div>
        </Card>
      </div>
      <ProfileCard />
    </>
  );
}
