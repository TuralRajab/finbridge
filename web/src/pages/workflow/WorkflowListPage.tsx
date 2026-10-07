import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WORKFLOW_TYPES, configUserIds, type WorkflowDefinitionDto, type WorkflowPreviewDto, type WorkflowType } from '@finbridge/shared';
import '../../styles/workflow.css';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';
import {
  behaviourChips, conditionText, effectiveState, EMPTY_SAMPLE, PreviewSteps, previewBody, SampleForm, ServerErrors, stepConditionChip, useWfRefs, useWfText,
  type SampleInput,
} from './wfCommon';

const az = {
  title: 'Təsdiq axınları',
  subtitle: 'Hər sənəd növü üçün kim, hansı ardıcıllıqla və hansı şərtlərlə təsdiqləyir.',
  newWorkflow: 'Yeni axın',
  howTitle: 'Axın necə seçilir?',
  how1: 'Sənəd təsdiqə göndəriləndə həmin növün yalnız aktiv qaydalarına baxılır.',
  how2: 'Qüvvədə olma tarixləri bu günü əhatə etməlidir (boş tarix — məhdudiyyətsiz).',
  how3: 'Qaydanın şərtləri sənədə uyğun gəlməlidir (şərtsiz qayda hər sənədə uyğundur).',
  how4: 'Uyğun gələnlərdən ən kiçik prioritet nömrəsi olan qalib gəlir; bərabər olduqda daha çox şərti olan (daha konkret) qayda seçilir.',
  how5: 'Seçilmiş qaydada şərti ödənməyən mərhələlər ötürülür. İşləyən axınlar göndərilmə anındakı versiyanı saxlayır — redaktə onlara təsir etmir.',
  how6: 'Hər mərhələnin öz davranışı var: birinin və ya hamısının təsdiqi, rədd / qaytarma icazəsi, qaytarmanın göndərənə və ya əvvəlki mərhələyə getməsi, təsdiqdə şərh tələbi və təsdiqləyən üçün təlimat.',
  type: 'Sənəd növü',
  allTypes: 'Bütün növlər',
  search: 'Ad üzrə axtarış',
  showInactive: 'Deaktiv qaydaları göstər',
  colName: 'Qayda',
  colPriority: 'Prioritet',
  colConditions: 'Şərtlər',
  colSteps: 'Mərhələlər',
  colEffective: 'Qüvvədədir',
  colRevision: 'Versiya',
  colUsage: 'İstifadə',
  always: 'Həmişə',
  from: '{d} tarixindən',
  to: '{d} tarixinədək',
  unlimited: 'Müddətsiz',
  future: 'Hələ qüvvəyə minməyib',
  expired: 'Müddəti bitib',
  usage: '{n} axın',
  noneForType: 'Bu növ üçün aktiv qayda yoxdur — belə sənədlər təsdiqə göndərilə bilməyəcək.',
  addForType: 'Bu növ üçün axın yarat',
  empty: 'Hələ heç bir təsdiq axını yoxdur.',
  noMatch: 'Filtrə uyğun qayda tapılmadı.',
  testTitle: 'Marşrutun yoxlanması',
  testSub: 'Nümunə sənəd daxil edin — hansı qaydanın seçiləcəyini və kimlərin təsdiqləyəcəyini görün.',
  testShow: 'Marşrutu yoxla',
  testHide: 'Yoxlamanı gizlət',
  run: 'Yoxla',
  matched: 'Seçilən qayda',
  noDefinition: 'Heç bir aktiv qayda uyğun gəlmədi. Bu sənəd təsdiqə göndərilə bilməz (NO_WORKFLOW).',
  matchedBadge: 'Seçiləcək',
  deactivateTitle: '«{name}» deaktiv edilsin?',
  deactivateHint: 'Yeni sənədlər bu qaydaya yönləndirilməyəcək. Artıq işləyən {n} axın öz versiyası ilə davam edir.',
  cloned: '«{name}» yaradıldı (deaktiv). İndi redaktə edə bilərsiniz.',
  open: 'Konstruktorda aç',
  clone: 'Kopyala',
  toggleLabel: '{name}: aktivlik',
  readOnly: 'Qaydaları dəyişmək üçün «Təsdiq axınlarının idarəsi» icazəsi lazımdır.',
};
const TEXT = {
  az,
  en: {
    title: 'Approval workflows',
    subtitle: 'Who approves each document type, in which order and under which conditions.',
    newWorkflow: 'New workflow',
    howTitle: 'How is a workflow selected?',
    how1: 'When a document is submitted, only active definitions of that type are considered.',
    how2: 'The effective dates must cover today (an empty date means no limit).',
    how3: 'The definition\'s conditions must match the document (a definition without conditions matches everything).',
    how4: 'Among the matches, the lowest priority number wins; on a tie the definition with more conditions (the most specific) is chosen.',
    how5: 'Steps of the selected definition whose condition is not met are skipped. Running workflows keep the revision they started with — edits never affect them.',
    how6: 'Each stage has its own behaviour: one or all approvals, whether reject / return is allowed, whether a return goes to the requester or the previous stage, a comment requirement on approval and instructions for the approver.',
    type: 'Document type',
    allTypes: 'All types',
    search: 'Search by name',
    showInactive: 'Show inactive definitions',
    colName: 'Definition',
    colPriority: 'Priority',
    colConditions: 'Conditions',
    colSteps: 'Steps',
    colEffective: 'Effective',
    colRevision: 'Revision',
    colUsage: 'Usage',
    always: 'Always',
    from: 'from {d}',
    to: 'until {d}',
    unlimited: 'Open-ended',
    future: 'Not yet effective',
    expired: 'Expired',
    usage: '{n} runs',
    noneForType: 'No active definition for this type — such documents cannot be submitted.',
    addForType: 'Create a workflow for this type',
    empty: 'There are no approval workflows yet.',
    noMatch: 'No definitions match the filter.',
    testTitle: 'Test routing',
    testSub: 'Describe a sample document to see which definition is selected and who approves it.',
    testShow: 'Test routing',
    testHide: 'Hide test',
    run: 'Run test',
    matched: 'Selected definition',
    noDefinition: 'No active definition matches. This document could not be submitted (NO_WORKFLOW).',
    matchedBadge: 'Selected',
    deactivateTitle: 'Deactivate “{name}”?',
    deactivateHint: 'New documents will no longer be routed to this definition. The {n} workflows already running continue with their own revision.',
    cloned: '“{name}” was created (inactive). You can edit it now.',
    open: 'Open in builder',
    clone: 'Clone',
    toggleLabel: '{name}: active',
    readOnly: 'Changing definitions requires the “Manage workflows” permission.',
  } satisfies typeof az,
};

