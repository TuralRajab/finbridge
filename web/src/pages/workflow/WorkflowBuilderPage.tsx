import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  WORKFLOW_TYPES, evaluateCondition,
  type ApproverConfig, type ApproverType, type Condition, type WorkflowDefinitionDto, type WorkflowPreviewDto, type WorkflowStepDto, type WorkflowType,
} from '@finbridge/shared';
import '../../styles/workflow.css';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { date } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Card, ErrorMessage, Field, Icon, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';
import {
  ApproverFields, approverLabel, approverTypeOptions, ConditionBuilder, conditionText, effectiveState, EMPTY_SAMPLE, previewBody,
  SampleForm, sampleContext, ServerErrors, stepConditionChip, useWfRefs, useWfText, type SampleInput, type WfRefs,
} from './wfCommon';

const az = {
  newTitle: 'Yeni təsdiq axını',
  crumbs: 'Təsdiq axınları',
  readOnly: 'Yalnız baxış rejimi: axınları dəyişmək üçün icazəniz yoxdur.',
  general: 'Əsas parametrlər',
  name: 'Qaydanın adı',
  type: 'Sənəd növü',
  description: 'Təsvir',
  priority: 'Prioritet',
  priorityHint: 'Kiçik nömrə üstündür (0–10000).',
  from: 'Qüvvəyə minmə tarixi',
  to: 'Bitmə tarixi',
  datesHint: 'Boş — məhdudiyyətsiz.',
  active: 'Aktivdir (yeni sənədlər bu qaydaya yönləndirilə bilər)',
  skipSelf: 'Özünü təsdiqləməni ötür',
  skipSelfHint: 'Təsdiqləyən sorğu edənin özüdürsə, mərhələ avtomatik ötürülür; başqa təsdiqləyən varsa, onlara verilir.',
  conditions: 'Qaydanın tətbiq şərtləri',
  conditionsSub: 'Bu qayda yalnız şərtlər ödəndikdə seçilir. Şərtsiz qayda həmin növün bütün sənədlərinə uyğundur.',
  steps: 'Təsdiq mərhələləri',
  stepsSub: 'Mərhələlər ardıcıl icra olunur. Hər mərhələnin təsdiqləyəni göndərilmə anında strukturdan təyin edilir.',
  start: 'Sənəd təsdiqə göndərilir',
  end: 'Sənəd təsdiqlənir',
  stepName: 'Mərhələnin adı',
  approverType: 'Təsdiqləyən',
  sla: 'SLA (saat)',
  slaHint: 'Boş — müddətsiz. Müddət bitəndə tapşırıq gecikmiş sayılır.',
  stepCond: 'Yalnız şərt ödəndikdə tətbiq et',
  stepCondHint: 'Məsələn, məbləğ ≥ 10 000 olduqda CFO mərhələsi.',
  escalate: 'SLA keçdikdə eskalasiya et',
  escalateHint: 'Gecikmiş tapşırığa əlavə təsdiqləyən təyin edilir; ilkin təsdiqləyənlər də qalır.',
  escalateNeedsSla: 'Eskalasiya yalnız SLA müəyyən edildikdə işləyir.',
  escalateTo: 'Eskalasiya: təsdiqləyən',
  addStep: 'Mərhələ əlavə et',
  moveUp: 'Yuxarı köçür',
  moveDown: 'Aşağı köçür',
  removeStep: 'Mərhələni sil',
  newStep: 'Yeni mərhələ',
  save: 'Yadda saxla',
  saveRevision: 'Yadda saxla (r{n})',
  saved: 'Yadda saxlanıldı — versiya r{n}.',
  clone: 'Kopyala',
  activate: 'Aktivləşdir',
  deactivate: 'Deaktiv et',
  revision: 'Versiya r{n}',
  updated: 'Yenilənib: {d}',
  uses: '{n} axında istifadə olunub',
  dirty: 'Yadda saxlanmamış dəyişikliklər var',
  dirtyToggle: 'Əvvəlcə dəyişiklikləri yadda saxlayın.',
  fixFirst: 'Yadda saxlamazdan əvvəl düzəldin:',
  errName: 'Qaydanın adı ən azı 2 simvol olmalıdır.',
  errSteps: 'Ən azı bir mərhələ lazımdır.',
  errStepName: '{step}: ad boşdur.',
  errUser: '{step}: istifadəçini seçin.',
  errRole: '{step}: rolu seçin.',
  errPosition: '{step}: ştat vahidini seçin.',
  errEscUser: '{step} (eskalasiya): istifadəçini seçin.',
  errEscRole: '{step} (eskalasiya): rolu seçin.',
  errEscPosition: '{step} (eskalasiya): ştat vahidini seçin.',
  errDates: 'Bitmə tarixi başlama tarixindən əvvəl ola bilməz.',
  errPriority: 'Prioritet 0 ilə 10000 arasında tam ədəd olmalıdır.',
  errSla: '{step}: SLA 1–8760 saat arasında olmalıdır.',
  warnEmptyList: 'Diqqət: dəyəri seçilməmiş «siyahıdadır» şərti heç vaxt ödənmir.',
  previewTitle: 'Canlı önizləmə',
  previewSub: 'Nümunə sənəd üçün bu qaydanın necə işlədiyini görün.',
  defMatch: 'Qaydanın şərtləri ödənir',
  defNoMatch: 'Qaydanın şərtləri ödənmir — bu sənəd üçün qayda seçilməyəcək',
  routingNow: 'Hazırda marşrut seçir',
  thisOne: 'bu qayda',
  another: 'başqa qayda',
  noneSelected: 'heç bir qayda uyğun gəlmir',
  notSelectable: 'Qayda deaktivdir və ya qüvvədə deyil — marşrut onu seçməyəcək.',
  savedOnly: 'Təsdiqləyənlər yadda saxlanmış versiya (r{n}) üzrə göstərilir; dəyişiklikləri görmək üçün yadda saxlayın.',
  saveToResolve: 'Təsdiqləyənləri görmək üçün qaydanı yadda saxlayın.',
  included: 'Tətbiq olunur',
  skipped: 'Ötürülür (şərt ödənmir)',
  approvers: 'Təsdiqləyənlər',
  noApprover: 'Təsdiqləyən tapılmadı — göndərmə xəta verəcək.',
  unresolved: 'yadda saxladıqdan sonra',
  sampleItem: 'Nümunə sənəd',
  cloneDone: 'Kopya yaradıldı (deaktiv).',
  leaveTitle: 'Dəyişikliklər itəcək',
  confirmRemove: '«{name}» mərhələsi silinsin?',
};
const TEXT = {
  az,
  en: {
    newTitle: 'New approval workflow',
    crumbs: 'Approval workflows',
    readOnly: 'Read-only: you do not have permission to change workflows.',
    general: 'General',
    name: 'Definition name',
    type: 'Document type',
    description: 'Description',
    priority: 'Priority',
    priorityHint: 'Lower number wins (0–10000).',
    from: 'Effective from',
    to: 'Effective to',
    datesHint: 'Empty — no limit.',
    active: 'Active (new documents can be routed to this definition)',
    skipSelf: 'Skip self-approval',
    skipSelfHint: 'If the requester is the approver, the step is skipped automatically; other approvers of the step still receive it.',
    conditions: 'When does this definition apply?',
    conditionsSub: 'The definition is selected only when the conditions match. Without conditions it matches every document of the type.',
    steps: 'Approval steps',
    stepsSub: 'Steps run in sequence. Each step\'s approver is resolved from the organisation structure at submission time.',
    start: 'Document is submitted',
    end: 'Document is approved',
    stepName: 'Step name',
    approverType: 'Approver',
    sla: 'SLA (hours)',
    slaHint: 'Empty — no deadline. When it passes the task is overdue.',
    stepCond: 'Apply only when a condition is met',
    stepCondHint: 'For example a CFO step when the amount is ≥ 10 000.',
    escalate: 'Escalate when the SLA is exceeded',
    escalateHint: 'An extra approver is added to the overdue task; the original approvers remain.',
    escalateNeedsSla: 'Escalation only works when an SLA is set.',
    escalateTo: 'Escalate to',
    addStep: 'Add step',
    moveUp: 'Move up',
    moveDown: 'Move down',
    removeStep: 'Remove step',
    newStep: 'New step',
    save: 'Save',
    saveRevision: 'Save (r{n})',
    saved: 'Saved — revision r{n}.',
    clone: 'Clone',
    activate: 'Activate',
    deactivate: 'Deactivate',
    revision: 'Revision r{n}',
    updated: 'Updated: {d}',
    uses: 'Used by {n} workflows',
    dirty: 'Unsaved changes',
    dirtyToggle: 'Save your changes first.',
    fixFirst: 'Fix before saving:',
    errName: 'The name needs at least 2 characters.',
    errSteps: 'At least one step is required.',
    errStepName: '{step}: name is empty.',
    errUser: '{step}: choose a user.',
    errRole: '{step}: choose a role.',
    errPosition: '{step}: choose a position.',
    errEscUser: '{step} (escalation): choose a user.',
    errEscRole: '{step} (escalation): choose a role.',
    errEscPosition: '{step} (escalation): choose a position.',
    errDates: 'The end date cannot be before the start date.',
    errPriority: 'Priority must be a whole number between 0 and 10000.',
    errSla: '{step}: SLA must be between 1 and 8760 hours.',
    warnEmptyList: 'Note: an “is one of” condition without values never matches.',
    previewTitle: 'Live preview',
    previewSub: 'See how this definition handles a sample document.',
    defMatch: 'The definition\'s conditions match',
    defNoMatch: 'The conditions do not match — this definition will not be selected for this document',
    routingNow: 'Routing currently selects',
    thisOne: 'this definition',
    another: 'another definition',
    noneSelected: 'no definition matches',
    notSelectable: 'The definition is inactive or not effective today — routing will not select it.',
    savedOnly: 'Approvers are shown for the saved revision (r{n}); save to see your changes.',
    saveToResolve: 'Save the definition to see the resolved approvers.',
    included: 'Applies',
    skipped: 'Skipped (condition not met)',
    approvers: 'Approvers',
    noApprover: 'No approver resolved — submission would fail.',
    unresolved: 'after saving',
    sampleItem: 'Sample document',
    cloneDone: 'Copy created (inactive).',
    leaveTitle: 'Changes will be lost',
    confirmRemove: 'Remove step “{name}”?',
  } satisfies typeof az,
};
type Txt = typeof az;

