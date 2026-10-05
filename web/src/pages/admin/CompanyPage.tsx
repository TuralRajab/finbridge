import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MONTH_NAMES, type CompanyDto, type CurrencyDto, type IndustryTemplateDto, type Lang } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner, isErrorCode } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-security.css';

const az = {
  title: 'Şirkət və lisenziya',
  subtitle: 'Şirkətin rekvizitləri, baza valyutası, maliyyə ili və FinBridge lisenziyası.',
  profile: 'Şirkət profili',
  profileSub: 'Bu məlumatlar hesabatlarda, Excel ixracında və istifadəçilərin ilkin dil seçimində istifadə olunur.',
  readOnly: 'Profili yalnız Administrator dəyişə bilər.',
  name: 'Şirkətin adı',
  taxId: 'VÖEN',
  taxIdHint: 'Vergi ödəyicisinin eyniləşdirmə nömrəsi (10 rəqəm).',
  defaultLanguage: 'Defolt dil',
  defaultLanguageHint: 'Yeni istifadəçilər üçün təklif olunan interfeys dili.',
  fiscalStart: 'Maliyyə ilinin başlanğıc ayı',
  baseCurrency: 'Baza valyutası',
  baseHint: 'Büdcələr yaradıldıqdan sonra baza valyutasını dəyişmək olmaz.',
  baseLocked: 'Baza valyutası dəyişdirilmədi: şirkətdə artıq büdcə mövcuddur. Bütün məbləğlər mövcud baza valyutasında saxlanılır, ona görə də valyutanı yalnız büdcə yaradılmazdan əvvəl seçmək olar.',
  industry: 'Sənaye',
  industryNone: 'Seçilməyib',
  setup: 'Quraşdırma',
  setupDone: 'Tamamlanıb',
  setupPending: 'Tamamlanmayıb',
  openSetup: 'Quraşdırma ustasını açın',
  createdAt: 'Qeydiyyat tarixi',
  license: 'Lisenziya',
  plan: 'Tarif planı',
  seats: 'İstifadəçi yerləri',
  seatsValue: '{used} / {max}',
  seatsFree: '{n} boş yer',
  seatsNone: 'Boş yer yoxdur',
  validUntil: 'Etibarlılıq müddəti',
  daysLeft: '{n} gün qalıb',
  expired: 'Müddəti bitib',
  status: 'Vəziyyət',
  stActive: 'Aktiv',
  stSuspended: 'Dayandırılıb',
  stInvalid: 'Etibarsız',
  licenseHint: 'Lisenziyanı uzatmaq və ya istifadəçi sayını artırmaq üçün FinBridge ilə əlaqə saxlayın.',
  manageUsers: 'İstifadəçiləri idarə edin',
  reset: 'Dəyişiklikləri ləğv et',
};
const en: typeof az = {
  title: 'Company & licence',
  subtitle: 'Company details, base currency, fiscal year and FinBridge licence.',
  profile: 'Company profile',
  profileSub: 'Used in reports, Excel exports and as the default language suggested for new users.',
  readOnly: 'Only an Administrator can change the profile.',
  name: 'Company name',
  taxId: 'Tax ID (VÖEN)',
  taxIdHint: 'Taxpayer identification number (10 digits).',
  defaultLanguage: 'Default language',
  defaultLanguageHint: 'Interface language suggested for new users.',
  fiscalStart: 'Fiscal year start month',
  baseCurrency: 'Base currency',
  baseHint: 'The base currency cannot change once budgets exist.',
  baseLocked: 'The base currency was not changed: the company already has budgets. All amounts are stored in the current base currency, so it can only be chosen before the first budget is created.',
  industry: 'Industry',
  industryNone: 'Not selected',
  setup: 'Setup',
  setupDone: 'Completed',
  setupPending: 'Not completed',
  openSetup: 'Open the setup wizard',
  createdAt: 'Registered on',
  license: 'Licence',
  plan: 'Plan',
  seats: 'User seats',
  seatsValue: '{used} / {max}',
  seatsFree: '{n} seats free',
  seatsNone: 'No free seats',
  validUntil: 'Valid until',
  daysLeft: '{n} days left',
  expired: 'Expired',
  status: 'Status',
  stActive: 'Active',
  stSuspended: 'Suspended',
  stInvalid: 'Invalid',
  licenseHint: 'Contact FinBridge to extend the licence or add user seats.',
  manageUsers: 'Manage users',
  reset: 'Discard changes',
};
const TEXT = { az, en };

