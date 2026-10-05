import { useMemo, useState } from 'react';
import { LICENSE_PLANS, type CurrencyDto, type Lang, type LicensePlan, type PlatformCompanyDto } from '@finbridge/shared';
import { api } from '../api/client';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';
import { fmt, useI18n, useLocal } from '../i18n';
import { date } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import '../styles/admin-security.css';

const az = {
  title: 'Şirkətlər və lisenziyalar',
  subtitle: 'FinBridge platformasının müştəri şirkətləri, tarif planları, istifadəçi limitləri və lisenziya müddətləri.',
  newCompany: 'Yeni şirkət',
  editLicense: 'Şirkət və lisenziya',
  searchPh: 'Şirkət, VÖEN və ya e-poçt…',
  company: 'Şirkət',
  taxId: 'VÖEN',
  plan: 'Tarif planı',
  seats: 'İstifadəçilər',
  validUntil: 'Etibarlıdır',
  status: 'Vəziyyət',
  admin: 'Administrator',
  setup: 'Quraşdırma',
  setupDone: 'Tamamlanıb',
  setupPending: 'Gözləyir',
  stActive: 'Aktiv',
  stSuspended: 'Dayandırılıb',
  stExpired: 'Müddəti bitib',
  daysLeft: '{n} gün',
  kpiCompanies: 'Şirkətlər',
  kpiActive: 'Aktiv lisenziya',
  kpiSeats: 'İstifadə olunan yerlər',
  kpiExpiring: '30 gün ərzində bitir',
  name: 'Şirkətin adı',
  baseCurrency: 'Baza valyutası',
  defaultLanguage: 'Defolt dil',
  maxUsers: 'Maksimum istifadəçi sayı',
  maxUsersHint: 'Hazırda {n} aktiv istifadəçi var.',
  maxUsersBelow: 'Limit aktiv istifadəçi sayından azdır: bəzi istifadəçilər deaktiv edilənədək şirkət yeni istifadəçi əlavə edə bilməyəcək.',
  licenseStatus: 'Lisenziya vəziyyəti',
  suspendHint: 'Dayandırılmış şirkətin istifadəçiləri sistemə daxil ola bilmir.',
  adminSection: 'Şirkət administratoru',
  adminSectionHint: 'Şirkət ADMIN rolu ilə bu istifadəçi ilə yaradılır. Sonra administrator quraşdırma ustasından keçir.',
  adminName: 'Ad, soyad',
  adminEmail: 'E-poçt (giriş adı)',
  adminPassword: 'İlkin şifrə',
  passwordHint: 'Ən azı 8 simvol.',
  fixedAfterCreate: 'Yaradıldıqdan sonra yalnız şirkətin öz administratoru dəyişə bilər.',
  suspend: 'Dayandır',
  resume: 'Bərpa et',
  confirmSuspendTitle: 'Lisenziya dayandırılsın?',
  confirmSuspend: '{name} şirkətinin bütün istifadəçiləri sistemə daxil ola bilməyəcək. Məlumatlar saxlanılır; lisenziyanı istənilən vaxt bərpa etmək olar.',
  shown: '{n} / {total} şirkət',
};
const en: typeof az = {
  title: 'Companies & licences',
  subtitle: 'Customer companies on the FinBridge platform, their plans, user limits and licence terms.',
  newCompany: 'New company',
  editLicense: 'Company & licence',
  searchPh: 'Company, tax ID or email…',
  company: 'Company',
  taxId: 'Tax ID',
  plan: 'Plan',
  seats: 'Users',
  validUntil: 'Valid until',
  status: 'Status',
  admin: 'Administrator',
  setup: 'Setup',
  setupDone: 'Completed',
  setupPending: 'Pending',
  stActive: 'Active',
  stSuspended: 'Suspended',
  stExpired: 'Expired',
  daysLeft: '{n} days',
  kpiCompanies: 'Companies',
  kpiActive: 'Active licences',
  kpiSeats: 'Seats in use',
  kpiExpiring: 'Expiring within 30 days',
  name: 'Company name',
  baseCurrency: 'Base currency',
  defaultLanguage: 'Default language',
  maxUsers: 'Maximum users',
  maxUsersHint: '{n} users are active now.',
  maxUsersBelow: 'The limit is below the number of active users: the company cannot add users until some are deactivated.',
  licenseStatus: 'Licence status',
  suspendHint: 'Users of a suspended company cannot sign in.',
  adminSection: 'Company administrator',
  adminSectionHint: 'The company is created with this user as ADMIN. The administrator then runs the setup wizard.',
  adminName: 'Full name',
  adminEmail: 'Email (login)',
  adminPassword: 'Initial password',
  passwordHint: 'At least 8 characters.',
  fixedAfterCreate: 'After creation only the company’s own administrator can change this.',
  suspend: 'Suspend',
  resume: 'Resume',
  confirmSuspendTitle: 'Suspend licence?',
  confirmSuspend: 'All users of {name} will be unable to sign in. Data is kept; the licence can be resumed at any time.',
  shown: '{n} of {total} companies',
};
const TEXT = { az, en };

