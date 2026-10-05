import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CompanyDto, CurrencyDto, IndustryTemplateDetailDto, IndustryTemplateDto, Lang, SetupApplyResult } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { Stat, TemplateAccountTree, TemplateKpis, TemplateStructure, TemplateSummary, TemplateWorkflows, excludedCodes, tplDesc, tplName } from './templateView';
import '../../styles/admin-org.css';

const az = {
  eyebrow: 'Şirkətin quraşdırılması',
  title: 'Quraşdırma ustası',
  subtitle: 'Sənaye şablonu əsasında hesablar planını, təşkilati strukturu, xərc mərkəzlərini və təsdiq axınlarını yaradın.',
  steps: ['Şirkət', 'Sahə', 'Şablon', 'Hesablar', 'Seçimlər', 'Tətbiq'],
  stepOf: 'Addım {n} / {total}',
  reapplyTitle: 'Şirkət artıq quraşdırılıb',
  reapply: 'Şablonu yenidən tətbiq etmək təhlükəsizdir: məlumatlar kod üzrə birləşdirilir — yalnız mövcud olmayan hesablar, vahidlər, xərc mərkəzləri və axınlar yaradılır, mövcud qeydlər dəyişdirilmir və silinmir.',
  companyTitle: 'Şirkət məlumatları',
  companySub: 'Bu məlumatlar hesabatlarda və Excel ixracında istifadə olunur.',
  name: 'Şirkətin adı', taxId: 'VÖEN', taxHint: '10 rəqəmli vergi ödəyicisinin eyniləşdirmə nömrəsi',
  baseCurrency: 'Əsas valyuta', currencyLocked: 'Büdcələr yaradıldıqdan sonra əsas valyuta dəyişdirilə bilməz.',
  defaultLanguage: 'Defolt dil', languageHint: 'Yeni istifadəçilər və bildirişlər üçün.', languageNoRight: 'Dili yalnız administrator dəyişə bilər.',
  fyStart: 'Maliyyə ilinin başlanğıc ayı',
  nameRequired: 'Şirkətin adı ən azı 2 simvol olmalıdır.',
  industryTitle: 'Fəaliyyət sahəsini seçin',
  industrySub: 'Şablon başlanğıc nöqtəsidir: sonradan hər şeyi dəyişə, deaktiv edə və genişləndirə bilərsiniz.',
  accounts: '{n} hesab', current: 'Cari şablon', chooseIndustry: 'Davam etmək üçün sahəni seçin.',
  overviewTitle: 'Tövsiyə olunan şablon',
  structure: 'Təşkilati struktur və xərc mərkəzləri', workflows: 'Təsdiq axınları', kpis: 'KPI və fərziyyələr',
  reviewTitle: 'Hesablar planını nəzərdən keçirin',
  reviewSub: 'İstifadə etməyəcəyiniz hesabların işarəsini götürün. Bütün hesabları çıxarılmış qrup da yaradılmır.',
  excluded: '{n} hesab çıxarılıb',
  optionsTitle: 'Nə tətbiq olunsun?',
  optAccounts: 'Hesablar planı', optAccountsHint: '{n} hesab (çıxarılanlar nəzərə alınmaqla), qruplar və OPEX/CAPEX təsnifatı.',
  optStructure: 'Təşkilati struktur', optStructureHint: '{n} struktur vahidi, peşə ailələri və büdcə bölməsi olan vahid növləri.',
  optCc: 'Xərc mərkəzləri', optCcHint: '{n} xərc mərkəzi. Vahidi olmayan xərc mərkəzləri ötürülür — strukturla birlikdə tətbiq edin.',
  optWorkflows: 'Təsdiq axınları', optWorkflowsHint: '{n} axın: büdcə təqdimatı, təsdiq, dəyişiklik və sorğular.',
  recordLanguage: 'Yaradılan qeydlərin dili', recordLanguageHint: 'Əsas ad bu dildə, ikinci dil isə “Ad (ingiliscə)” sahəsinə yazılır.',
  azLang: 'Azərbaycan dili', enLang: 'İngilis dili',
  ccWithoutStructure: 'Struktur tətbiq olunmadan xərc mərkəzləri yalnız şirkətdə artıq mövcud olan eyni kodlu vahidlərə bağlanır.',
  nothing: 'Ən azı bir bölmə seçin.',
  applyTitle: 'Təsdiq edin və tətbiq edin',
  applySub: 'Aşağıdakı dəyişikliklər bir əməliyyatda tətbiq olunacaq.',
  company: 'Şirkət', industry: 'Sahə', yes: 'Tətbiq olunur', no: 'Ötürülür',
  apply: 'Şablonu tətbiq et', applying: 'Tətbiq olunur…',
  doneTitle: 'Quraşdırma tamamlandı',
  doneSub: '“{tpl}” şablonu tətbiq olundu. Növbəti addım: strukturda rəhbərləri və xərc mərkəzi sahiblərini təyin edin, sonra büdcəni yaradın.',
  created: 'Yaradılan hesablar', skipped: 'Mövcud olduğu üçün ötürülən: {n}', units: 'Struktur vahidləri', ccs: 'Xərc mərkəzləri', wfs: 'Təsdiq axınları',
  goOrg: 'Struktura keç', goAccounts: 'Hesablar planı', goWorkflows: 'Təsdiq axınları', goBudgets: 'Büdcələr', again: 'Yenidən başla',
  langWarn: 'Şablon tətbiq olundu, lakin defolt dil yadda saxlanmadı:',
};
const TEXT = {
  az,
  en: {
    eyebrow: 'Company setup',
    title: 'Setup wizard',
    subtitle: 'Create the chart of accounts, organisation structure, cost centers and approval workflows from an industry template.',
    steps: ['Company', 'Industry', 'Template', 'Accounts', 'Options', 'Apply'],
    stepOf: 'Step {n} of {total}',
    reapplyTitle: 'The company is already set up',
    reapply: 'Re-applying a template is safe: data is merged by code — only missing accounts, units, cost centers and workflows are created; existing records are never changed or deleted.',
    companyTitle: 'Company details',
    companySub: 'Used in reports and Excel exports.',
    name: 'Company name', taxId: 'Tax ID (VÖEN)', taxHint: '10-digit taxpayer identification number',
    baseCurrency: 'Base currency', currencyLocked: 'The base currency cannot change once budgets exist.',
    defaultLanguage: 'Default language', languageHint: 'For new users and notifications.', languageNoRight: 'Only an administrator can change the language.',
    fyStart: 'Fiscal year start month',
    nameRequired: 'Company name must have at least 2 characters.',
    industryTitle: 'Choose your industry',
    industrySub: 'A template is a starting point: you can change, deactivate and extend everything later.',
    accounts: '{n} accounts', current: 'Current template', chooseIndustry: 'Choose an industry to continue.',
    overviewTitle: 'Recommended template',
    structure: 'Organisation structure and cost centers', workflows: 'Approval workflows', kpis: 'KPIs and assumptions',
    reviewTitle: 'Review the chart of accounts',
    reviewSub: 'Untick the accounts you will not use. A group whose accounts are all excluded is not created either.',
    excluded: '{n} accounts excluded',
    optionsTitle: 'What should be applied?',
    optAccounts: 'Chart of accounts', optAccountsHint: '{n} accounts (after exclusions), groups and OPEX/CAPEX classification.',
    optStructure: 'Organisation structure', optStructureHint: '{n} org units, job families and which unit types are budget sections.',
    optCc: 'Cost centers', optCcHint: '{n} cost centers. Cost centers without their unit are skipped — apply together with the structure.',
    optWorkflows: 'Approval workflows', optWorkflowsHint: '{n} workflows: budget submission, approval, changes and requests.',
    recordLanguage: 'Language of created records', recordLanguageHint: 'The primary name uses this language; the other goes to “Name (English)”.',
    azLang: 'Azerbaijani', enLang: 'English',
    ccWithoutStructure: 'Without the structure, cost centers are only linked to units with the same code that already exist.',
    nothing: 'Select at least one area.',
    applyTitle: 'Confirm and apply',
    applySub: 'The following changes are applied in a single transaction.',
    company: 'Company', industry: 'Industry', yes: 'Applied', no: 'Skipped',
    apply: 'Apply template', applying: 'Applying…',
    doneTitle: 'Setup complete',
    doneSub: 'Template “{tpl}” has been applied. Next: assign unit heads and cost center owners, then create the budget.',
    created: 'Accounts created', skipped: 'Skipped as existing: {n}', units: 'Org units', ccs: 'Cost centers', wfs: 'Approval workflows',
    goOrg: 'Go to organisation', goAccounts: 'Chart of accounts', goWorkflows: 'Approval workflows', goBudgets: 'Budgets', again: 'Start again',
    langWarn: 'The template was applied, but the default language was not saved:',
  } satisfies typeof az,
};