interface DraftStep extends WorkflowStepDto { key: number; condOn: boolean }
interface Draft {
  name: string; workflowType: WorkflowType; description: string; priority: string; conditions: Condition | null;
  skipSelfApproval: boolean; isActive: boolean; effectiveFrom: string; effectiveTo: string; steps: DraftStep[];
}

let stepKey = 1;
const toDraftStep = (s: WorkflowStepDto): DraftStep => ({ ...s, approverConfig: { ...s.approverConfig }, key: stepKey++, condOn: !!s.condition });
const blankStep = (name: string): DraftStep => ({ seq: 0, name, approverType: 'DYNAMIC_MANAGER', approverConfig: {}, condition: null, slaHours: 48, escalation: null, key: stepKey++, condOn: false });

function toDraft(d: WorkflowDefinitionDto): Draft {
  return {
    name: d.name, workflowType: d.workflowType, description: d.description ?? '', priority: String(d.priority), conditions: d.conditions,
    skipSelfApproval: d.skipSelfApproval, isActive: d.isActive, effectiveFrom: d.effectiveFrom ?? '', effectiveTo: d.effectiveTo ?? '',
    steps: d.steps.map(toDraftStep),
  };
}

function payload(d: Draft) {
  return {
    name: d.name.trim(), workflowType: d.workflowType, description: d.description.trim() || null, priority: Number(d.priority),
    conditions: d.conditions, skipSelfApproval: d.skipSelfApproval, isActive: d.isActive,
    effectiveFrom: d.effectiveFrom || null, effectiveTo: d.effectiveTo || null,
    steps: d.steps.map((s, i) => ({
      seq: i + 1, name: s.name.trim(), approverType: s.approverType, approverConfig: s.approverConfig,
      condition: s.condOn ? s.condition : null, slaHours: s.slaHours, escalation: s.escalation,
    })),
  };
}