const daysTo = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000);

export function PlatformPage() {
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useAsync(() => api<PlatformCompanyDto[]>('GET', '/platform/companies'), []);
  const [editing, setEditing] = useState<PlatformCompanyDto | 'new' | null>(null);
  const [confirm, setConfirm] = useState<PlatformCompanyDto | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const n = q.trim().toLocaleLowerCase(locale);
    return (data ?? []).filter((c) => !n || [c.name, c.taxId ?? '', c.adminEmail ?? ''].some((s) => s.toLocaleLowerCase(locale).includes(n)));
  }, [data, q, locale]);

  const setStatus = async (c: PlatformCompanyDto, status: 'ACTIVE' | 'SUSPENDED') => {
    setRowBusy(c.id); setRowError(null);
    try { await api('PATCH', `/platform/companies/${c.id}`, { status }); await reload(); } catch (e) { setRowError(e); } finally { setRowBusy(null); }
  };

  const all = data ?? [];
  const kpis = [
    { label: L.kpiCompanies, value: all.length },
    { label: L.kpiActive, value: all.filter((c) => c.license.isValid).length },
    { label: L.kpiSeats, value: `${all.reduce((s, c) => s + c.license.usedUsers, 0)} / ${all.reduce((s, c) => s + c.license.maxUsers, 0)}` },
    { label: L.kpiExpiring, value: all.filter((c) => c.license.status === 'ACTIVE' && daysTo(c.license.validUntil) >= 0 && daysTo(c.license.validUntil) <= 30).length },
  ];

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle}
        actions={<Button variant="primary" onClick={() => setEditing('new')}><Icon name="plus" /> {L.newCompany}</Button>} />
      {data && (
        <div className="kpis">
          {kpis.map((k) => (
            <div key={k.label} className="kpi"><div className="kpi-label">{k.label}</div><div className="kpi-value num">{k.value}</div></div>
          ))}
        </div>
      )}
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" aria-label={t('common.search')} placeholder={L.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
          {data && <span className="muted small">{fmt(L.shown, { n: rows.length, total: data.length })}</span>}
        </div>
        {rowError ? <div className="card-body"><ErrorMessage error={rowError} /></div> : null}
        {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : !rows.length ? <Empty>{t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.company}</th><th>{L.taxId}</th><th>{L.plan}</th><th className="r">{L.seats}</th><th>{L.validUntil}</th>
                <th>{L.status}</th><th>{L.setup}</th><th>{L.admin}</th><th className="r">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {rows.map((c) => {
                  const d = daysTo(c.license.validUntil);
                  const st = c.license.status === 'SUSPENDED' ? [L.stSuspended, 'danger'] : !c.license.isValid ? [L.stExpired, 'danger'] : [L.stActive, 'success'];
                  const full = c.license.usedUsers >= c.license.maxUsers;
                  return (
                    <tr key={c.id}>
                      <td><b>{c.name}</b><span className="sec-cell-sub">{c.baseCurrency} · {c.defaultLanguage.toUpperCase()}</span></td>
                      <td className="muted">{c.taxId ?? '—'}</td>
                      <td>{t(`company.plans.${c.license.plan}`)}</td>
                      <td className="r num">{c.license.usedUsers} / {c.license.maxUsers}{full && <span className="sec-cell-sub">100%</span>}</td>
                      <td className="sec-nowrap">
                        {date(c.license.validUntil, locale)}
                        {d >= 0 && d <= 30 && <span className="sec-cell-sub">{fmt(L.daysLeft, { n: d })}</span>}
                      </td>
                      <td><Badge tone={st[1]}>{st[0]}</Badge></td>
                      <td>{c.setupCompleted ? <Badge tone="success">{L.setupDone}</Badge> : <Badge tone="warning">{L.setupPending}</Badge>}</td>
                      <td className="muted">{c.adminEmail ?? '—'}</td>
                      <td className="r">
                        <div className="row-actions">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>{t('common.edit')}</Button>
                          {c.license.status === 'ACTIVE'
                            ? <Button size="sm" variant="ghost" busy={rowBusy === c.id} onClick={() => setConfirm(c)}>{L.suspend}</Button>
                            : <Button size="sm" variant="ghost" busy={rowBusy === c.id} onClick={() => void setStatus(c, 'ACTIVE')}>{L.resume}</Button>}
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
      {editing && <CompanyModal company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {confirm && (
        <Modal title={L.confirmSuspendTitle} onClose={() => setConfirm(null)} footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { const c = confirm; setConfirm(null); void setStatus(c, 'SUSPENDED'); }}>{L.suspend}</Button>
        </>}>
          <p>{fmt(L.confirmSuspend, { name: confirm.name })}</p>
        </Modal>
      )}
    </>
  );
}

function CompanyModal({ company, onClose, onSaved }: { company: PlatformCompanyDto | null; onClose: () => void; onSaved: () => void }) {
  const L = useLocal(TEXT);
  const { t, lang } = useI18n();
  const currencies = useAsync(() => api<CurrencyDto[]>('GET', '/company/currencies'), []);
  const nextYear = `${new Date().getFullYear() + 1}-12-31`;
  const [f, setF] = useState({
    name: company?.name ?? '', taxId: company?.taxId ?? '', baseCurrency: company?.baseCurrency ?? 'AZN',
    defaultLanguage: (company?.defaultLanguage ?? 'az') as Lang, plan: (company?.license.plan ?? 'PILOT') as LicensePlan,
    maxUsers: String(company?.license.maxUsers ?? 10), validUntil: company?.license.validUntil ?? nextYear,
    status: company?.license.status ?? 'ACTIVE', adminName: '', adminEmail: '', adminPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const max = Number(f.maxUsers);
  const maxValid = Number.isInteger(max) && max >= 1 && max <= 10000;
  const belowUsed = !!company && maxValid && max < company.license.usedUsers;
  const valid = f.name.trim().length >= 2 && maxValid && /^\d{4}-\d{2}-\d{2}$/.test(f.validUntil)
    && (company ? true : f.adminName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.adminEmail) && f.adminPassword.length >= 8);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (company) {
        await api('PATCH', `/platform/companies/${company.id}`, { name: f.name.trim(), plan: f.plan, maxUsers: max, validUntil: f.validUntil, status: f.status });
      } else {
        await api('POST', '/platform/companies', {
          name: f.name.trim(), taxId: f.taxId.trim() || null, baseCurrency: f.baseCurrency, defaultLanguage: f.defaultLanguage,
          plan: f.plan, maxUsers: max, validUntil: f.validUntil,
          admin: { fullName: f.adminName.trim(), email: f.adminEmail.trim(), password: f.adminPassword },
        });
      }
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const currencyOptions = (currencies.data ?? []).map((c) => ({ value: c.code, label: `${c.code} · ${lang === 'en' ? c.nameEn : c.nameAz}` }));
  if (!currencyOptions.some((o) => o.value === f.baseCurrency)) currencyOptions.unshift({ value: f.baseCurrency, label: f.baseCurrency });

  return (
    <Modal wide title={company ? `${L.editLicense} · ${company.name}` : L.newCompany} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!valid} onClick={save}>{company ? t('common.save') : t('common.create')}</Button>
    </>}>
      <div className="grid-2">
        <Field label={L.name}>{(id) => <Input id={id} value={f.name} maxLength={160} onChange={set('name')} />}</Field>
        <Field label={L.taxId} hint={company ? L.fixedAfterCreate : undefined}>{(id) => <Input id={id} value={f.taxId} maxLength={20} onChange={set('taxId')} disabled={!!company} />}</Field>
      </div>
      <div className="grid-2">
        <Field label={L.baseCurrency} hint={company ? L.fixedAfterCreate : undefined}>
          {(id) => <Select id={id} value={f.baseCurrency} onChange={set('baseCurrency')} disabled={!!company} options={currencyOptions} />}
        </Field>
        <Field label={L.defaultLanguage} hint={company ? L.fixedAfterCreate : undefined}>
          {(id) => <Select id={id} value={f.defaultLanguage} onChange={set('defaultLanguage')} disabled={!!company}
            options={[{ value: 'az', label: 'Azərbaycan dili' }, { value: 'en', label: 'English' }]} />}
        </Field>
      </div>
      <h3 className="h3">{L.editLicense}</h3>
      <div className="grid-2">
        <Field label={L.plan}>{(id) => <Select id={id} value={f.plan} onChange={set('plan')} options={LICENSE_PLANS.map((p) => ({ value: p, label: t(`company.plans.${p}`) }))} />}</Field>
        <Field label={L.maxUsers} hint={company ? fmt(L.maxUsersHint, { n: company.license.usedUsers }) : undefined}>
          {(id) => <Input id={id} type="number" min={1} max={10000} className="num" value={f.maxUsers} onChange={set('maxUsers')} />}
        </Field>
      </div>
      <div className="grid-2">
        <Field label={L.validUntil}>{(id) => <Input id={id} type="date" value={f.validUntil} onChange={set('validUntil')} />}</Field>
        {company
          ? <Field label={L.licenseStatus} hint={L.suspendHint}>
              {(id) => <Select id={id} value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: L.stActive }, { value: 'SUSPENDED', label: L.stSuspended }]} />}
            </Field>
          : <div />}
      </div>
      {!company && (
        <>
          <h3 className="h3">{L.adminSection}</h3>
          <p className="muted small mb-8">{L.adminSectionHint}</p>
          <Field label={L.adminName}>{(id) => <Input id={id} value={f.adminName} maxLength={120} onChange={set('adminName')} />}</Field>
          <div className="grid-2">
            <Field label={L.adminEmail}>{(id) => <Input id={id} type="email" autoComplete="off" value={f.adminEmail} onChange={set('adminEmail')} />}</Field>
            <Field label={L.adminPassword} hint={L.passwordHint}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.adminPassword} onChange={set('adminPassword')} />}</Field>
          </div>
        </>
      )}
      {belowUsed && <Alert kind="warning">{L.maxUsersBelow}</Alert>}
      <ErrorMessage error={error} />
    </Modal>
  );
}