interface CompanyForm { name: string; taxId: string; baseCurrency: string; defaultLanguage: Lang; fiscalYearStartMonth: number }
interface Options { accounts: boolean; structure: boolean; costCenters: boolean; workflows: boolean; language: Lang }

export function SetupWizardPage() {
  const L = useLocal(TEXT);
  const { t, lang } = useI18n();
  const { user, can, refresh } = useAuth();
  const [params] = useSearchParams();
  const company = user?.company ?? null;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CompanyForm>(() => ({
    name: company?.name ?? '', taxId: company?.taxId ?? '', baseCurrency: company?.baseCurrency ?? 'AZN',
    defaultLanguage: company?.defaultLanguage ?? 'az', fiscalYearStartMonth: company?.fiscalYearStartMonth ?? 1,
  }));
  const [code, setCode] = useState<string | null>(params.get('template') ?? company?.industryCode ?? null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState<Options>({ accounts: true, structure: true, costCenters: true, workflows: true, language: company?.defaultLanguage ?? lang });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [langError, setLangError] = useState<unknown>(null);
  const [result, setResult] = useState<SetupApplyResult | null>(null);

  const templates = useAsync(() => api<IndustryTemplateDto[]>('GET', '/templates'), []);
  const currencies = useAsync(() => api<CurrencyDto[]>('GET', '/company/currencies'), []);
  const detail = useAsync(() => (code ? api<IndustryTemplateDetailDto>('GET', `/templates/${encodeURIComponent(code)}`) : Promise.resolve(null)), [code]);
  const tpl = detail.data && detail.data.code === code ? detail.data : null;

  // ?template=CODE (from the templates page) preselects the industry card.
  useEffect(() => { setExcluded(new Set()); }, [code]);
  useEffect(() => {
    const p = params.get('template');
    if (p) setCode(p);
  }, [params]);

  const months = t('months.short').split('|');
  const canLang = can('company.manage');
  const nameOk = form.name.trim().length >= 2;
  const leafCount = tpl ? tpl.accounts.filter((a) => !a.isGroup).length : 0;
  const includedLeaves = leafCount - excluded.size;
  const anything = opts.accounts || opts.structure || opts.costCenters || opts.workflows;

  const canNext = [nameOk, !!code, !!tpl, true, anything, false][step];
  const set = <K extends keyof CompanyForm>(k: K, v: CompanyForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const apply = async () => {
    if (!tpl) return;
    setBusy(true); setError(null); setLangError(null);
    try {
      const r = await api<SetupApplyResult>('POST', '/templates/apply', {
        company: { name: form.name.trim(), taxId: form.taxId.trim() || null, baseCurrency: form.baseCurrency, fiscalYearStartMonth: form.fiscalYearStartMonth },
        industryCode: tpl.code,
        accounts: opts.accounts,
        excludedAccountCodes: opts.accounts ? excludedCodes(tpl.accounts, excluded) : [],
        structure: opts.structure,
        costCenters: opts.costCenters,
        workflows: opts.workflows,
        language: opts.language,
      });
      if (canLang && company && form.defaultLanguage !== company.defaultLanguage) {
        try { await api<CompanyDto>('PATCH', '/company', { defaultLanguage: form.defaultLanguage }); } catch (e) { setLangError(e); }
      }
      setResult(r);
      await refresh();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const restart = () => { setResult(null); setStep(0); setError(null); };

  const header = <PageHeader eyebrow={<span className="muted">{L.eyebrow}</span>} title={L.title} subtitle={L.subtitle} />;

  if (result) {
    const name = tpl ? tplName(tpl, lang) : code ?? '';
    return (
      <div className="wizard">
        {header}
        <Card title={<><Icon name="check" /> {L.doneTitle}</>} subtitle={fmt(L.doneSub, { tpl: name })}>
          {langError ? <Alert kind="warning">{L.langWarn} <ErrorMessage error={langError} /></Alert> : null}
          <div className="summary-grid">
            <Stat label={L.created} value={result.accountsCreated} foot={fmt(L.skipped, { n: result.accountsSkipped })} />
            <Stat label={L.units} value={result.unitsCreated} />
            <Stat label={L.ccs} value={result.costCentersCreated} />
            <Stat label={L.wfs} value={result.workflowsCreated} />
          </div>
          <div className="result-links">
            <Link className="btn btn-primary" to="/admin/organization"><Icon name="org" /> {L.goOrg}</Link>
            <Link className="btn btn-secondary" to="/admin/accounts"><Icon name="accounts" /> {L.goAccounts}</Link>
            {can('workflow.manage') && <Link className="btn btn-secondary" to="/admin/workflows"><Icon name="workflow" /> {L.goWorkflows}</Link>}
            {can('budget.view') && <Link className="btn btn-secondary" to="/budgets"><Icon name="budget" /> {L.goBudgets}</Link>}
            <Button variant="ghost" onClick={restart}>{L.again}</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="wizard">
      {header}
      {company?.setupCompleted && <Alert kind="info"><b>{L.reapplyTitle}.</b> {L.reapply}</Alert>}

      <ol className="stepper" aria-label={fmt(L.stepOf, { n: step + 1, total: L.steps.length })}>
        {L.steps.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-dot">{i < step ? '✓' : i + 1}</span>
            <span className="step-label">{s}</span>
          </li>
        ))}
      </ol>

      <Card flush>
        <div className="card-body">
          {step === 0 && (
            <>
              <h2 className="card-title">{L.companyTitle}</h2>
              <p className="card-sub" style={{ marginBottom: 16 }}>{L.companySub}</p>
              <div className="grid-2">
                <Field label={L.name} error={!nameOk && form.name ? L.nameRequired : undefined}>
                  {(id) => <Input id={id} required value={form.name} maxLength={160} onChange={(e) => set('name', e.target.value)} />}
                </Field>
                <Field label={<>{L.taxId} <span className="muted">({t('common.optional')})</span></>} hint={L.taxHint}>
                  {(id) => <Input id={id} inputMode="numeric" maxLength={20} value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />}
                </Field>
                <Field label={L.baseCurrency} hint={company?.setupCompleted ? L.currencyLocked : undefined}>
                  {(id) => (
                    <Select id={id} value={form.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}
                      options={(currencies.data ?? [{ code: form.baseCurrency, nameAz: form.baseCurrency, nameEn: form.baseCurrency, symbol: '', decimals: 2 }])
                        .map((c) => ({ value: c.code, label: `${c.code} · ${lang === 'en' ? c.nameEn : c.nameAz}` }))} />
                  )}
                </Field>
                <Field label={L.fyStart}>
                  {(id) => <Select id={id} value={form.fiscalYearStartMonth} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}
                    options={months.map((m, i) => ({ value: i + 1, label: `${String(i + 1).padStart(2, '0')} · ${m}` }))} />}
                </Field>
                <Field label={L.defaultLanguage} hint={canLang ? L.languageHint : L.languageNoRight}>
                  {(id) => <Select id={id} value={form.defaultLanguage} disabled={!canLang} onChange={(e) => set('defaultLanguage', e.target.value as Lang)}
                    options={[{ value: 'az', label: L.azLang }, { value: 'en', label: L.enLang }]} />}
                </Field>
              </div>
              <ErrorMessage error={currencies.error} />
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="card-title">{L.industryTitle}</h2>
              <p className="card-sub" style={{ marginBottom: 16 }}>{L.industrySub}</p>
              {templates.loading && !templates.data ? <Spinner /> : templates.error ? <ErrorMessage error={templates.error} /> : !templates.data?.length ? <Empty>{t('common.noData')}</Empty> : (
                <div className="tpl-grid" role="radiogroup" aria-label={L.industryTitle}>
                  {templates.data.map((x) => (
                    <button key={x.code} type="button" role="radio" aria-checked={code === x.code}
                      className={`tpl-card${code === x.code ? ' is-selected' : ''}`} onClick={() => setCode(x.code)}>
                      <span className="tpl-check" aria-hidden="true">{code === x.code && <Icon name="check" size={12} />}</span>
                      <h3>{tplName(x, lang)}</h3>
                      <p>{tplDesc(x, lang)}</p>
                      <span className="tpl-meta">
                        <Badge tone="neutral">{fmt(L.accounts, { n: x.accountCount })}</Badge>
                        <Badge tone="muted">v{x.version}</Badge>
                        {company?.industryCode === x.code && <Badge tone="success">{L.current}</Badge>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            detail.loading && !tpl ? <Spinner /> : detail.error ? <ErrorMessage error={detail.error} /> : tpl && (
              <>
                <h2 className="card-title">{L.overviewTitle}: {tplName(tpl, lang)}</h2>
                <p className="card-sub" style={{ marginBottom: 16 }}>{tplDesc(tpl, lang)}</p>
                <TemplateSummary tpl={tpl} />
                <div className="grid-2 gap-lg" style={{ marginTop: 16 }}>
                  <div><h3 className="h3">{L.structure}</h3><TemplateStructure content={tpl.content} /></div>
                  <div><h3 className="h3">{L.workflows}</h3><TemplateWorkflows content={tpl.content} /></div>
                </div>
                <div style={{ marginTop: 16 }}><TemplateKpis content={tpl.content} /></div>
              </>
            )
          )}

          {step === 3 && tpl && (
            <>
              <h2 className="card-title">{L.reviewTitle}</h2>
              <p className="card-sub">{L.reviewSub} {excluded.size > 0 && <Badge tone="warning">{fmt(L.excluded, { n: excluded.size })}</Badge>}</p>
            </>
          )}

          {step === 4 && tpl && (
            <>
              <h2 className="card-title" style={{ marginBottom: 14 }}>{L.optionsTitle}</h2>
              <div className="option-list">
                <OptionRow checked={opts.accounts} onChange={(v) => setOpts((o) => ({ ...o, accounts: v }))} title={L.optAccounts} hint={fmt(L.optAccountsHint, { n: includedLeaves })} />
                <OptionRow checked={opts.structure} onChange={(v) => setOpts((o) => ({ ...o, structure: v }))} title={L.optStructure} hint={fmt(L.optStructureHint, { n: tpl.content.units.length })} />
                <OptionRow checked={opts.costCenters} onChange={(v) => setOpts((o) => ({ ...o, costCenters: v }))} title={L.optCc} hint={fmt(L.optCcHint, { n: tpl.content.costCenters.length })} />
                <OptionRow checked={opts.workflows} onChange={(v) => setOpts((o) => ({ ...o, workflows: v }))} title={L.optWorkflows} hint={fmt(L.optWorkflowsHint, { n: tpl.content.workflows.length })} />
              </div>
              {opts.costCenters && !opts.structure && <Alert kind="warning">{L.ccWithoutStructure}</Alert>}
              {!anything && <Alert kind="error">{L.nothing}</Alert>}
              <div style={{ maxWidth: 360 }}>
                <Field label={L.recordLanguage} hint={L.recordLanguageHint}>
                  {(id) => <Select id={id} value={opts.language} onChange={(e) => setOpts((o) => ({ ...o, language: e.target.value as Lang }))}
                    options={[{ value: 'az', label: L.azLang }, { value: 'en', label: L.enLang }]} />}
                </Field>
              </div>
            </>
          )}

          {step === 5 && tpl && (
            <>
              <h2 className="card-title">{L.applyTitle}</h2>
              <p className="card-sub" style={{ marginBottom: 16 }}>{L.applySub}</p>
              <div className="grid-2 gap-lg">
                <ul className="kv">
                  <li><span>{L.company}</span><span>{form.name}</span></li>
                  <li><span>{L.taxId}</span><span>{form.taxId || '—'}</span></li>
                  <li><span>{L.baseCurrency}</span><span>{form.baseCurrency}</span></li>
                  <li><span>{L.fyStart}</span><span>{months[form.fiscalYearStartMonth - 1]}</span></li>
                  <li><span>{L.defaultLanguage}</span><span>{form.defaultLanguage === 'en' ? L.enLang : L.azLang}</span></li>
                  <li><span>{L.industry}</span><span>{tplName(tpl, lang)}</span></li>
                </ul>
                <ul className="kv">
                  <li><span>{L.optAccounts}</span><span>{opts.accounts ? `${L.yes} · ${fmt(L.accounts, { n: includedLeaves })}` : L.no}</span></li>
                  <li><span>{L.optStructure}</span><span>{opts.structure ? `${L.yes} · ${tpl.content.units.length}` : L.no}</span></li>
                  <li><span>{L.optCc}</span><span>{opts.costCenters ? `${L.yes} · ${tpl.content.costCenters.length}` : L.no}</span></li>
                  <li><span>{L.optWorkflows}</span><span>{opts.workflows ? `${L.yes} · ${tpl.content.workflows.length}` : L.no}</span></li>
                  <li><span>{L.recordLanguage}</span><span>{opts.language === 'en' ? L.enLang : L.azLang}</span></li>
                </ul>
              </div>
              {company?.setupCompleted && <Alert kind="info">{L.reapply}</Alert>}
              <ErrorMessage error={error} />
            </>
          )}
        </div>

        {step === 3 && tpl && <TemplateAccountTree accounts={tpl.accounts} excluded={excluded} onChange={setExcluded} />}

        <div className="wizard-foot">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>{t('common.back')}</Button>
          <span className="hint">{step === 1 && !code ? L.chooseIndustry : step === 0 && !nameOk ? L.nameRequired : fmt(L.stepOf, { n: step + 1, total: L.steps.length })}</span>
          {step < 5
            ? <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>{t('common.next')} <Icon name="chevron" /></Button>
            : <Button variant="primary" busy={busy} disabled={!anything || !tpl} onClick={apply}><Icon name="wand" /> {busy ? L.applying : L.apply}</Button>}
        </div>
      </Card>
    </div>
  );
}

function OptionRow({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className={`option${checked ? '' : ' is-off'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{title}</b><small>{hint}</small></span>
    </label>
  );
}
