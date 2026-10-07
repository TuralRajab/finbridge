import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  MONTH_SHORT,
  type AuditLogDto, type BudgetDetailDto, type BudgetLineDto, type BudgetSectionDto, type BudgetVersionDto, type VersionDiffRow, type VersionStatus,
} from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ImportDialog } from '../../components/ImportDialog';
import {
  ActionDialog, Alert, Badge, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader,
  SectionStatusBadge, Select, Spinner, Tabs, VersionStatusBadge,
} from '../../components/ui';
import { WorkflowPanel } from '../../components/WorkflowPanel';
import { fmt, useI18n, useLocal, type TKey } from '../../i18n';
import { useDisplayName, useMasterData, usableAccounts } from '../../lib/masterdata';
import { date, money, parseAmount } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { AmountInput, Delta, DetailedError, sum } from './budgetUi';
import { PlanningTab } from './PlanningTab';
import { FillFromLastYearModal, lineKey, RefCells, refHeaders, RefToggles, useLineRefs, useRefCols, useRefTexts } from './planningLines';
import '../../styles/budgets.css';

/* ------------------------------------------------------------------ texts */

const az = {
  budgets: 'Büdcələr',
  fiscalYear: '{year} maliyyə ili',
  version: 'Versiya',
  versionOption: 'v{n} · {name} · {status}',
  currentMark: 'cari',
  kind: 'Növ',
  total: 'Cəmi büdcə',
  lines: 'Sətir',
  sectionsApproved: 'Təsdiqlənmiş bölmələr',
  opexCapex: 'OPEX / CAPEX',
  submitVersion: 'Versiyanı təsdiqə göndər',
  submitVersionHint: 'Bütün bölmələr təsdiqləndikdən sonra versiya illik büdcə təsdiq axınına göndərilir.',
  submitVersionBlocked: 'Göndərmək üçün sətri olan bütün bölmələr təsdiqlənməlidir ({done}/{total}).',
  submitVersionConfirm: 'Büdcə versiyası illik təsdiq axınına göndəriləcək. Göndərildikdən sonra sətirlər redaktə edilə bilməz.',
  lock: 'Versiyanı kilidlə',
  lockConfirm: 'Təsdiqlənmiş versiya kilidlənəcək və nəzarət üçün qüvvədə olan büdcəyə çevriləcək. Bundan sonra dəyişikliklər yalnız büdcə dəyişikliyi sorğusu ilə mümkündür.',
  createChange: 'Dəyişiklik sorğusu',
  import: 'Excel-dən idxal',
  export: 'Excel-ə ixrac',
  oldVersion: 'Siz v{n} versiyasına baxırsınız. Cari versiya: v{current}.',
  openCurrent: 'Cari versiyaya keç',
  basedOn: 'v{n} əsasında',
  fromChange: 'Dəyişiklik sorğusundan yaranıb',
  tabSections: 'Bölmələr',
  tabPlanning: 'Planlama müqayisəsi',
  tabLines: 'Büdcə sətirləri',
  tabCompare: 'Versiyaların müqayisəsi',
  tabHistory: 'Tarixçə',
  stepDraft: 'Hazırlanır',
  stepApproval: 'Təsdiqdə',
  stepApproved: 'Təsdiqlənib',
  stepLocked: 'Kilidlənib',
  superseded: 'Bu versiya əvəzlənib: yeni versiya dəyişiklik sorğusu əsasında yaradılıb. Bu versiyanın sətirləri dəyişməz saxlanılır.',
  // sections
  unit: 'Bölmə',
  head: 'Rəhbər',
  submitted: 'Göndərilib',
  workflow: 'Təsdiq axını',
  showWorkflow: 'Axına bax',
  noWorkflow: 'Göndərilməyib',
  openLines: 'Sətirlər',
  submitSection: 'Təsdiqə göndər',
  submitSectionTitle: 'Bölməni təsdiqə göndər: {name}',
  submitSectionHint: 'Bölmənin sətirləri təsdiq axınına göndərilir. Təsdiq və ya qaytarılana qədər redaktə bağlanır.',
  reopen: 'Yenidən aç',
  reopenTitle: 'Bölməni yenidən aç: {name}',
  reopenHint: 'Təsdiqlənmiş bölmə yenidən redaktəyə açılır və təkrar təsdiq tələb edəcək.',
  noLinesYet: 'Sətir yoxdur',
  noSections: 'Bu versiyada sizə görünən bölmə yoxdur.',
  sectionWorkflow: 'Bölmənin təsdiq axını: {name}',
  versionWorkflow: 'Versiyanın təsdiq axını (v{n})',
  pickSection: 'Təsdiq axınını görmək üçün cədvəldə bölməni seçin.',
  // lines
  filterSection: 'Bölmə',
  filterCostCenter: 'Xərc mərkəzi',
  filterAccount: 'Hesab',
  search: 'Axtarış',
  searchPlaceholder: 'Kod, ad və ya təsvir',
  all: 'Hamısı',
  costCenter: 'Xərc mərkəzi',
  account: 'Hesab',
  class: 'Sinif',
  rowTotal: 'Cəmi',
  addLine: 'Sətir əlavə et',
  save: 'Dəyişiklikləri yadda saxla',
  discard: 'Ləğv et',
  unsaved: '{n} sətirdə yadda saxlanmamış dəyişiklik',
  saved: 'Yadda saxlanıldı.',
  deleteLine: 'Sətri sil',
  deleteConfirm: '{cc} / {acc} sətri silinsin? Bu əməliyyat geri qaytarıla bilməz.',
  emptyLines: 'Seçilmiş filtrlər üzrə sətir yoxdur.',
  totalRow: 'Cəmi',
  lockedBanner: 'Bu versiya «{status}» statusundadır və redaktə edilə bilməz. Təsdiqlənmiş və kilidlənmiş büdcəyə dəyişiklik yalnız büdcə dəyişikliyi sorğusu ilə edilir — orijinal versiya dəyişməz qalır.',
  approvalBanner: 'Versiya təsdiq axınındadır. Təsdiq və ya qaytarılana qədər sətirlər redaktə edilə bilməz.',
  sectionLocked: '«{name}» bölməsi «{status}» statusundadır — redaktə bağlıdır.',
  someLocked: '{n} bölmə təsdiqdə və ya təsdiqlənib, onların sətirləri yalnız oxunur.',
  readOnlyRole: 'Sizin rolunuz büdcə sətirlərini yalnız görməyə icazə verir.',
  leaveWarning: 'Yadda saxlanmamış dəyişikliklər var. Çıxılsın?',
  linesHint: 'Xanaya klikləyib məbləği daxil edin, Enter ilə təsdiqləyin. Dəyişikliklər yadda saxlanana qədər sarı rənglə qeyd olunur.',
  // add line
  newLine: 'Yeni büdcə sətri',
  newLineCc: 'Xərc mərkəzi',
  newLineAccount: 'Hesab',
  newLineAccountHint: 'Yalnız bu xərc mərkəzi üçün icazəli, büdcələşdirməyə açıq alt hesablar göstərilir.',
  duplicatesHidden: '{n} hesab üzrə bu xərc mərkəzində artıq sətir var və siyahıdan çıxarılıb.',
  noAccounts: 'Bu xərc mərkəzi üçün əlavə edilə bilən hesab qalmayıb.',
  noCostCenters: 'Redaktəyə açıq bölmələrdə xərc mərkəzi yoxdur.',
  description: 'Təsvir',
  annual: 'İllik məbləğ',
  annualHint: 'Aylara bərabər bölünür; sonra hər ayı cədvəldə dəqiqləşdirə bilərsiniz.',
  invalidAmount: 'Məbləğ düzgün deyil.',
  // compare
  compareA: 'Əvvəlki versiya (A)',
  compareB: 'Müqayisə olunan versiya (B)',
  compareNeedTwo: 'Müqayisə üçün ən azı iki versiya olmalıdır.',
  compareSame: 'İki fərqli versiya seçin.',
  compareNone: 'Versiyalar arasında fərq yoxdur.',
  groupBy: 'Qruplaşdırma',
  groupMonth: 'Hər ay ayrıca',
  groupLine: 'Xərc mərkəzi × hesab üzrə cəm',
  before: 'A',
  after: 'B',
  difference: 'Fərq',
  month: 'Ay',
  increases: 'Artım',
  decreases: 'Azalma',
  net: 'Xalis dəyişiklik',
  changedCells: 'Dəyişən xana',
  // history
  historyEmpty: 'Tarixçə boşdur.',
  historyNoAccess: 'Büdcə tarixçəsi yalnız maliyyə rəhbərliyi və audit hüququ olan istifadəçilərə görünür.',
  system: 'Sistem',
  entity: {
    BUDGET: 'Büdcə', BUDGET_VERSION: 'Versiya', BUDGET_SECTION: 'Bölmə', BUDGET_LINE: 'Sətir',
  } as Record<string, string>,
  action: {
    CREATED: 'Yaradıldı', UPDATED: 'Dəyişdirildi', DELETED: 'Silindi', SUBMITTED: 'Təsdiqə göndərildi', LOCKED: 'Kilidləndi',
    REOPENED: 'Yenidən açıldı', IMPORTED: 'Excel-dən idxal edildi', CREATED_FROM_CHANGE: 'Dəyişiklik sorğusundan yaradıldı', APPROVED: 'Təsdiqləndi',
  } as Record<string, string>,
  confirm: 'Təsdiqlə',
  cancel: 'Ləğv et',
};
const TEXT = {
  az,
  en: {
    budgets: 'Budgets',
    fiscalYear: 'Fiscal year {year}',
    version: 'Version',
    versionOption: 'v{n} · {name} · {status}',
    currentMark: 'current',
    kind: 'Kind',
    total: 'Total budget',
    lines: 'Lines',
    sectionsApproved: 'Sections approved',
    opexCapex: 'OPEX / CAPEX',
    submitVersion: 'Submit version for approval',
    submitVersionHint: 'Once every section is approved, the version goes into the annual budget approval workflow.',
    submitVersionBlocked: 'All sections with lines must be approved first ({done}/{total}).',
    submitVersionConfirm: 'The budget version will be sent into the annual approval workflow. Lines cannot be edited after submission.',
    lock: 'Lock version',
    lockConfirm: 'The approved version will be locked and become the budget in force for spend control. After that, changes are only possible through a budget change request.',
    createChange: 'Change request',
    import: 'Import from Excel',
    export: 'Export to Excel',
    oldVersion: 'You are viewing version v{n}. Current version: v{current}.',
    openCurrent: 'Go to current version',
    basedOn: 'based on v{n}',
    fromChange: 'Created from a change request',
    tabSections: 'Sections',
    tabPlanning: 'Planning comparison',
    tabLines: 'Budget lines',
    tabCompare: 'Compare versions',
    tabHistory: 'History',
    stepDraft: 'Drafting',
    stepApproval: 'In approval',
    stepApproved: 'Approved',
    stepLocked: 'Locked',
    superseded: 'This version has been superseded: a newer version was created from a change request. Its lines are preserved unchanged.',
    unit: 'Section',
    head: 'Head',
    submitted: 'Submitted',
    workflow: 'Workflow',
    showWorkflow: 'View workflow',
    noWorkflow: 'Not submitted',
    openLines: 'Lines',
    submitSection: 'Submit',
    submitSectionTitle: 'Submit section: {name}',
    submitSectionHint: 'The section\'s lines go into the approval workflow. Editing is closed until it is approved or returned.',
    reopen: 'Reopen',
    reopenTitle: 'Reopen section: {name}',
    reopenHint: 'The approved section is reopened for editing and will need approval again.',
    noLinesYet: 'No lines',
    noSections: 'No sections of this version are visible to you.',
    sectionWorkflow: 'Section workflow: {name}',
    versionWorkflow: 'Version workflow (v{n})',
    pickSection: 'Select a section in the table to see its workflow.',
    filterSection: 'Section',
    filterCostCenter: 'Cost center',
    filterAccount: 'Account',
    search: 'Search',
    searchPlaceholder: 'Code, name or description',
    all: 'All',
    costCenter: 'Cost center',
    account: 'Account',
    class: 'Class',
    rowTotal: 'Total',
    addLine: 'Add line',
    save: 'Save changes',
    discard: 'Discard',
    unsaved: 'Unsaved changes in {n} lines',
    saved: 'Saved.',
    deleteLine: 'Delete line',
    deleteConfirm: 'Delete line {cc} / {acc}? This cannot be undone.',
    emptyLines: 'No lines match the selected filters.',
    totalRow: 'Total',
    lockedBanner: 'This version is "{status}" and cannot be edited. An approved or locked budget can only change through a budget change request — the original version stays unchanged.',
    approvalBanner: 'The version is in its approval workflow. Lines cannot be edited until it is approved or returned.',
    sectionLocked: 'Section "{name}" is "{status}" — editing is closed.',
    someLocked: '{n} sections are in approval or approved; their lines are read-only.',
    readOnlyRole: 'Your role can view budget lines but not edit them.',
    leaveWarning: 'You have unsaved changes. Leave anyway?',
    linesHint: 'Click a cell, type the amount and press Enter. Changed rows are highlighted until saved.',
    newLine: 'New budget line',
    newLineCc: 'Cost center',
    newLineAccount: 'Account',
    newLineAccountHint: 'Only leaf accounts open for budgeting and allowed on this cost center are listed.',
    duplicatesHidden: '{n} accounts already have a line on this cost center and are hidden.',
    noAccounts: 'No more accounts can be added to this cost center.',
    noCostCenters: 'No cost centers in sections open for editing.',
    description: 'Description',
    annual: 'Annual amount',
    annualHint: 'Spread evenly across months; you can refine each month in the grid afterwards.',
    invalidAmount: 'Invalid amount.',
    compareA: 'Earlier version (A)',
    compareB: 'Compared version (B)',
    compareNeedTwo: 'At least two versions are needed for a comparison.',
    compareSame: 'Choose two different versions.',
    compareNone: 'No differences between the versions.',
    groupBy: 'Grouping',
    groupMonth: 'Each month separately',
    groupLine: 'Totals per cost center × account',
    before: 'A',
    after: 'B',
    difference: 'Difference',
    month: 'Month',
    increases: 'Increases',
    decreases: 'Decreases',
    net: 'Net change',
    changedCells: 'Changed cells',
    historyEmpty: 'No history yet.',
    historyNoAccess: 'Budget history is visible to finance management and users with audit rights.',
    system: 'System',
    entity: { BUDGET: 'Budget', BUDGET_VERSION: 'Version', BUDGET_SECTION: 'Section', BUDGET_LINE: 'Line' } as Record<string, string>,
    action: {
      CREATED: 'Created', UPDATED: 'Updated', DELETED: 'Deleted', SUBMITTED: 'Submitted for approval', LOCKED: 'Locked',
      REOPENED: 'Reopened', IMPORTED: 'Imported from Excel', CREATED_FROM_CHANGE: 'Created from change request', APPROVED: 'Approved',
    } as Record<string, string>,
    confirm: 'Confirm',
    cancel: 'Cancel',
  } satisfies typeof az,
};
type Texts = typeof az;