function cfgError(type: ApproverType, cfg: ApproverConfig): 'user' | 'role' | 'position' | null {
  if (type === 'SPECIFIC_USER' && !cfg.userId) return 'user';
  if (type === 'ROLE' && !cfg.role) return 'role';
  if (type === 'POSITION_HOLDER' && !cfg.positionId && !cfg.positionCode) return 'position';
  return null;
}

function validate(d: Draft, L: Txt): string[] {
  const out: string[] = [];
  if (d.name.trim().length < 2) out.push(L.errName);
  const p = Number(d.priority);
  if (!Number.isInteger(p) || p < 0 || p > 10000 || d.priority.trim() === '') out.push(L.errPriority);
  if (d.effectiveFrom && d.effectiveTo && d.effectiveTo < d.effectiveFrom) out.push(L.errDates);
  if (!d.steps.length) out.push(L.errSteps);
  d.steps.forEach((s, i) => {
    const step = `${i + 1}. ${s.name.trim() || '—'}`;
    if (!s.name.trim()) out.push(fmt(L.errStepName, { step }));
    const e = cfgError(s.approverType, s.approverConfig);
    if (e) out.push(fmt(e === 'user' ? L.errUser : e === 'role' ? L.errRole : L.errPosition, { step }));
    if (s.escalation) {
      const ee = cfgError(s.escalation.approverType, s.escalation.config);
      if (ee) out.push(fmt(ee === 'user' ? L.errEscUser : ee === 'role' ? L.errEscRole : L.errEscPosition, { step }));
    }
    if (s.slaHours !== null && (!Number.isInteger(s.slaHours) || s.slaHours < 1 || s.slaHours > 8760)) out.push(fmt(L.errSla, { step }));
  });
  return out;
}