export function WorkflowListPage() {
  const L = useLocal(TEXT);
  const W = useWfText();
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const manage = can('workflow.manage');
  const { data: defs, setData, error, loading, reload } = useAsync(() => api<WorkflowDefinitionDto[]>('GET', '/workflows/definitions'), []);
  const [type, setType] = useState<WorkflowType | ''>('');
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<WorkflowDefinitionDto | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [matchedId, setMatchedId] = useState<number | null>(null);

  const setActive = async (d: WorkflowDefinitionDto, isActive: boolean) => {
    setBusyId(d.id); setActionError(null); setNotice(null);
    try {
      const upd = await api<WorkflowDefinitionDto>('PATCH', `/workflows/definitions/${d.id}/active`, { isActive });
      setData((cur) => cur?.map((x) => (x.id === upd.id ? { ...upd, instanceCount: x.instanceCount } : x)) ?? cur);
      setConfirmOff(null);
    } catch (e) { setActionError(e); } finally { setBusyId(null); }
  };
  const clone = async (d: WorkflowDefinitionDto) => {
    setBusyId(d.id); setActionError(null); setNotice(null);
    try {
      const c = await api<WorkflowDefinitionDto>('POST', `/workflows/definitions/${d.id}/clone`);
      setNotice(fmt(L.cloned, { name: c.name }));
      await reload();
      navigate(`/admin/workflows/${c.id}`);
    } catch (e) { setActionError(e); } finally { setBusyId(null); }
  };

  const filtered = useMemo(() => (defs ?? []).filter((d) =>
    (!type || d.workflowType === type) && (showInactive || d.isActive) && (!q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()))), [defs, type, q, showInactive]);
  const types = type ? [type] : [...WORKFLOW_TYPES];

  return (
    <div className="wfl">
      <PageHeader eyebrow={t('nav.administration')} title={L.title} subtitle={L.subtitle} actions={<>
        <Button onClick={() => setTestOpen((v) => !v)} aria-expanded={testOpen}><Icon name="wand" /> {testOpen ? L.testHide : L.testShow}</Button>
        {manage && <Link className="btn btn-primary" to="/admin/workflows/new"><Icon name="plus" /> {L.newWorkflow}</Link>}
      </>} />

      <details className="wfl-how card">
        <summary><Icon name="workflow" /> {L.howTitle}</summary>
        <ol>
          <li>{L.how1}</li><li>{L.how2}</li><li>{L.how3}</li><li>{L.how4}</li><li>{L.how5}</li><li>{L.how6}</li>
        </ol>
      </details>

      {!manage && <div className="alert alert-info">{L.readOnly}</div>}
      {testOpen && <RoutingTest onMatched={setMatchedId} defaultType={type || undefined} />}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <ServerErrors error={actionError} />

      <div className="filters wfl-filters">
        <Field label={L.type}>{(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as WorkflowType | '')}
            options={[{ value: '', label: L.allTypes }, ...WORKFLOW_TYPES.map((w) => ({ value: w, label: t(`workflowType.${w}` as TKey) }))]} />
        )}</Field>
        <Field label={L.search}>{(id) => <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <label className="check wfl-check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {L.showInactive}</label>
      </div>

      {loading && !defs ? <Spinner /> : error ? <ErrorMessage error={error} /> : !defs?.length ? (
        <Card><Empty>{L.empty}{manage && <div><Link className="btn btn-primary" to="/admin/workflows/new"><Icon name="plus" /> {L.newWorkflow}</Link></div>}</Empty></Card>
      ) : (
        types.map((wt) => {
          const all = defs.filter((d) => d.workflowType === wt);
          const rows = filtered.filter((d) => d.workflowType === wt);
          const hasActive = all.some((d) => d.isActive && effectiveState(d.effectiveFrom, d.effectiveTo) === 'current');
          if (!rows.length && (q.trim() || (all.length && !showInactive && hasActive))) return null;
          return (
            <Card key={wt} flush title={t(`workflowType.${wt}` as TKey)} subtitle={`${all.length} · ${t(`workflowEntity.${entityOf(wt)}` as TKey)}`}
              actions={manage ? <Link className="btn btn-ghost btn-sm" to={`/admin/workflows/new?type=${wt}`}><Icon name="plus" /> {t('common.add')}</Link> : undefined}>
              {!hasActive && (
                <div className="wfl-warn"><Icon name="alert" /> {L.noneForType}
                  {manage && !all.length && <Link to={`/admin/workflows/new?type=${wt}`}>{L.addForType}</Link>}</div>
              )}
              {rows.length > 0 ? (
                <div className="table-scroll">
                  <table className="table wfl-table">
                    <thead><tr>
                      <th>{L.colName}</th><th className="r">{L.colPriority}</th><th>{L.colConditions}</th><th>{L.colSteps}</th>
                      <th>{L.colEffective}</th><th className="r">{L.colRevision}</th><th>{t('common.status')}</th><th className="r">{t('common.actions')}</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((d) => {
                        const eff = effectiveState(d.effectiveFrom, d.effectiveTo);
                        const cond = conditionText(d.conditions, W, locale, t);
                        return (
                          <tr key={d.id} className={`${d.isActive ? '' : 'wfl-inactive'}${matchedId === d.id ? ' wfl-matched' : ''}`}>
                            <td className="wfl-name">
                              <Link to={`/admin/workflows/${d.id}`}><strong>{d.name}</strong></Link>
                              {matchedId === d.id && <> <Badge tone="info"><Icon name="check" /> {L.matchedBadge}</Badge></>}
                              {d.description && <div className="muted small">{d.description}</div>}
                              <div className="muted small">{fmt(L.usage, { n: d.instanceCount })}</div>
                            </td>
                            <td className="r num">{d.priority}</td>
                            <td className="wfl-cond">{cond ? cond : <span className="muted">{L.always}</span>}</td>
                            <td><StepChain def={d} /></td>
                            <td className="wfl-dates">
                              <div className="small">{effLabel(d, L, locale)}</div>
                              {eff !== 'current' && <Badge tone={eff === 'future' ? 'info' : 'muted'}>{eff === 'future' ? L.future : L.expired}</Badge>}
                            </td>
                            <td className="r num">r{d.revision}</td>
                            <td>
                              {manage ? (
                                <label className="wfl-switch" title={fmt(L.toggleLabel, { name: d.name })}>
                                  <input type="checkbox" role="switch" checked={d.isActive} disabled={busyId === d.id} aria-label={fmt(L.toggleLabel, { name: d.name })}
                                    onChange={(e) => (e.target.checked ? void setActive(d, true) : setConfirmOff(d))} />
                                  <span className="wfl-switch-ui" aria-hidden="true" />
                                  <span>{d.isActive ? t('common.active') : t('common.inactive')}</span>
                                </label>
                              ) : <Badge tone={d.isActive ? 'success' : 'muted'}>{d.isActive ? t('common.active') : t('common.inactive')}</Badge>}
                            </td>
                            <td className="r">
                              <div className="row-actions">
                                <Link className="btn btn-secondary btn-sm" to={`/admin/workflows/${d.id}`}>{manage ? L.open : t('common.view')}</Link>
                                {manage && <Button size="sm" variant="ghost" busy={busyId === d.id} onClick={() => void clone(d)} aria-label={`${L.clone}: ${d.name}`}><Icon name="copy" /> {L.clone}</Button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : all.length ? <div className="card-body muted small">{L.noMatch}</div> : null}
            </Card>
          );
        })
      )}

      {confirmOff && (
        <Modal title={fmt(L.deactivateTitle, { name: confirmOff.name })} onClose={() => setConfirmOff(null)} footer={<>
          <Button variant="ghost" onClick={() => setConfirmOff(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" busy={busyId === confirmOff.id} onClick={() => void setActive(confirmOff, false)}>{t('common.deactivate')}</Button>
        </>}>
          <p>{fmt(L.deactivateHint, { n: confirmOff.instanceCount })}</p>
          <ServerErrors error={actionError} />
        </Modal>
      )}
    </div>
  );
}

function entityOf(t: WorkflowType): string {
  switch (t) {
    case 'BUDGET_SUBMISSION': case 'FORECAST_SUBMISSION': return 'BUDGET_SECTION';
    case 'BUDGET_APPROVAL': case 'FORECAST_APPROVAL': return 'BUDGET_VERSION';
    case 'BUDGET_CHANGE': return 'CHANGE_REQUEST';
    default: return 'PURCHASE_REQUEST';
  }
}

function effLabel(d: WorkflowDefinitionDto, L: typeof az, locale: string): string {
  if (!d.effectiveFrom && !d.effectiveTo) return L.unlimited;
  return [d.effectiveFrom && fmt(L.from, { d: date(d.effectiveFrom, locale) }), d.effectiveTo && fmt(L.to, { d: date(d.effectiveTo, locale) })].filter(Boolean).join(' ');
}

/** "XM sahibi → Maliyyə → CFO (≥ 10 000)" as a compact chain with threshold chips. */
export function StepChain({ def }: { def: Pick<WorkflowDefinitionDto, 'steps'> }) {
  const W = useWfText();
  const { t, locale } = useI18n();
  return (
    <ol className="wfl-chain" aria-label={W.step.replace('{n}', '')}>
      {def.steps.map((s, i) => {
        const chip = stepConditionChip(s.condition, W, locale, t);
        const users = s.approverType === 'SPECIFIC_USER' ? configUserIds(s.approverConfig).length : 0;
        const beh = behaviourChips(s, W, { approvers: users || undefined });
        const title = [s.name, t(`approverType.${s.approverType}` as TKey), s.slaHours ? `SLA ${s.slaHours}h` : '', ...beh.map((c) => c.title && c.key === 'ins' ? `${c.label}: ${c.title}` : c.label)].filter(Boolean).join(' · ');
        return (
          <li key={s.id ?? i} title={title}>
            {i > 0 && <span className="wfl-arrow" aria-hidden="true">→</span>}
            <span className="wfl-step">{s.name}</span>
            {chip && <span className="wfl-chip">{chip}</span>}
            {beh.filter((c) => c.key !== 'ins').map((c) => <span key={c.key} className={`badge badge-${c.tone} wf-beh`}>{c.label}</span>)}
          </li>
        );
      })}
    </ol>
  );
}

const testAz = { run: 'Yoxla', matched: 'Seçilən qayda', none: 'Heç bir aktiv qayda uyğun gəlmədi. Bu sənəd təsdiqə göndərilə bilməz (NO_WORKFLOW).', type: 'Sənəd növü', open: 'Qaydanı aç', priority: 'prioritet' };
const TEST_TEXT = { az: testAz, en: { run: 'Run test', matched: 'Selected definition', none: 'No active definition matches. This document could not be submitted (NO_WORKFLOW).', type: 'Document type', open: 'Open definition', priority: 'priority' } satisfies typeof testAz };

function RoutingTest({ onMatched, defaultType }: { onMatched: (id: number | null) => void; defaultType?: WorkflowType }) {
  const L = useLocal(TEST_TEXT);
  const P = useLocal(TEXT);
  const { t } = useI18n();
  const refs = useWfRefs();
  const [wt, setWt] = useState<WorkflowType>(defaultType ?? 'PURCHASE_REQUEST');
  const [sample, setSample] = useState<SampleInput>(EMPTY_SAMPLE);
  const [result, setResult] = useState<WorkflowPreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<WorkflowPreviewDto>('POST', '/workflows/preview', { workflowType: wt, ...previewBody(sample) });
      setResult(r); onMatched(r.definition?.id ?? null);
    } catch (e) { setErr(e); setResult(null); onMatched(null); } finally { setBusy(false); }
  };
  useEffect(() => () => onMatched(null), [onMatched]);

  return (
    <Card title={P.testTitle} subtitle={P.testSub} className="wfl-test">
      {refs.loading && !refs.data ? <Spinner /> : refs.error ? <ErrorMessage error={refs.error} /> : refs.data && (
        <div className="wfl-test-grid">
          <form onSubmit={(e) => { e.preventDefault(); void run(); }}>
            <SampleForm value={sample} onChange={setSample} refs={refs.data}>
              <Field label={L.type}>{(id) => (
                <Select id={id} value={wt} onChange={(e) => setWt(e.target.value as WorkflowType)}
                  options={WORKFLOW_TYPES.map((w) => ({ value: w, label: t(`workflowType.${w}` as TKey) }))} />
              )}</Field>
            </SampleForm>
            <Button type="submit" variant="primary" busy={busy}><Icon name="wand" /> {L.run}</Button>
          </form>
          <div className="wfl-test-result" aria-live="polite">
            <ServerErrors error={err} />
            {result && (result.definition ? (
              <>
                <div className="wfp-head">
                  <span className="muted small">{L.matched}</span>
                  <Link to={`/admin/workflows/${result.definition.id}`}><strong>{result.definition.name}</strong></Link>
                </div>
                <PreviewSteps result={result} />
              </>
            ) : <div className="alert alert-warning"><Icon name="alert" /> {L.none}</div>)}
          </div>
        </div>
      )}
    </Card>
  );
}
