import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { IndustryTemplateDetailDto, IndustryTemplateDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, Icon, PageHeader, Spinner, Tabs } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useAsync } from '../../lib/useAsync';
import { TemplateAccountTree, TemplateKpis, TemplateStructure, TemplateSummary, TemplateWorkflows, tplDesc, tplName } from '../setup/templateView';
import '../../styles/admin-org.css';

const az = {
  title: 'Sənaye şablonları',
  subtitle: 'Hazır hesablar planı, struktur, xərc mərkəzləri və təsdiq axınları. Şablonu quraşdırma ustası ilə tətbiq edin.',
  accounts: '{n} hesab', current: 'Cari şablon', choose: 'Ətraflı baxmaq üçün şablonu seçin.',
  tabSummary: 'İcmal', tabAccounts: 'Hesablar planı', tabStructure: 'Struktur', tabWorkflows: 'Təsdiq axınları', tabKpis: 'KPI və fərziyyələr',
  openWizard: 'Ustada aç', merge: 'Şablon kod üzrə birləşdirilir: mövcud qeydlər dəyişdirilmir, yalnız çatışmayanlar əlavə olunur.',
  list: 'Şablonlar',
};
const TEXT = {
  az,
  en: {
    title: 'Industry templates',
    subtitle: 'Ready-made chart of accounts, structure, cost centers and approval workflows. Apply a template with the setup wizard.',
    accounts: '{n} accounts', current: 'Current template', choose: 'Select a template to see its details.',
    tabSummary: 'Overview', tabAccounts: 'Chart of accounts', tabStructure: 'Structure', tabWorkflows: 'Approval workflows', tabKpis: 'KPIs and assumptions',
    openWizard: 'Open in wizard', merge: 'Templates are merged by code: existing records are never changed, only missing ones are added.',
    list: 'Templates',
  } satisfies typeof az,
};

type Tab = 'summary' | 'accounts' | 'structure' | 'workflows' | 'kpis';

export function TemplatesPage() {
  const L = useLocal(TEXT);
  const { t, lang } = useI18n();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('summary');
  const list = useAsync(() => api<IndustryTemplateDto[]>('GET', '/templates'), []);
  const selected = params.get('code') ?? user?.company?.industryCode ?? null;
  const detail = useAsync(() => (selected ? api<IndustryTemplateDetailDto>('GET', `/templates/${encodeURIComponent(selected)}`) : Promise.resolve(null)), [selected]);
  const tpl = detail.data && detail.data.code === selected ? detail.data : null;

  useEffect(() => {
    if (!selected && list.data?.length) setParams({ code: list.data[0].code }, { replace: true });
  }, [selected, list.data, setParams]);

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} />
      <Alert kind="info">{L.merge}</Alert>
      <div className="tpl-layout">
        <Card title={L.list}>
          {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorMessage error={list.error} /> : !list.data?.length ? <Empty>{t('common.noData')}</Empty> : (
            <div className="tpl-list" role="listbox" aria-label={L.list}>
              {list.data.map((x) => (
                <button key={x.code} type="button" role="option" aria-selected={x.code === selected}
                  className={`tpl-card${x.code === selected ? ' is-selected' : ''}`} onClick={() => { setParams({ code: x.code }); setTab('summary'); }}>
                  <h3>{tplName(x, lang)}</h3>
                  <span className="tpl-meta">
                    <Badge tone="neutral">{fmt(L.accounts, { n: x.accountCount })}</Badge>
                    {user?.company?.industryCode === x.code && <Badge tone="success">{L.current}</Badge>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div>
          {!selected ? <Card><Empty>{L.choose}</Empty></Card> : detail.loading && !tpl ? <Card><Spinner /></Card> : detail.error ? <Card><ErrorMessage error={detail.error} /></Card> : tpl && (
            <Card flush title={<>{tplName(tpl, lang)} <Badge tone="muted">{tpl.code} · v{tpl.version}</Badge></>} subtitle={tplDesc(tpl, lang)}
              actions={can('templates.apply') && (
                <Button variant="primary" onClick={() => navigate(`/setup?template=${encodeURIComponent(tpl.code)}`)}><Icon name="wand" /> {L.openWizard}</Button>
              )}>
              <div style={{ padding: '0 20px' }}>
                <Tabs<Tab> value={tab} onChange={setTab} tabs={[
                  { value: 'summary', label: L.tabSummary },
                  { value: 'accounts', label: `${L.tabAccounts} (${tpl.accountCount})` },
                  { value: 'structure', label: `${L.tabStructure} (${tpl.content.units.length})` },
                  { value: 'workflows', label: `${L.tabWorkflows} (${tpl.content.workflows.length})` },
                  { value: 'kpis', label: L.tabKpis },
                ]} />
              </div>
              {tab === 'accounts' ? <TemplateAccountTree accounts={tpl.accounts} /> : (
                <div className="card-body" style={{ paddingTop: 0 }}>
                  {tab === 'summary' && <TemplateSummary tpl={tpl} />}
                  {tab === 'structure' && <TemplateStructure content={tpl.content} />}
                  {tab === 'workflows' && <TemplateWorkflows content={tpl.content} />}
                  {tab === 'kpis' && <TemplateKpis content={tpl.content} />}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
