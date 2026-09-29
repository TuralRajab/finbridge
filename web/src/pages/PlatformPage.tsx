import { useState } from 'react';
import { LICENSE_PLANS, type PlatformCompanyDto } from '@finbridge/shared';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { date } from '../lib/format';
import { useAsync } from '../lib/useAsync';

type Editing = { company: PlatformCompanyDto | null };

export function PlatformPage() {
  const { t, locale } = useI18n();
  const { data, loading, error, reload } = useAsync(() => api<PlatformCompanyDto[]>('GET', '/platform/companies'), []);
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <>
      <PageHeader title={t('platform.title')} subtitle={t('platform.subtitle')}
        actions={<Button variant="primary" onClick={() => setEditing({ company: null })}><Icon name="plus" /> {t('platform.new')}</Button>} />
      <Card flush>
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !data?.length ? <Empty>{t('common.noData')}</Empty> : (
          <table className="table">
            <thead><tr>
              <th>{t('company.name')}</th><th>{t('company.taxId')}</th><th>{t('company.plan')}</th><th className="r">{t('company.seats')}</th>
              <th>{t('company.validUntil')}</th><th>{t('common.status')}</th><th>{t('platform.admin')}</th><th />
            </tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setEditing({ company: c })}>
                  <td><b>{c.name}</b></td>
                  <td className="muted">{c.taxId ?? '—'}</td>
                  <td>{t(`company.plans.${c.license.plan}`)}</td>
                  <td className="r num">{c.license.usedUsers} / {c.license.maxUsers}</td>
                  <td>{date(c.license.validUntil, locale)}</td>
                  <td><Badge tone={c.license.isValid ? 'success' : 'danger'}>{c.license.status === 'SUSPENDED' ? t('platform.suspend') : c.license.isValid ? t('company.licenseValid') : t('company.licenseInvalid')}</Badge></td>
                  <td className="muted">{c.adminEmail ?? '—'}</td>
                  <td className="r muted"><Icon name="chevron" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <CompanyModal company={editing.company} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </>
  );
}

function CompanyModal({ company, onClose, onSaved }: { company: PlatformCompanyDto | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const nextYear = `${new Date().getFullYear() + 1}-12-31`;
  const [f, setF] = useState({
    name: company?.name ?? '', taxId: company?.taxId ?? '', plan: company?.license.plan ?? 'PILOT',
    maxUsers: String(company?.license.maxUsers ?? 10), validUntil: company?.license.validUntil ?? nextYear,
    status: company?.license.status ?? 'ACTIVE', adminName: '', adminEmail: '', adminPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (company) {
        await api('PATCH', `/platform/companies/${company.id}`, { name: f.name, plan: f.plan, maxUsers: Number(f.maxUsers), validUntil: f.validUntil, status: f.status });
      } else {
        await api('POST', '/platform/companies', {
          name: f.name, taxId: f.taxId || null, plan: f.plan, maxUsers: Number(f.maxUsers), validUntil: f.validUntil,
          admin: { fullName: f.adminName, email: f.adminEmail, password: f.adminPassword },
        });
      }
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={company ? t('platform.editLicense') : t('platform.new')} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} onClick={save}>{company ? t('common.save') : t('common.create')}</Button>
    </>}>
      <div className="grid-2">
        <Field label={t('company.name')}>{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field>
        <Field label={t('company.taxId')}>{(id) => <Input id={id} value={f.taxId} onChange={set('taxId')} disabled={!!company} />}</Field>
      </div>
      <div className="grid-2">
        <Field label={t('company.plan')}>{(id) => <Select id={id} value={f.plan} onChange={set('plan')} options={LICENSE_PLANS.map((p) => ({ value: p, label: t(`company.plans.${p}`) }))} />}</Field>
        <Field label={t('company.seats')}>{(id) => <Input id={id} type="number" min={1} value={f.maxUsers} onChange={set('maxUsers')} />}</Field>
      </div>
      <div className="grid-2">
        <Field label={t('company.validUntil')}>{(id) => <Input id={id} type="date" value={f.validUntil} onChange={set('validUntil')} />}</Field>
        {company && <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: t('company.licenseValid') }, { value: 'SUSPENDED', label: t('platform.suspend') }]} />}</Field>}
      </div>
      {!company && (
        <>
          <h3 className="h3">{t('platform.admin')}</h3>
          <Field label={t('platform.adminName')}>{(id) => <Input id={id} value={f.adminName} onChange={set('adminName')} />}</Field>
          <div className="grid-2">
            <Field label={t('platform.adminEmail')}>{(id) => <Input id={id} type="email" value={f.adminEmail} onChange={set('adminEmail')} />}</Field>
            <Field label={t('platform.adminPassword')} hint={t('users.passwordHint')}>{(id) => <Input id={id} type="password" value={f.adminPassword} onChange={set('adminPassword')} />}</Field>
          </div>
        </>
      )}
      <ErrorMessage error={error} />
    </Modal>
  );
}