function hasEmptyList(c: Condition | null): boolean {
  if (!c) return false;
  if ('field' in c) return (c.op === 'in' || c.op === 'notIn') && Array.isArray(c.value) && c.value.length === 0;
  if ('not' in c) return hasEmptyList(c.not);
  return ('all' in c ? c.all : c.any).some(hasEmptyList);
}

export function WorkflowBuilderPage() {
  const { id } = useParams();
  const defId = id ? Number(id) : null;
  const { data, error, loading } = useAsync(
    () => (defId ? api<WorkflowDefinitionDto>('GET', `/workflows/definitions/${defId}`) : Promise.resolve(null)), [defId],
  );
  const refs = useWfRefs();
  if (defId && loading && !data) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (refs.error) return <ErrorMessage error={refs.error} />;
  if (!refs.data) return <Spinner />;
  return <Builder key={defId ?? 'new'} initial={data} refs={refs.data} />;
}

function Builder({ initial, refs }: { initial: WorkflowDefinitionDto | null; refs: WfRefs }) {
  const L = useLocal(TEXT);
  const W = useWfText();
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const readOnly = !can('workflow.manage');

  const [saved, setSaved] = useState<WorkflowDefinitionDto | null>(initial);
  const [draft, setDraft] = useState<Draft>(() => initial ? toDraft(initial) : {
    name: '', workflowType: (WORKFLOW_TYPES as readonly string[]).includes(params.get('type') ?? '') ? params.get('type') as WorkflowType : 'PURCHASE_REQUEST',
    description: '', priority: '100', conditions: null, skipSelfApproval: true, isActive: true, effectiveFrom: '', effectiveTo: '',
    steps: [blankStep(L.newStep)],
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(payload(draft)));
  const [condKey, setCondKey] = useState(0);
  const [busy, setBusy] = useState<'save' | 'clone' | 'active' | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [removeIdx, setRemoveIdx] = useState<number | null>(null);

  const body = payload(draft);
  const dirty = JSON.stringify(body) !== baseline;
  const problems = validate(draft, L);

  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const setStep = (i: number, p: Partial<DraftStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    const steps = [...d.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return d;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...d, steps };
  });

  const applySaved = (def: WorkflowDefinitionDto) => {
    const next = toDraft(def);
    setSaved(def); setDraft(next); setBaseline(JSON.stringify(payload(next))); setCondKey((k) => k + 1);
  };

  const save = async () => {
    setShowErrors(true); setSaveError(null); setNotice(null);
    if (problems.length) return;
    setBusy('save');
    try {
      const def = saved
        ? await api<WorkflowDefinitionDto>('PUT', `/workflows/definitions/${saved.id}`, body)
        : await api<WorkflowDefinitionDto>('POST', '/workflows/definitions', body);
      setShowErrors(false);
      if (!saved) { navigate(`/admin/workflows/${def.id}`, { replace: true, state: { notice: fmt(L.saved, { n: def.revision }) } }); return; }
      applySaved(def);
      setNotice(fmt(L.saved, { n: def.revision }));
    } catch (e) { setSaveError(e); } finally { setBusy(null); }
  };
  const clone = async () => {
    if (!saved) return;
    setBusy('clone'); setSaveError(null);
    try {
      const c = await api<WorkflowDefinitionDto>('POST', `/workflows/definitions/${saved.id}/clone`);
      navigate(`/admin/workflows/${c.id}`, { state: { notice: L.cloneDone } });
    } catch (e) { setSaveError(e); } finally { setBusy(null); }
  };
  const toggleActive = async () => {
    if (!saved) return;
    setBusy('active'); setSaveError(null); setNotice(null);
    try {
      const def = await api<WorkflowDefinitionDto>('PATCH', `/workflows/definitions/${saved.id}/active`, { isActive: !saved.isActive });
      applySaved(def);
    } catch (e) { setSaveError(e); } finally { setBusy(null); }
  };

  const title = saved ? saved.name : L.newTitle;

  return (
    <div className="wfb">
      <nav className="crumbs small" aria-label="breadcrumb">
        <Link to="/admin/workflows">{L.crumbs}</Link><span aria-hidden="true">›</span><span>{title}</span>
      </nav>
      <PageHeader eyebrow={t(`workflowType.${draft.workflowType}` as TKey)} title={title}
        subtitle={saved ? (
          <span className="wfb-meta">
            <Badge tone="dark">{fmt(L.revision, { n: saved.revision })}</Badge>
            <Badge tone={saved.isActive ? 'success' : 'muted'}>{saved.isActive ? t('common.active') : t('common.inactive')}</Badge>
            <span>{fmt(L.updated, { d: date(saved.updatedAt, locale, true) })}</span>
            <span>{fmt(L.uses, { n: saved.instanceCount })}</span>
          </span>
        ) : undefined}
        actions={readOnly ? undefined : <>
          {dirty && <span className="dirty" role="status">{L.dirty}</span>}
          {saved && (
            <Button busy={busy === 'active'} disabled={dirty} title={dirty ? L.dirtyToggle : undefined} onClick={() => void toggleActive()}>
              {saved.isActive ? L.deactivate : L.activate}
            </Button>
          )}
          {saved && <Button busy={busy === 'clone'} onClick={() => void clone()}><Icon name="copy" /> {L.clone}</Button>}
          <Button variant="primary" busy={busy === 'save'} disabled={!dirty && !!saved} onClick={() => void save()}>
            <Icon name="check" /> {saved && dirty ? fmt(L.saveRevision, { n: saved.revision + 1 }) : L.save}
          </Button>
        </>} />

      {readOnly && <div className="alert alert-info">{L.readOnly}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {showErrors && problems.length > 0 && (
        <div className="alert alert-error" role="alert">{L.fixFirst}<ul className="error-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
      )}
      <ServerErrors error={saveError} />

      <div className="wfb-layout">
        <fieldset className="wfb-main" disabled={readOnly}>
          <Card title={L.general}>
            <div className="grid-2">
              <Field label={L.name}>{(fid) => <Input id={fid} value={draft.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label={L.type}>{(fid) => (
                <Select id={fid} value={draft.workflowType} onChange={(e) => set({ workflowType: e.target.value as WorkflowType })}
                  options={WORKFLOW_TYPES.map((w) => ({ value: w, label: t(`workflowType.${w}` as TKey) }))} />
              )}</Field>
            </div>
            <Field label={<>{L.description} <span className="muted">({t('common.optional')})</span></>}>
              {(fid) => <textarea id={fid} className="input textarea" rows={2} maxLength={1000} value={draft.description} onChange={(e) => set({ description: e.target.value })} />}
            </Field>
            <div className="wfb-grid-3">
              <Field label={L.priority} hint={L.priorityHint}>{(fid) => (
                <Input id={fid} type="number" min={0} max={10000} step={1} className="r num" value={draft.priority} onChange={(e) => set({ priority: e.target.value })} />
              )}</Field>
              <Field label={L.from} hint={L.datesHint}>{(fid) => <Input id={fid} type="date" value={draft.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
              <Field label={L.to}>{(fid) => <Input id={fid} type="date" value={draft.effectiveTo} min={draft.effectiveFrom || undefined} onChange={(e) => set({ effectiveTo: e.target.value })} />}</Field>
            </div>
            <label className="check"><input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> {L.active}</label>
            <label className="check wfb-check-hint">
              <input type="checkbox" checked={draft.skipSelfApproval} onChange={(e) => set({ skipSelfApproval: e.target.checked })} />
              <span>{L.skipSelf}<small className="hint">{L.skipSelfHint}</small></span>
            </label>
          </Card>

          <Card title={L.conditions} subtitle={L.conditionsSub}>
            <ConditionBuilder key={`def-${condKey}`} value={draft.conditions} refs={refs} disabled={readOnly} onChange={(c) => set({ conditions: c })} />
            {draft.conditions && <p className="wfb-summary"><Icon name="check" /> {conditionText(draft.conditions, W, locale, t)}</p>}
            {hasEmptyList(draft.conditions) && <p className="small wfp-warn"><Icon name="alert" /> {L.warnEmptyList}</p>}
          </Card>

          <Card title={L.steps} subtitle={L.stepsSub}>
            <ol className="wfb-flow">
              <li className="wfb-node"><Icon name="request" /> {L.start}</li>
              {draft.steps.map((s, i) => (
                <li key={s.key} className="wfb-item">
                  <span className="wfb-arrow" aria-hidden="true" />
                  <StepCard step={s} index={i} count={draft.steps.length} refs={refs} readOnly={readOnly} L={L}
                    onChange={(p) => setStep(i, p)} onMove={(dir) => move(i, dir)} onRemove={() => setRemoveIdx(i)} />
                </li>
              ))}
              {!readOnly && (
                <li className="wfb-item">
                  <span className="wfb-arrow" aria-hidden="true" />
                  <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, blankStep(`${L.newStep} ${d.steps.length + 1}`)] }))}
                    disabled={draft.steps.length >= 20}><Icon name="plus" /> {L.addStep}</Button>
                </li>
              )}
              <li className="wfb-item"><span className="wfb-arrow" aria-hidden="true" /><div className="wfb-node wfb-node-end"><Icon name="check" /> {L.end}</div></li>
            </ol>
          </Card>
        </fieldset>

        <aside className="wfb-side">
          <LivePreview draft={draft} saved={saved} dirty={dirty} refs={refs} L={L} />
        </aside>
      </div>

      {removeIdx !== null && draft.steps[removeIdx] && (
        <Modal title={fmt(L.confirmRemove, { name: draft.steps[removeIdx].name || `#${removeIdx + 1}` })} onClose={() => setRemoveIdx(null)} footer={<>
          <Button variant="ghost" onClick={() => setRemoveIdx(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== removeIdx) })); setRemoveIdx(null); }}>{t('common.remove')}</Button>
        </>}>
          <p className="muted">{t('common.confirmDelete')}</p>
        </Modal>
      )}
    </div>
  );
}