type Tab = 'planning' | 'sections' | 'lines' | 'compare' | 'history';

/* ------------------------------------------------------------------ page */

export function BudgetDetailPage() {
  const { id } = useParams();
  const budgetId = Number(id);
  const [params, setParams] = useSearchParams();
  const versionParam = params.get('versionId') ? Number(params.get('versionId')) : undefined;
  const L = useLocal(TEXT);
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();

  const { data: detail, setData: setDetail, error, loading, reload } = useAsync(
    () => api<BudgetDetailDto>('GET', `/budgets/${budgetId}${qs({ versionId: versionParam })}`), [budgetId, versionParam],
  );
  const versionId = detail?.version.id;
  const linesQ = useAsync(
    () => (versionId ? api<BudgetLineDto[]>('GET', `/budgets/${budgetId}/lines${qs({ versionId })}`) : Promise.resolve([] as BudgetLineDto[])),
    [budgetId, versionId],
  );
  const [tabState, setTab] = useState<Tab | null>((params.get('tab') as Tab) || null);
  const [sectionFilter, setSectionFilter] = useState<number | ''>('');
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'submit' | 'lock' | null>(null);
  const [importing, setImporting] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [dirtyCount, setDirtyCount] = useState(0);

  const reloadAll = async () => { await Promise.all([reload(), linesQ.reload()]); setHistoryKey((k) => k + 1); };

  if (loading && !detail) return <Spinner />;
  if (error || !detail) return <ErrorMessage error={error} />;

  const v = detail.version;
  // the planning comparison opens first while a version is being drafted
  const tab: Tab = tabState ?? (v.status === 'DRAFT' ? 'planning' : 'sections');
  const isCurrent = v.id === detail.currentVersionId;
  const currentNo = detail.versions.find((x) => x.id === detail.currentVersionId)?.versionNo ?? v.versionNo;
  const lines = linesQ.data ?? [];
  const withLines = detail.sections.filter((s) => s.lineCount > 0);
  const approvedSections = withLines.filter((s) => s.status === 'APPROVED').length;
  const opex = sum(lines.filter((l) => l.expenseClass !== 'CAPEX').map((l) => l.total));
  const capex = sum(lines.filter((l) => l.expenseClass === 'CAPEX').map((l) => l.total));

  const selectVersion = (vid: number) => {
    if (dirtyCount && !window.confirm(L.leaveWarning)) return;
    const next = new URLSearchParams(params);
    if (vid === detail.currentVersionId) next.delete('versionId'); else next.set('versionId', String(vid));
    setParams(next, { replace: true });
    setSelectedSection(null);
  };

  const runConfirm = async () => {
    const path = confirm === 'submit' ? `/budgets/${budgetId}/submit` : `/budgets/${budgetId}/lock`;
    setDetail(await api<BudgetDetailDto>('POST', path));
    await reloadAll();
  };

  const versionOpts = [...detail.versions].sort((a, b) => b.versionNo - a.versionNo).map((x) => ({
    value: x.id,
    label: `${fmt(L.versionOption, { n: x.versionNo, name: x.name, status: t(`versionStatus.${x.status}`) })}${x.id === detail.currentVersionId ? ` (${L.currentMark})` : ''}`,
  }));

  const showSubmitBlocked = isCurrent && v.status === 'DRAFT' && can('budget.manage') && !detail.canSubmitVersion;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/budgets">← {L.budgets}</Link>}
        title={<>{detail.name} <VersionStatusBadge status={v.status} /></>}
        subtitle={<>
          {fmt(L.fiscalYear, { year: detail.fiscalYear })} · {t(`versionKind.${v.kind}` as TKey)}
          {v.basedOnVersionId && <> · {fmt(L.basedOn, { n: detail.versions.find((x) => x.id === v.basedOnVersionId)?.versionNo ?? '?' })}</>}
          {v.changeRequestId && <> · <Link to={`/changes/${v.changeRequestId}`}>{L.fromChange}</Link></>}
        </>}
        actions={<>
          <div className="version-picker">
            <label className="sr-only" htmlFor="version-select">{L.version}</label>
            <Select id="version-select" value={v.id} onChange={(e) => selectVersion(Number(e.target.value))} options={versionOpts} />
          </div>
          {can('excel.export') && <ExportButton path={`/export/budget/${budgetId}${qs({ versionId: isCurrent ? undefined : v.id })}`} filename={`budget-${detail.fiscalYear}-v${v.versionNo}.xlsx`} label={L.export} />}
          {detail.canImport && isCurrent && <Button onClick={() => setImporting(true)}><Icon name="upload" /> {L.import}</Button>}
          {detail.canCreateChange && isCurrent && (
            <Button onClick={() => navigate(`/changes/new?budgetId=${budgetId}`)}><Icon name="change" /> {L.createChange}</Button>
          )}
          {detail.canLock && isCurrent && <Button variant="primary" onClick={() => setConfirm('lock')}><Icon name="lock" /> {L.lock}</Button>}
          {detail.canSubmitVersion && isCurrent && <Button variant="primary" onClick={() => setConfirm('submit')}><Icon name="check" /> {L.submitVersion}</Button>}
          {showSubmitBlocked && (
            <Button variant="primary" disabled title={fmt(L.submitVersionBlocked, { done: approvedSections, total: withLines.length })}>
              <Icon name="check" /> {L.submitVersion}
            </Button>
          )}
        </>}
      />

      {!isCurrent && (
        <Alert kind="info">
          <span className="banner-row">
            <span><Icon name="history" /> {fmt(L.oldVersion, { n: v.versionNo, current: currentNo })}</span>
            <Button size="sm" onClick={() => selectVersion(detail.currentVersionId!)}>{L.openCurrent}</Button>
          </span>
        </Alert>
      )}
      {showSubmitBlocked && withLines.length > 0 && <p className="small muted mb-8">{fmt(L.submitVersionBlocked, { done: approvedSections, total: withLines.length })}</p>}

      <Lifecycle status={v.status} L={L} />

      <div className="kpis budget-kpis">
        <div className="kpi"><div className="kpi-label">{L.total}</div><div className="kpi-value num">{money(v.total, locale)}<span className="kpi-unit">{detail.currency}</span></div>
          <div className="kpi-foot">v{v.versionNo} · {date(v.createdAt, locale)}</div></div>
        <div className="kpi"><div className="kpi-label">{L.lines}</div><div className="kpi-value num">{v.lineCount}</div>
          <div className="kpi-foot">{v.createdBy ?? ''}</div></div>
        <div className="kpi"><div className="kpi-label">{L.sectionsApproved}</div><div className="kpi-value num">{approvedSections}<span className="kpi-unit">/ {withLines.length}</span></div>
          <div className="progress"><span style={{ width: `${withLines.length ? (approvedSections / withLines.length) * 100 : 0}%` }} /></div></div>
        <div className="kpi"><div className="kpi-label">{L.opexCapex}</div>
          <div className="kpi-value kpi-split num">{money(opex, locale)}<span className="kpi-unit">/ {money(capex, locale)}</span></div>
          <div className="kpi-foot">{detail.currency}</div></div>
      </div>

      <div className="tabs-wrap"><Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'planning', label: L.tabPlanning },
        { value: 'sections', label: L.tabSections },
        { value: 'lines', label: <>{L.tabLines} {dirtyCount > 0 && <span className="dirty-dot" aria-label={fmt(L.unsaved, { n: dirtyCount })}>●</span>}</> },
        { value: 'compare', label: L.tabCompare },
        { value: 'history', label: L.tabHistory },
      ]} /></div>

      {tab === 'planning' && <PlanningTab key={v.id} detail={detail} />}
      {tab === 'sections' && (
        <SectionsTab detail={detail} isCurrent={isCurrent} L={L} selected={selectedSection} onSelect={setSelectedSection}
          onOpenLines={(unitId) => { setSectionFilter(unitId); setTab('lines'); }} onChanged={reloadAll} setDetail={setDetail} />
      )}
      <div hidden={tab !== 'lines'}>
        <LinesTab detail={detail} isCurrent={isCurrent} lines={linesQ.data} loading={linesQ.loading} error={linesQ.error}
          setLines={(ls) => linesQ.setData(ls)} reloadLines={linesQ.reload} onChanged={() => { void reload(); setHistoryKey((k) => k + 1); }}
          sectionFilter={sectionFilter} setSectionFilter={setSectionFilter} onDirty={setDirtyCount} L={L} />
      </div>
      {tab === 'compare' && <CompareTab key={v.id} detail={detail} L={L} />}
      {tab === 'history' && <HistoryTab budgetId={budgetId} reloadKey={historyKey} lines={lines} L={L} />}

      {confirm && (
        <ConfirmModal
          title={confirm === 'submit' ? L.submitVersion : L.lock}
          text={confirm === 'submit' ? L.submitVersionConfirm : L.lockConfirm}
          confirmLabel={confirm === 'submit' ? L.submitVersion : L.lock}
          L={L} onConfirm={runConfirm} onClose={() => setConfirm(null)}
        />
      )}
      {importing && (
        <ImportDialog kind="budget" endpoint={`/budgets/${budgetId}/import`} templatePath="/export/templates/budget"
          templateFilename="finbridge-budget-template.xlsx" currency={detail.currency}
          onClose={() => setImporting(false)} onDone={() => { void reloadAll(); }} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ lifecycle */

function Lifecycle({ status, L }: { status: VersionStatus; L: Texts }) {
  if (status === 'SUPERSEDED') return <Alert kind="info"><Icon name="lock" /> {L.superseded}</Alert>;
  const steps: { s: VersionStatus; label: string }[] = [
    { s: 'DRAFT', label: L.stepDraft }, { s: 'IN_APPROVAL', label: L.stepApproval }, { s: 'APPROVED', label: L.stepApproved }, { s: 'LOCKED', label: L.stepLocked },
  ];
  const idx = steps.findIndex((x) => x.s === status);
  return (
    <ol className="stepper">
      {steps.map((x, i) => (
        <li key={x.s} className={i < idx || status === 'LOCKED' ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          <span className="step-dot">{i < idx || status === 'LOCKED' ? '✓' : i + 1}</span><span>{x.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ConfirmModal({ title, text, confirmLabel, danger, L, onConfirm, onClose }: {
  title: string; text: string; confirmLabel: string; danger?: boolean; L: Texts; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{L.cancel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await onConfirm(); onClose(); } catch (e) { setError(e); } finally { setBusy(false); }
      }}>{confirmLabel}</Button>
    </>}>
      <p>{text}</p>
      <DetailedError error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ sections */

function SectionsTab({ detail, isCurrent, L, selected, onSelect, onOpenLines, onChanged, setDetail }: {
  detail: BudgetDetailDto; isCurrent: boolean; L: Texts; selected: number | null; onSelect: (id: number | null) => void;
  onOpenLines: (unitId: number) => void; onChanged: () => Promise<void>; setDetail: (d: BudgetDetailDto) => void;
}) {
  const { locale } = useI18n();
  const [action, setAction] = useState<{ kind: 'submit' | 'reopen'; section: BudgetSectionDto } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const sel = detail.sections.find((s) => s.orgUnitId === selected) ?? null;
  const totals = { lines: sum(detail.sections.map((s) => s.lineCount)), total: sum(detail.sections.map((s) => s.total)) };

  const run = async (comment: string) => {
    if (!action) return;
    setError(null);
    const base = `/budgets/${detail.id}/sections/${action.section.orgUnitId}`;
    const d = action.kind === 'submit'
      ? await api<BudgetDetailDto>('POST', `${base}/submit`)
      : await api<BudgetDetailDto>('POST', `${base}/reopen`, { comment: comment || null });
    setDetail(d);
    onSelect(action.section.orgUnitId);
    await onChanged();
  };

  return (
    <>
      <ErrorMessage error={error} />
      <Card flush>
        {detail.sections.length === 0 ? <Empty>{L.noSections}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{L.unit}</th><th>{L.head}</th><th>{L.workflow}</th><th className="r">{L.lines}</th>
                <th className="r">{L.total} ({detail.currency})</th><th>{L.submitted}</th><th className="r">{''}</th>
              </tr></thead>
              <tbody>
                {detail.sections.map((s) => (
                  <tr key={s.orgUnitId} className={`clickable${selected === s.orgUnitId ? ' is-selected' : ''}`} onClick={() => onSelect(s.orgUnitId)}
                    aria-selected={selected === s.orgUnitId}>
                    <td><b>{s.name}</b><div className="muted small">{s.code}</div></td>
                    <td>{s.headName ?? <span className="muted">—</span>}</td>
                    <td>
                      <SectionStatusBadge status={s.status} />
                      {s.workflowInstanceId
                        ? <button type="button" className="link-btn small" onClick={(e) => { e.stopPropagation(); onSelect(s.orgUnitId); }}>{L.showWorkflow}</button>
                        : <div className="muted small">{L.noWorkflow}</div>}
                    </td>
                    <td className="r num">{s.lineCount}</td>
                    <td className="r num">{money(s.total, locale)}</td>
                    <td className="small">{date(s.submittedAt, locale)}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <Button size="sm" variant="ghost" onClick={() => onOpenLines(s.orgUnitId)}>{L.openLines}</Button>
                        {isCurrent && s.canSubmit && <Button size="sm" variant="primary" onClick={() => setAction({ kind: 'submit', section: s })}>{L.submitSection}</Button>}
                        {isCurrent && !s.canSubmit && s.canEdit && s.lineCount === 0 && <span className="muted small">{L.noLinesYet}</span>}
                        {isCurrent && s.canReopen && <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'reopen', section: s })}>{L.reopen}</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={3}><b>{L.totalRow}</b></td>
                <td className="r num"><b>{totals.lines}</b></td>
                <td className="r num"><b>{money(totals.total, locale)}</b></td>
                <td colSpan={2} />
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2 gap-lg">
        <div>
          {sel ? (
            <WorkflowPanel instanceId={sel.workflowInstanceId} title={fmt(L.sectionWorkflow, { name: sel.name })} onChanged={() => void onChanged()} />
          ) : (
            <Card title={L.workflow}><p className="muted">{L.pickSection}</p></Card>
          )}
        </div>
        <div>
          <WorkflowPanel instanceId={detail.version.workflowInstanceId} title={fmt(L.versionWorkflow, { n: detail.version.versionNo })} onChanged={() => void onChanged()} />
        </div>
      </div>

      {action && (
        <ActionDialog
          title={fmt(action.kind === 'submit' ? L.submitSectionTitle : L.reopenTitle, { name: action.section.name })}
          hint={action.kind === 'submit' ? L.submitSectionHint : L.reopenHint}
          confirmLabel={action.kind === 'submit' ? L.submitSection : L.reopen}
          onConfirm={run}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ lines */

type Draft = Record<number, number[]>;

function LinesTab({ detail, isCurrent, lines, loading, error, setLines, reloadLines, onChanged, sectionFilter, setSectionFilter, onDirty, L }: {
  detail: BudgetDetailDto; isCurrent: boolean; lines: BudgetLineDto[] | null; loading: boolean; error: unknown;
  setLines: (l: BudgetLineDto[]) => void; reloadLines: () => Promise<void>; onChanged: () => void;
  sectionFilter: number | ''; setSectionFilter: (v: number | '') => void; onDirty: (n: number) => void; L: Texts;
}) {
  const { t, lang, locale } = useI18n();
  const { can } = useAuth();
  const [ccFilter, setCcFilter] = useState<number | ''>('');
  const [accFilter, setAccFilter] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [savedFlag, setSavedFlag] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<BudgetLineDto | null>(null);
  const dirty = Object.keys(drafts).length;
  const T = useRefTexts();
  const [refCols, setRefCols] = useRefCols();
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [filling, setFilling] = useState(false);

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { setDrafts({}); setSelection(new Set()); }, [detail.version.id]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const all = lines ?? [];
  const anyRef = refCols.actual || refCols.budget || refCols.delta || refCols.spark;
  const refs = useLineRefs(detail, all, anyRef || filling, 0);
  const refHdrs = anyRef ? refHeaders(refCols, refs, T) : [];
  const ccOptions = useMemo(() => {
    const m = new Map<number, string>();
    all.filter((l) => !sectionFilter || l.sectionUnitId === sectionFilter).forEach((l) => m.set(l.costCenterId, `${l.costCenterCode} · ${l.costCenterName}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, sectionFilter]);
  const accOptions = useMemo(() => {
    const m = new Map<number, string>();
    all.forEach((l) => m.set(l.accountId, `${l.accountCode} · ${l.accountName}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const q = search.trim().toLocaleLowerCase(locale);
  const visible = all.filter((l) => (!sectionFilter || l.sectionUnitId === sectionFilter)
    && (!ccFilter || l.costCenterId === ccFilter) && (!accFilter || l.accountId === accFilter)
    && (!q || `${l.costCenterCode} ${l.costCenterName} ${l.accountCode} ${l.accountName} ${l.description}`.toLocaleLowerCase(locale).includes(q)));

  const monthsOf = (l: BudgetLineDto) => drafts[l.id] ?? l.months;
  const setMonth = (l: BudgetLineDto, i: number, val: number) => {
    const months = [...monthsOf(l)];
    months[i] = val;
    setSavedFlag(false);
    setDrafts((d) => {
      const next = { ...d };
      if (months.every((m, k) => m === l.months[k])) delete next[l.id]; else next[l.id] = months;
      return next;
    });
  };

  const editable = isCurrent && detail.version.status === 'DRAFT';
  const anyEditable = editable && detail.sections.some((s) => s.canEdit) && can('budget.edit');
  const lockedSections = detail.sections.filter((s) => !s.canEdit && (s.status === 'IN_APPROVAL' || s.status === 'APPROVED'));
  const filteredSection = sectionFilter ? detail.sections.find((s) => s.orgUnitId === sectionFilter) : undefined;

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const updated = await api<BudgetLineDto[]>('PATCH', `/budgets/${detail.id}/lines`, {
        lines: Object.entries(drafts).map(([id, months]) => ({ id: Number(id), months })),
      });
      setLines(updated);
      setDrafts({});
      setSavedFlag(true);
      onChanged();
    } catch (e) { setSaveError(e); } finally { setSaving(false); }
  };

  const editableVisible = visible.filter((l) => editable && l.canEdit);
  const selectedLines = all.filter((l) => selection.has(l.id) && l.canEdit);
  const toggleSel = (id: number) => setSelection((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = editableVisible.length > 0 && editableVisible.every((l) => selection.has(l.id));
  const visibleRefRows = [...new Set(visible.map(lineKey))].map((k) => refs.byKey.get(k));

  const monthTotals = Array.from({ length: 12 }, (_, i) => sum(visible.map((l) => monthsOf(l)[i])));
  const classTotal = (cls: 'OPEX' | 'CAPEX') => {
    const ls = visible.filter((l) => (cls === 'CAPEX' ? l.expenseClass === 'CAPEX' : l.expenseClass !== 'CAPEX'));
    return { months: Array.from({ length: 12 }, (_, i) => sum(ls.map((l) => monthsOf(l)[i]))), n: ls.length };
  };
  const opex = classTotal('OPEX');
  const capex = classTotal('CAPEX');
  const months = MONTH_SHORT[lang];

  return (
    <>
      {!editable && detail.version.status === 'IN_APPROVAL' && isCurrent && <Alert kind="warning"><Icon name="lock" /> {L.approvalBanner}</Alert>}
      {!editable && detail.version.status !== 'IN_APPROVAL' && (
        <Alert kind="info">
          <span className="banner-row">
            <span><Icon name="lock" /> {fmt(L.lockedBanner, { status: t(`versionStatus.${detail.version.status}`) })}</span>
            {detail.canCreateChange && isCurrent && <Link className="btn btn-secondary btn-sm" to={`/changes/new?budgetId=${detail.id}`}><Icon name="change" /> {L.createChange}</Link>}
          </span>
        </Alert>
      )}
      {editable && filteredSection && !filteredSection.canEdit && (
        <Alert kind="warning"><Icon name="lock" /> {fmt(L.sectionLocked, { name: filteredSection.name, status: t(`sectionStatus.${filteredSection.status}`) })}</Alert>
      )}
      {editable && !filteredSection && lockedSections.length > 0 && <p className="small muted mb-8"><Icon name="lock" /> {fmt(L.someLocked, { n: lockedSections.length })}</p>}
      {editable && !can('budget.edit') && <p className="small muted mb-8">{L.readOnlyRole}</p>}

      <Card flush>
        <div className="table-toolbar lines-toolbar">
          <Field label={L.filterSection}>
            {(fid) => <Select id={fid} value={sectionFilter} onChange={(e) => { setSectionFilter(e.target.value ? Number(e.target.value) : ''); setCcFilter(''); }}
              options={[{ value: '', label: L.all }, ...detail.sections.map((s) => ({ value: s.orgUnitId, label: s.name }))]} />}
          </Field>
          <Field label={L.filterCostCenter}>
            {(fid) => <Select id={fid} value={ccFilter} onChange={(e) => setCcFilter(e.target.value ? Number(e.target.value) : '')}
              options={[{ value: '', label: L.all }, ...ccOptions.map(([value, label]) => ({ value, label }))]} />}
          </Field>
          <Field label={L.filterAccount}>
            {(fid) => <Select id={fid} value={accFilter} onChange={(e) => setAccFilter(e.target.value ? Number(e.target.value) : '')}
              options={[{ value: '', label: L.all }, ...accOptions.map(([value, label]) => ({ value, label }))]} />}
          </Field>
          <Field label={L.search}>
            {(fid) => <Input id={fid} type="search" value={search} placeholder={L.searchPlaceholder} onChange={(e) => setSearch(e.target.value)} />}
          </Field>
          <div className="toolbar-right">
            {dirty > 0 && <span className="dirty" role="status">{fmt(L.unsaved, { n: dirty })}</span>}
            {savedFlag && !dirty && <span className="ok-text" role="status"><Icon name="check" /> {L.saved}</span>}
            {dirty > 0 && <Button variant="ghost" onClick={() => setDrafts({})}>{L.discard}</Button>}
            {selectedLines.length > 0 && (
              <span className="small muted" role="status">{fmt(T.selectedN, { n: selectedLines.length })}{' '}
                <button type="button" className="link-btn small" style={{ display: 'inline' }} onClick={() => setSelection(new Set())}>{T.clearSel}</button></span>
            )}
            {anyEditable && (
              <Button onClick={() => setFilling(true)} disabled={dirty > 0 || editableVisible.length === 0}
                title={dirty > 0 ? T.fillDirty : editableVisible.length === 0 ? T.fillNoEdit : undefined}><Icon name="wand" /> {T.fill}</Button>
            )}
            {anyEditable && <Button onClick={() => setAdding(true)} disabled={dirty > 0} title={dirty > 0 ? fmt(L.unsaved, { n: dirty }) : undefined}><Icon name="plus" /> {L.addLine}</Button>}
            {anyEditable && <Button variant="primary" busy={saving} disabled={!dirty} onClick={save}><Icon name="check" /> {L.save}</Button>}
          </div>
        </div>
        <RefToggles cols={refCols} setCols={setRefCols} refs={refs} T={T} />
        {anyEditable && <p className="small muted lines-hint">{L.linesHint}</p>}
        {saveError ? <div className="card-body"><DetailedError error={saveError} /></div> : null}
        {loading && !lines ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : visible.length === 0 ? <Empty>{L.emptyLines}</Empty> : (
          <div className="table-scroll grid-scroll">
            <table className="table grid-table budget-grid">
              <thead><tr>
                <th className="sticky-col">
                  {editableVisible.length > 0 && (
                    <input type="checkbox" className="line-check" aria-label={T.selectAll} checked={allSelected}
                      onChange={() => setSelection(allSelected ? new Set() : new Set(editableVisible.map((l) => l.id)))} />
                  )}
                  {L.costCenter}
                </th>
                <th>{L.account}</th>
                <th>{L.class}</th>
                {months.map((m) => <th key={m} className="r">{m}</th>)}
                <th className="r">{L.rowTotal}</th>
                {refHdrs.map((h, i) => <th key={h.key} className={`r pc-ref${i === 0 ? ' pc-ref-first' : ''}`}>{h.label}</th>)}
                <th><span className="sr-only">{t('common.actions')}</span></th>
              </tr></thead>
              <tbody>
                {visible.map((l) => {
                  const ms = monthsOf(l);
                  const canEdit = editable && l.canEdit;
                  return (
                    <tr key={l.id} className={drafts[l.id] ? 'is-dirty' : ''}>
                      <td className="sticky-col">
                        {canEdit && (
                          <input type="checkbox" className="line-check" checked={selection.has(l.id)} onChange={() => toggleSel(l.id)}
                            aria-label={fmt(T.selectLine, { line: `${l.costCenterCode} / ${l.accountCode}` })} />
                        )}
                        <b>{l.costCenterCode}</b> <span className="small">{l.costCenterName}</span>
                        <div className="muted small">{l.sectionName}</div>
                      </td>
                      <td>
                        <span className="acc-code">{l.accountCode}</span> {l.accountName}
                        {l.description && l.description !== l.accountName && <div className="muted small">{l.description}</div>}
                      </td>
                      <td>{l.expenseClass ? <Badge tone={l.expenseClass === 'CAPEX' ? 'info' : 'neutral'}>{l.expenseClass}</Badge> : <span className="muted">—</span>}</td>
                      {ms.map((val, i) => (
                        <td key={i} className={`r num cell${drafts[l.id] && val !== l.months[i] ? ' cell-changed' : ''}`}>
                          {canEdit
                            ? <AmountInput value={val} onChange={(n) => setMonth(l, i, n ?? 0)} label={`${l.costCenterCode} ${l.accountCode} ${months[i]}`} />
                            : money(val, locale)}
                        </td>
                      ))}
                      <td className="r num"><b>{money(sum(ms), locale)}</b></td>
                      {anyRef && <RefCells cols={refCols} refs={refs} rows={[refs.byKey.get(lineKey(l))]} months={ms} label={`${l.costCenterCode} / ${l.accountCode}`} T={T} />}
                      <td className="r">
                        {canEdit && (
                          <button type="button" className="icon-btn" title={L.deleteLine} aria-label={`${L.deleteLine}: ${l.costCenterCode} / ${l.accountCode}`}
                            onClick={() => setDeleting(l)}><Icon name="trash" /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {capex.n > 0 && opex.n > 0 && (
                  <>
                    <tr className="sub-total">
                      <td className="sticky-col">OPEX</td><td colSpan={2} className="muted small">{opex.n}</td>
                      {opex.months.map((x, i) => <td key={i} className="r num">{money(x, locale)}</td>)}
                      <td className="r num">{money(sum(opex.months), locale)}</td>{refHdrs.map((h) => <td key={h.key} className="pc-ref" />)}<td />
                    </tr>
                    <tr className="sub-total">
                      <td className="sticky-col">CAPEX</td><td colSpan={2} className="muted small">{capex.n}</td>
                      {capex.months.map((x, i) => <td key={i} className="r num">{money(x, locale)}</td>)}
                      <td className="r num">{money(sum(capex.months), locale)}</td>{refHdrs.map((h) => <td key={h.key} className="pc-ref" />)}<td />
                    </tr>
                  </>
                )}
                <tr>
                  <td className="sticky-col"><b>{L.totalRow}</b></td><td colSpan={2} className="muted small">{visible.length}</td>
                  {monthTotals.map((x, i) => <td key={i} className="r num"><b>{money(x, locale)}</b></td>)}
                  <td className="r num"><b>{money(sum(monthTotals), locale)}</b></td>
                  {anyRef && <RefCells cols={refCols} refs={refs} rows={visibleRefRows} months={monthTotals} label={L.totalRow} T={T} />}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {filling && (
        <FillFromLastYearModal detail={detail} selected={selectedLines} visible={editableVisible} refs={refs} T={T}
          onClose={() => setFilling(false)}
          onSaved={(updated) => { setLines(updated); setSelection(new Set()); setSavedFlag(true); onChanged(); }} />
      )}
      {adding && (
        <AddLineModal detail={detail} lines={all} defaultSection={sectionFilter} defaultCc={ccFilter} L={L}
          onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); await reloadLines(); onChanged(); }} />
      )}
      {deleting && (
        <ConfirmModal danger L={L} title={L.deleteLine} confirmLabel={t('common.delete')}
          text={fmt(L.deleteConfirm, { cc: deleting.costCenterCode, acc: deleting.accountCode })}
          onConfirm={async () => {
            await api('DELETE', `/budgets/${detail.id}/lines/${deleting.id}`);
            setDrafts((d) => { const n = { ...d }; delete n[deleting.id]; return n; });
            await reloadLines();
            onChanged();
          }}
          onClose={() => setDeleting(null)} />
      )}
    </>
  );
}

function AddLineModal({ detail, lines, defaultSection, defaultCc, L, onClose, onAdded }: {
  detail: BudgetDetailDto; lines: BudgetLineDto[]; defaultSection: number | ''; defaultCc: number | ''; L: Texts; onClose: () => void; onAdded: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const display = useDisplayName();
  const md = useMasterData();
  const editableSections = new Set(detail.sections.filter((s) => s.canEdit).map((s) => s.orgUnitId));
  const ccs = (md.data?.costCenters ?? [])
    .filter((c) => c.isActive && editableSections.has(c.sectionUnitId) && (!defaultSection || c.sectionUnitId === defaultSection))
    .sort((a, b) => a.code.localeCompare(b.code));
  const [cc, setCc] = useState<string>(defaultCc ? String(defaultCc) : '');
  const ccValue = cc && ccs.some((c) => String(c.id) === cc) ? cc : ccs[0] ? String(ccs[0].id) : '';
  const ccDto = ccs.find((c) => String(c.id) === ccValue);
  const usedAccounts = new Set(lines.filter((l) => String(l.costCenterId) === ccValue).map((l) => l.accountId));
  const usable = ccDto ? usableAccounts(md.data?.accounts ?? [], ccDto, 'budget') : [];
  const available = usable.filter((a) => !usedAccounts.has(a.id)).sort((a, b) => a.code.localeCompare(b.code));
  const hidden = usable.length - available.length;
  const [account, setAccount] = useState('');
  const accValue = account && available.some((a) => String(a.id) === account) ? account : available[0] ? String(available[0].id) : '';
  const [description, setDescription] = useState('');
  const [annual, setAnnual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const total = parseAmount(annual);

  const submit = async () => {
    if (total === null) return;
    setBusy(true); setError(null);
    const each = Math.floor((total / 12) * 100) / 100;
    const months = Array.from({ length: 12 }, (_, i) => (i === 11 ? Math.round((total - each * 11) * 100) / 100 : each));
    try {
      await api('POST', `/budgets/${detail.id}/lines`, { costCenterId: Number(ccValue), accountId: Number(accValue), description: description.trim(), months });
      await onAdded();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal title={L.newLine} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{L.cancel}</Button>
      <Button variant="primary" busy={busy} disabled={!ccValue || !accValue || total === null || total < 0} onClick={submit}><Icon name="plus" /> {t('common.add')}</Button>
    </>}>
      {md.loading && !md.data ? <Spinner /> : md.error ? <ErrorMessage error={md.error} /> : ccs.length === 0 ? <Alert kind="warning">{L.noCostCenters}</Alert> : (
        <>
          <Field label={L.newLineCc}>
            {(id) => <Select id={id} value={ccValue} onChange={(e) => { setCc(e.target.value); setAccount(''); }}
              options={ccs.map((c) => ({ value: c.id, label: `${c.code} · ${c.name} (${c.sectionName})` }))} />}
          </Field>
          <Field label={L.newLineAccount} hint={L.newLineAccountHint}>
            {(id) => available.length === 0
              ? <Alert kind="warning">{L.noAccounts}</Alert>
              : <Select id={id} value={accValue} onChange={(e) => setAccount(e.target.value)}
                options={available.map((a) => ({ value: a.id, label: `${a.code} · ${display(a)}${a.expenseClass ? ` (${a.expenseClass})` : a.accountType === 'CAPEX' ? ' (CAPEX)' : ''}` }))} />}
          </Field>
          {hidden > 0 && <p className="small muted mb-8">{fmt(L.duplicatesHidden, { n: hidden })}</p>}
          <Field label={L.description}>{(id) => <Input id={id} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <Field label={`${L.annual} (${detail.currency})`} hint={total !== null && total > 0 ? `${L.annualHint} ≈ ${money(total / 12, locale, 2)} / ${t('common.month').toLocaleLowerCase(locale)}` : L.annualHint}
            error={total === null || total < 0 ? L.invalidAmount : undefined}>
            {(id) => <Input id={id} inputMode="decimal" value={annual} placeholder="0" onChange={(e) => setAnnual(e.target.value)} />}
          </Field>
        </>
      )}
      <DetailedError error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ compare */

function CompareTab({ detail, L }: { detail: BudgetDetailDto; L: Texts }) {
  const { t, lang, locale } = useI18n();
  const versions = [...detail.versions].sort((a, b) => a.versionNo - b.versionNo);
  const sel = detail.version;
  const defaultA = sel.basedOnVersionId ?? versions.filter((x) => x.versionNo < sel.versionNo).pop()?.id ?? versions[0]?.id;
  const defaultB = defaultA === sel.id ? versions.find((x) => x.id !== sel.id)?.id ?? sel.id : sel.id;
  const [a, setA] = useState<number>(defaultA ?? sel.id);
  const [b, setB] = useState<number>(defaultB);
  const [group, setGroup] = useState<'month' | 'line'>('line');
  const valid = versions.length >= 2 && a !== b;
  const { data, error, loading } = useAsync(
    () => (valid ? api<VersionDiffRow[]>('GET', `/budgets/${detail.id}/compare${qs({ a, b })}`) : Promise.resolve([] as VersionDiffRow[])),
    [detail.id, a, b, valid],
  );
  const vLabel = (x: BudgetVersionDto) => `v${x.versionNo} · ${x.name} · ${t(`versionStatus.${x.status}`)}`;
  const va = versions.find((x) => x.id === a);
  const vb = versions.find((x) => x.id === b);

  const rows = useMemo(() => {
    const d = data ?? [];
    if (group === 'month') return d.map((r) => ({ key: `${r.costCenterCode}:${r.accountCode}:${r.month}`, ...r, months: [r.month] }));
    const m = new Map<string, VersionDiffRow & { key: string; months: number[] }>();
    for (const r of d) {
      const k = `${r.costCenterCode}:${r.accountCode}`;
      const cur = m.get(k);
      if (cur) { cur.before += r.before; cur.after += r.after; cur.difference += r.difference; cur.months.push(r.month); }
      else m.set(k, { ...r, key: k, months: [r.month] });
    }
    return [...m.values()];
  }, [data, group]);
  const inc = sum((data ?? []).filter((r) => r.difference > 0).map((r) => r.difference));
  const dec = sum((data ?? []).filter((r) => r.difference < 0).map((r) => r.difference));
  const months = MONTH_SHORT[lang];

  if (versions.length < 2) return <Card><Empty>{L.compareNeedTwo}</Empty></Card>;
  return (
    <>
      <Card>
        <div className="filters">
          <Field label={L.compareA}>{(id) => <Select id={id} value={a} onChange={(e) => setA(Number(e.target.value))} options={versions.map((x) => ({ value: x.id, label: vLabel(x) }))} />}</Field>
          <Field label={L.compareB}>{(id) => <Select id={id} value={b} onChange={(e) => setB(Number(e.target.value))} options={versions.map((x) => ({ value: x.id, label: vLabel(x) }))} />}</Field>
          <Field label={L.groupBy}>{(id) => <Select id={id} value={group} onChange={(e) => setGroup(e.target.value as 'month' | 'line')}
            options={[{ value: 'line', label: L.groupLine }, { value: 'month', label: L.groupMonth }]} />}</Field>
        </div>
        {a === b && <Alert kind="warning">{L.compareSame}</Alert>}
        {va && vb && valid && (
          <dl className="facts compare-facts">
            <div><dt>A · v{va.versionNo}</dt><dd className="num">{money(va.total, locale)} {detail.currency}</dd></div>
            <div><dt>B · v{vb.versionNo}</dt><dd className="num">{money(vb.total, locale)} {detail.currency}</dd></div>
            <div><dt>{L.increases} / {L.decreases}</dt><dd><Delta value={inc} /> · <Delta value={dec} /></dd></div>
            <div><dt>{L.net} · {L.changedCells}: {data?.length ?? 0}</dt><dd><Delta value={inc + dec} strong /></dd></div>
          </dl>
        )}
      </Card>
      {valid && (
        <Card flush>
          {loading && !data ? <Spinner /> : error ? <div className="card-body"><ErrorMessage error={error} /></div> : rows.length === 0 ? <Empty>{L.compareNone}</Empty> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr>
                  <th>{L.costCenter}</th><th>{L.account}</th><th>{L.month}</th>
                  <th className="r">{L.before} (v{va?.versionNo})</th><th className="r">{L.after} (v{vb?.versionNo})</th><th className="r">{L.difference}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td><b>{r.costCenterCode}</b> <span className="small">{r.costCenterName}</span></td>
                      <td><span className="acc-code">{r.accountCode}</span> {r.accountName}</td>
                      <td className="small">{r.months.map((m) => months[m - 1]).join(', ')}</td>
                      <td className="r num">{money(r.before, locale)}</td>
                      <td className="r num">{money(r.after, locale)}</td>
                      <td className="r num"><Delta value={r.difference} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3}><b>{L.totalRow}</b></td>
                  <td className="r num"><b>{money(sum(rows.map((r) => r.before)), locale)}</b></td>
                  <td className="r num"><b>{money(sum(rows.map((r) => r.after)), locale)}</b></td>
                  <td className="r num"><Delta value={sum(rows.map((r) => r.difference))} strong /></td>
                </tr></tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ history */

function HistoryTab({ budgetId, reloadKey, lines, L }: { budgetId: number; reloadKey: number; lines: BudgetLineDto[]; L: Texts }) {
  const { lang, locale } = useI18n();
  const { can } = useAuth();
  const { data, error, loading } = useAsync(() => api<AuditLogDto[]>('GET', `/budgets/${budgetId}/history`), [budgetId, reloadKey]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const months = MONTH_SHORT[lang];
  const fmtVal = (x: unknown): string => (typeof x === 'number' ? money(x, locale, x % 1 ? 2 : 0) : x === null || x === undefined ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const keyLabel = (k: string) => (/^m\d{1,2}$/.test(k) ? months[Number(k.slice(1)) - 1] : k);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!data?.length) return <Card><Empty>{!can('audit.view') && !can('budget.manage') ? L.historyNoAccess : L.historyEmpty}</Empty></Card>;
  return (
    <Card>
      <ol className="timeline">
        {data.map((e) => {
          const line = e.entityType === 'BUDGET_LINE' && e.entityId ? lineById.get(e.entityId) : undefined;
          const changes = e.changes ?? {};
          const diffs = Object.entries(changes).filter(([, val]) => Array.isArray(val) && val.length === 2) as [string, [unknown, unknown]][];
          const others = Object.entries(changes).filter(([, val]) => !(Array.isArray(val) && val.length === 2) && val !== null && typeof val !== 'object');
          return (
            <li key={e.id} className={e.action === 'DELETED' ? 'tl-reject' : e.action === 'LOCKED' || e.action === 'APPROVED' ? 'tl-approve' : ''}>
              <div className="tl-head">
                <b>{L.action[e.action] ?? e.action}</b>
                <Badge tone="neutral">{L.entity[e.entityType] ?? e.entityType}{line ? ` · ${line.costCenterCode} / ${line.accountCode}` : e.entityId ? ` #${e.entityId}` : ''}</Badge>
                <span className="muted small">{e.userName ?? L.system} · {date(e.createdAt, locale, true)}</span>
              </div>
              {(diffs.length > 0 || others.length > 0) && (
                <div className="tl-changes small">
                  {diffs.map(([k, [from, to]]) => <span key={k} className="chg"><b>{keyLabel(k)}</b>: {fmtVal(from)} → {fmtVal(to)}</span>)}
                  {others.slice(0, 8).map(([k, val]) => <span key={k} className="chg"><b>{keyLabel(k)}</b>: {fmtVal(val)}</span>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