interface Form { name: string; taxId: string; defaultLanguage: Lang; fiscalYearStartMonth: number; baseCurrency: string }
const toForm = (c: CompanyDto): Form => ({ name: c.name, taxId: c.taxId ?? '', defaultLanguage: c.defaultLanguage, fiscalYearStartMonth: c.fiscalYearStartMonth, baseCurrency: c.baseCurrency });

export function CompanyPage() {
  const L = useLocal(TEXT);
  const { t, lang, locale } = useI18n();
  const { can, refresh } = useAuth();
  const editable = can('company.manage');
  const { data, setData, error, loading } = useAsync(async () => {
    const [company, currencies, templates] = await Promise.all([
      api<CompanyDto>('GET', '/company'),
      api<CurrencyDto[]>('GET', '/company/currencies'),
      api<IndustryTemplateDto[]>('GET', '/templates').catch(() => [] as IndustryTemplateDto[]),
    ]);
    return { company, currencies, templates };
  }, []);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [baseError, setBaseError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setF(toForm(data.company)); }, [data]);

  if (loading && !data) return <Spinner />;
  if (error || !data || !f) return <ErrorMessage error={error} />;

  const c = data.company;
  const lic = c.license;
  const orig = toForm(c);
  const dirty = JSON.stringify(f) !== JSON.stringify(orig);
  const valid = f.name.trim().length >= 2 && f.taxId.trim().length <= 20;
  const industry = c.industryCode ? data.templates.find((x) => x.code === c.industryCode) : undefined;
  const days = Math.ceil((new Date(`${lic.validUntil}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  const free = Math.max(0, lic.maxUsers - lic.usedUsers);
  const seatPct = lic.maxUsers ? Math.min(100, (lic.usedUsers / lic.maxUsers) * 100) : 100;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF({ ...f, [k]: v }); setSaved(false); };

  const save = async () => {
    setBusy(true); setSaveError(null); setBaseError(false); setSaved(false);
    const body: Record<string, unknown> = {};
    if (f.name.trim() !== orig.name) body.name = f.name.trim();
    if (f.taxId.trim() !== orig.taxId) body.taxId = f.taxId.trim() || null;
    if (f.defaultLanguage !== orig.defaultLanguage) body.defaultLanguage = f.defaultLanguage;
    if (f.fiscalYearStartMonth !== orig.fiscalYearStartMonth) body.fiscalYearStartMonth = f.fiscalYearStartMonth;
    if (f.baseCurrency !== orig.baseCurrency) body.baseCurrency = f.baseCurrency;
    try {
      const company = await api<CompanyDto>('PATCH', '/company', body);
      setData({ ...data, company });
      setSaved(true);
      void refresh().catch(() => undefined);
    } catch (e) {
      if (body.baseCurrency && isErrorCode(e, 'CONFLICT')) setBaseError(true); else setSaveError(e);
    } finally { setBusy(false); }
  };

  const licStatus = lic.status === 'SUSPENDED' ? [L.stSuspended, 'danger'] : lic.isValid ? [L.stActive, 'success'] : [L.stInvalid, 'danger'];

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <div className="sec-grid">
        <Card title={L.profile} subtitle={L.profileSub}>
          {!editable && <Alert kind="info">{L.readOnly}</Alert>}
          <div className="grid-2">
            <Field label={L.name}>{(id) => <Input id={id} value={f.name} maxLength={160} disabled={!editable} onChange={(e) => set('name', e.target.value)} />}</Field>
            <Field label={L.taxId} hint={L.taxIdHint}>{(id) => <Input id={id} value={f.taxId} maxLength={20} inputMode="numeric" disabled={!editable} onChange={(e) => set('taxId', e.target.value)} />}</Field>
          </div>
          <div className="grid-2">
            <Field label={L.defaultLanguage} hint={L.defaultLanguageHint}>
              {(id) => <Select id={id} value={f.defaultLanguage} disabled={!editable} onChange={(e) => set('defaultLanguage', e.target.value as Lang)}
                options={[{ value: 'az', label: 'Azərbaycan dili' }, { value: 'en', label: 'English' }]} />}
            </Field>
            <Field label={L.fiscalStart}>
              {(id) => <Select id={id} value={f.fiscalYearStartMonth} disabled={!editable} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}
                options={MONTH_NAMES[lang].map((m, i) => ({ value: i + 1, label: m }))} />}
            </Field>
          </div>
          <div className="grid-2">
            <Field label={L.baseCurrency} hint={L.baseHint}>
              {(id) => <Select id={id} value={f.baseCurrency} disabled={!editable} onChange={(e) => { set('baseCurrency', e.target.value); setBaseError(false); }}
                options={data.currencies.map((x) => ({ value: x.code, label: `${x.code} · ${lang === 'en' ? x.nameEn : x.nameAz}` }))} />}
            </Field>
            <div />
          </div>
          {baseError && <Alert kind="error">{L.baseLocked}</Alert>}
          <ErrorMessage error={saveError} />
          {saved && <Alert kind="success">{t('common.saved')}</Alert>}
          {editable && (
            <div className="sec-form-actions">
              <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setF(orig); setBaseError(false); setSaveError(null); }}>{L.reset}</Button>
              <Button variant="primary" busy={busy} disabled={!dirty || !valid} onClick={save}>{t('common.save')}</Button>
            </div>
          )}
          <hr className="sec-hr" />
          <dl className="facts">
            <div><dt>{L.industry}</dt><dd>{industry ? (lang === 'en' ? industry.nameEn : industry.nameAz) : c.industryCode ?? <span className="muted">{L.industryNone}</span>}</dd></div>
            <div>
              <dt>{L.setup}</dt>
              <dd>
                {c.setupCompleted ? <Badge tone="success"><Icon name="check" /> {L.setupDone}</Badge> : <Badge tone="warning"><span aria-hidden="true">!</span> {L.setupPending}</Badge>}
                {can('templates.apply') && <> <Link to="/setup" className="small">{L.openSetup} →</Link></>}
              </dd>
            </div>
            <div><dt>{L.createdAt}</dt><dd>{date(c.createdAt, locale)}</dd></div>
          </dl>
        </Card>

        <Card title={L.license} actions={<Badge tone={licStatus[1]}>{licStatus[0]}</Badge>}>
          <dl className="facts">
            <div><dt>{L.plan}</dt><dd>{t(`company.plans.${lic.plan}`)}</dd></div>
            <div><dt>{L.validUntil}</dt><dd>{date(lic.validUntil, locale)}<span className="sec-cell-sub">{days >= 0 ? fmt(L.daysLeft, { n: days }) : L.expired}</span></dd></div>
          </dl>
          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{L.seats}</b>
              <span className="num"><b>{fmt(L.seatsValue, { used: lic.usedUsers, max: lic.maxUsers })}</b></span>
            </div>
            <div className="sec-seats">
              <div className={`progress${free === 0 ? ' is-full' : seatPct >= 85 ? ' is-near' : ''}`} style={{ width: '100%' }}
                role="img" aria-label={`${L.seats}: ${fmt(L.seatsValue, { used: lic.usedUsers, max: lic.maxUsers })}`}>
                <span style={{ width: `${seatPct}%` }} />
              </div>
            </div>
            <small className="hint">{free ? fmt(L.seatsFree, { n: free }) : L.seatsNone}</small>
          </div>
          {(days >= 0 && days <= 30) || !lic.isValid || free === 0 ? <Alert kind="warning">{L.licenseHint}</Alert> : <p className="muted small">{L.licenseHint}</p>}
          {can('users.manage') && <p><Link to="/admin/users">{L.manageUsers} →</Link></p>}
        </Card>
      </div>
    </>
  );
}