function StepCard({ step: s, index: i, count, refs, readOnly, L, onChange, onMove, onRemove }: {
  step: DraftStep; index: number; count: number; refs: WfRefs; readOnly: boolean; L: Txt;
  onChange: (p: Partial<DraftStep>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const W = useWfText();
  const { t, locale } = useI18n();
  const chip = s.condOn ? stepConditionChip(s.condition, W, locale, t) : '';
  const idp = `step-${s.key}`;
  return (
    <section className="wfb-step" aria-label={`${i + 1}. ${s.name}`}>
      <header className="wfb-step-head">
        <span className="wfb-num" aria-hidden="true">{i + 1}</span>
        <div className="wfb-step-title">
          <strong>{s.name || '—'}</strong>
          <span className="muted small">{approverLabel(s.approverType, s.approverConfig, refs, t)}</span>
        </div>
        <div className="wfb-chips">
          {chip && <span className="wfl-chip" title={conditionText(s.condition, W, locale, t)}>{chip}</span>}
          {s.slaHours && <Badge tone="neutral">SLA {s.slaHours}h</Badge>}
          {s.escalation && <Badge tone="warning">↗ {t(`approverType.${s.escalation.approverType}` as TKey)}</Badge>}
        </div>
        {!readOnly && (
          <div className="wfb-step-tools">
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => onMove(-1)} aria-label={L.moveUp} title={L.moveUp}><Icon name="up" /></button>
            <button type="button" className="icon-btn" disabled={i === count - 1} onClick={() => onMove(1)} aria-label={L.moveDown} title={L.moveDown}><Icon name="down" /></button>
            <button type="button" className="icon-btn" disabled={count === 1} onClick={onRemove} aria-label={L.removeStep} title={L.removeStep}><Icon name="trash" /></button>
          </div>
        )}
      </header>
      <div className="wfb-step-body">
        <div className="grid-2">
          <Field label={L.stepName}>{(fid) => <Input id={fid} value={s.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />}</Field>
          <Field label={L.approverType}>{(fid) => (
            <Select id={fid} value={s.approverType} onChange={(e) => onChange({ approverType: e.target.value as ApproverType, approverConfig: {} })} options={approverTypeOptions(t)} />
          )}</Field>
        </div>
        <p className="wfb-explain small"><Icon name="users" /> {W.explain[s.approverType]}</p>
        <div className="grid-2">
          <ApproverFields idPrefix={`${idp}-cfg`} type={s.approverType} config={s.approverConfig} refs={refs} disabled={readOnly} onChange={(c) => onChange({ approverConfig: c })} />
          <Field label={L.sla} hint={L.slaHint}>{(fid) => (
            <Input id={fid} type="number" min={1} max={8760} step={1} className="r num" value={s.slaHours ?? ''}
              onChange={(e) => onChange({ slaHours: e.target.value === '' ? null : Math.trunc(Number(e.target.value)) })} />
          )}</Field>
        </div>

        <label className="check wfb-check-hint">
          <input type="checkbox" checked={s.condOn} onChange={(e) => onChange(e.target.checked
            ? { condOn: true, condition: s.condition ?? { all: [{ field: 'amount', op: 'gte', value: 10000 }] } }
            : { condOn: false })} />
          <span>{L.stepCond}<small className="hint">{L.stepCondHint}</small></span>
        </label>
        {s.condOn && (
          <div className="wfb-sub">
            <ConditionBuilder value={s.condition} refs={refs} disabled={readOnly} stepMode onChange={(c) => onChange({ condition: c })} />
            {hasEmptyList(s.condition) && <p className="small wfp-warn"><Icon name="alert" /> {L.warnEmptyList}</p>}
          </div>
        )}

        <label className="check wfb-check-hint">
          <input type="checkbox" checked={!!s.escalation} onChange={(e) => onChange({ escalation: e.target.checked ? { approverType: 'FINANCE_MANAGER', config: {} } : null })} />
          <span>{L.escalate}<small className="hint">{L.escalateHint}</small></span>
        </label>
        {s.escalation && (
          <div className="wfb-sub">
            {!s.slaHours && <p className="small wfp-warn"><Icon name="alert" /> {L.escalateNeedsSla}</p>}
            <div className="grid-2">
              <Field label={L.escalateTo}>{(fid) => (
                <Select id={fid} value={s.escalation!.approverType} options={approverTypeOptions(t)}
                  onChange={(e) => onChange({ escalation: { approverType: e.target.value as ApproverType, config: {} } })} />
              )}</Field>
              <ApproverFields idPrefix={`${idp}-esc`} type={s.escalation.approverType} config={s.escalation.config} refs={refs} disabled={readOnly}
                onChange={(c) => onChange({ escalation: { approverType: s.escalation!.approverType, config: c } })} />
            </div>
            <p className="wfb-explain small">{W.explain[s.escalation.approverType]}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function LivePreview({ draft, saved, dirty, refs, L }: { draft: Draft; saved: WorkflowDefinitionDto | null; dirty: boolean; refs: WfRefs; L: Txt }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [sample, setSample] = useState<SampleInput>(EMPTY_SAMPLE);
  const [server, setServer] = useState<{ own: WorkflowPreviewDto | null; routed: WorkflowPreviewDto } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const ctx = useMemo(() => sampleContext(sample, refs, user?.company?.industryCode ?? null), [sample, refs, user]);
  const defMatch = evaluateCondition(draft.conditions, ctx);
  const selectable = draft.isActive && effectiveState(draft.effectiveFrom || null, draft.effectiveTo || null) === 'current';

  const savedId = saved?.id;
  const savedRev = saved?.revision;
  const wt = saved && !dirty ? saved.workflowType : draft.workflowType;
  useEffect(() => {
    const my = ++seq.current;
    const h = setTimeout(async () => {
      setBusy(true);
      try {
        const b = { workflowType: wt, ...previewBody(sample) };
        const [own, routed] = await Promise.all([
          savedId ? api<WorkflowPreviewDto>('POST', '/workflows/preview', { ...b, definitionId: savedId }) : Promise.resolve(null),
          api<WorkflowPreviewDto>('POST', '/workflows/preview', b),
        ]);
        if (my === seq.current) { setServer({ own, routed }); setErr(null); }
      } catch (e) { if (my === seq.current) setErr(e); } finally { if (my === seq.current) setBusy(false); }
    }, 350);
    return () => clearTimeout(h);
  }, [sample, savedId, savedRev, wt]);

  const routedDef = server?.routed.definition;
  return (
    <Card title={L.previewTitle} subtitle={L.previewSub} className="wfb-preview">
      <details className="wfb-sample" open>
        <summary>{L.sampleItem}</summary>
        <SampleForm value={sample} onChange={setSample} refs={refs} />
      </details>

      <div className="wfp-verdict" aria-live="polite">
        <div className={defMatch ? 'wfp-ok' : 'wfp-bad'}>
          <Icon name={defMatch ? 'check' : 'x'} /> {defMatch ? L.defMatch : L.defNoMatch}
        </div>
        {!selectable && <div className="wfp-warn small"><Icon name="alert" /> {L.notSelectable}</div>}
        <div className="small">
          {L.routingNow}: {busy && !server ? '…' : routedDef
            ? <><Link to={`/admin/workflows/${routedDef.id}`}><strong>{routedDef.name}</strong></Link> <Badge tone={routedDef.id === saved?.id ? 'success' : 'neutral'}>{routedDef.id === saved?.id ? L.thisOne : L.another}</Badge></>
            : <Badge tone="danger">{L.noneSelected}</Badge>}
        </div>
      </div>
      <ServerErrors error={err} />

      {saved && dirty && <p className="small muted">{fmt(L.savedOnly, { n: saved.revision })}</p>}
      {!saved && <p className="small muted">{L.saveToResolve}</p>}

      <ol className="wfp-steps">
        {draft.steps.map((s, i) => {
          const included = evaluateCondition(s.condOn ? s.condition : null, ctx);
          const srv = server?.own?.steps[i];
          const sameStep = srv && srv.name === s.name.trim() && srv.approverType === s.approverType;
          return (
            <li key={s.key} className={included ? (sameStep && !srv!.approvers.length ? 'is-warn' : 'is-ok') : 'is-skip'}>
              <span className="wfp-dot" aria-hidden="true">{included ? i + 1 : '–'}</span>
              <div>
                <div className="wfp-name">{s.name || '—'} <span className="muted small">· {t(`approverType.${s.approverType}` as TKey)}</span></div>
                {!included ? <div className="small muted">{L.skipped}</div>
                  : sameStep && srv!.included
                    ? srv!.approvers.length
                      ? <div className="small">{L.approvers}: <strong>{srv!.approvers.join(', ')}</strong></div>
                      : <div className="small wfp-warn"><Icon name="alert" /> {L.noApprover}</div>
                    : <div className="small muted">{L.included} · {L.approvers}: {L.unresolved}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
