import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CostCenterDto, JobFamilyDto, OrgUnitDto, OrgUnitTypeDto, PositionDto, UserDto } from '@finbridge/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { CrudPage } from '../../components/CrudPage';
import { Alert, Badge, Button, Card, Empty, ErrorMessage, ExportButton, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui';
import { BulkImportButton } from '../../components/BulkImportDialog';
import { OrgChart } from '../../components/OrgChart';
import { fmt, useI18n, useLocal } from '../../i18n';
import { useDisplayName, useMasterData } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import '../../styles/admin-org.css';

const az = {
  title: 'Təşkilati struktur',
  subtitle: 'Şirkətin iyerarxiyası, vahid növləri, peşə ailələri və vəzifələr. Struktur büdcə bölmələrini və təsdiq marşrutlarını müəyyən edir.',
  tabTree: 'İyerarxiya', tabChart: 'Ağac görünüşü', tabTypes: 'Vahid növləri', tabJobs: 'Peşə ailələri', tabPositions: 'Vəzifələr',
  unit: 'Struktur vahidi', type: 'Növ', head: 'Rəhbər', ccs: 'Xərc m.', children: 'Alt vahid', noHead: '— Təyin edilməyib —',
  showInactive: 'Deaktivləri göstər', expandAll: 'Hamısını aç', collapseAll: 'Hamısını bağla', addChild: 'Alt vahid əlavə et', addUnit: 'Yeni vahid',
  move: 'Köçür', setHead: 'Rəhbəri təyin et', root: 'Kök vahid', budgetSection: 'Büdcə bölməsi',
  selectUnit: 'Ətraflı məlumat üçün vahidi seçin.', unitCcs: 'Vahidin xərc mərkəzləri', noCcs: 'Bu vahiddə xərc mərkəzi yoxdur.', allCcs: 'Bütün xərc mərkəzləri',
  noChildrenType: 'Bu növ vahidin alt vahidi ola bilməz.', rootLocked: 'Kök vahid köçürülə və deaktiv edilə bilməz.',
  createTitle: 'Yeni struktur vahidi', editTitle: 'Vahidi redaktə et', moveTitle: '{name} vahidini köçür', headTitle: '{name} — rəhbər',
  parent: 'Yuxarı vahid', newParent: 'Yeni yuxarı vahid', noTypes: 'Bu yuxarı vahidin altında icazəli vahid növü yoxdur. “Vahid növləri” bölməsində icazələri yoxlayın.',
  moveHint: 'Yalnız bu növ üçün icazəli və öz alt vahidləri olmayan vahidlər göstərilir. Xərc mərkəzləri vahidlə birlikdə köçür.',
  noTargets: 'Uyğun yuxarı vahid yoxdur.', newPath: 'Yeni yol', sortOrder: 'Sıra',
  confirmDeactivate: '{name} deaktiv edilsin? Əvvəlcə onun aktiv xərc mərkəzləri deaktiv edilməli və ya köçürülməlidir.',
  readOnly: 'Baxış rejimi: strukturu yalnız maliyyə meneceri və ya administrator dəyişə bilər.',
  // types
  newType: 'Yeni vahid növü', editType: 'Vahid növünü redaktə et', allowedParents: 'İcazəli yuxarı növlər', anyParent: 'İstənilən',
  allowedHint: 'Heç biri seçilməyibsə, bu növ istənilən vahidin altında yarana bilər.',
  canHaveChildren: 'Alt vahidləri ola bilər', requiresCostCenter: 'Xərc mərkəzi tələb olunur', inBudgeting: 'Büdcə bölməsidir', inWorkflow: 'Təsdiq marşrutunda iştirak edir',
  units: 'Vahid', codeFixed: 'Kod yaradıldıqdan sonra dəyişdirilmir.', flags: 'Xüsusiyyətlər',
  budgetingHint: 'Büdcə bölməsi olan vahidlər büdcəni ayrıca hazırlayır və təsdiqə göndərir.',
  // job families / positions
  jobFamily: 'Peşə ailəsi', newJob: 'Yeni peşə ailəsi', jobsHint: 'Peşə ailəsinin sahibi “Peşə ailəsinin sahibi” mərhələsində təsdiqləyən şəxsdir.',
  position: 'Vəzifə', newPosition: 'Yeni vəzifə', holder: 'Vəzifə sahibi', positionTitle: 'Vəzifənin adı', positionsHint: 'Vəzifə sahibi “Vəzifə sahibi” mərhələsində təsdiqləyir.',
  noUnit: '— Vahidsiz —',
};
const TEXT = {
  az,
  en: {
    title: 'Organisation structure',
    subtitle: 'Company hierarchy, unit types, job families and positions. The structure defines budget sections and approval routing.',
    tabTree: 'Hierarchy', tabChart: 'Org chart', tabTypes: 'Unit types', tabJobs: 'Job families', tabPositions: 'Positions',
    unit: 'Org unit', type: 'Type', head: 'Head', ccs: 'CCs', children: 'Sub-units', noHead: '— Not assigned —',
    showInactive: 'Show inactive', expandAll: 'Expand all', collapseAll: 'Collapse all', addChild: 'Add sub-unit', addUnit: 'New unit',
    move: 'Move', setHead: 'Set head', root: 'Root unit', budgetSection: 'Budget section',
    selectUnit: 'Select a unit to see its details.', unitCcs: 'Cost centers of the unit', noCcs: 'This unit has no cost centers.', allCcs: 'All cost centers',
    noChildrenType: 'Units of this type cannot have sub-units.', rootLocked: 'The root unit cannot be moved or deactivated.',
    createTitle: 'New org unit', editTitle: 'Edit unit', moveTitle: 'Move {name}', headTitle: '{name} — head',
    parent: 'Parent unit', newParent: 'New parent unit', noTypes: 'No unit type is allowed under this parent. Check the permissions in “Unit types”.',
    moveHint: 'Only units allowed for this type and outside its own subtree are listed. Cost centers move with the unit.',
    noTargets: 'No valid parent unit.', newPath: 'New path', sortOrder: 'Sort order',
    confirmDeactivate: 'Deactivate {name}? Its active cost centers must be deactivated or moved first.',
    readOnly: 'Read-only: only a finance manager or administrator can change the structure.',
    newType: 'New unit type', editType: 'Edit unit type', allowedParents: 'Allowed parent types', anyParent: 'Any',
    allowedHint: 'If none are selected, this type may be created under any unit.',
    canHaveChildren: 'Can have sub-units', requiresCostCenter: 'Requires a cost center', inBudgeting: 'Is a budget section', inWorkflow: 'Takes part in approval routing',
    units: 'Units', codeFixed: 'The code cannot change after creation.', flags: 'Properties',
    budgetingHint: 'Units that are budget sections prepare and submit their budget separately.',
    jobFamily: 'Job family', newJob: 'New job family', jobsHint: 'The job family owner approves “Job family owner” workflow steps.',
    position: 'Position', newPosition: 'New position', holder: 'Holder', positionTitle: 'Position title', positionsHint: 'The holder approves “Position holder” workflow steps.',
    noUnit: '— No unit —',
  } satisfies typeof az,
};

type Tab = 'tree' | 'chart' | 'types' | 'jobs' | 'positions';
const nbsp = (depth: number) => '   '.repeat(depth);

export function OrgStructurePage() {
  const L = useLocal(TEXT);
  const { can } = useAuth();
  const canManage = can('org.manage');
  const [tab, setTab] = useState<Tab>('tree');
  const md = useMasterData({ users: true });
  const types = useAsync(() => api<OrgUnitTypeDto[]>('GET', '/org/types'), []);
  const [dataVersion, setDataVersion] = useState(0);
  const [listUnit, setListUnit] = useState<number | null>(null);

  return (
    <>
      <PageHeader title={L.title} subtitle={L.subtitle} actions={<>
        {can('excel.export') && <ExportButton path="/export/org-units" filename="org-structure.xlsx" />}
        {canManage && <BulkImportButton key={tab} kind={tab === 'jobs' ? 'JOB_FAMILIES' : tab === 'positions' ? 'POSITIONS' : 'ORG_UNITS'}
          onDone={() => { setDataVersion((v) => v + 1); void md.reload(); void types.reload(); }} />}
      </>} />
      {!canManage && <p className="hint mb-8">{L.readOnly}</p>}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'tree', label: L.tabTree }, { value: 'chart', label: L.tabChart }, { value: 'types', label: L.tabTypes }, { value: 'jobs', label: L.tabJobs }, { value: 'positions', label: L.tabPositions },
      ]} />
      {(md.loading && !md.data) || (types.loading && !types.data) ? <Spinner /> : md.error || types.error ? <ErrorMessage error={md.error ?? types.error} /> : md.data && types.data && (
        <>
          {tab === 'tree' && <Hierarchy key={listUnit ?? 0} initialSelectedId={listUnit} units={md.data.units} costCenters={md.data.costCenters} users={md.data.users} types={types.data} canManage={canManage} reload={md.reload} />}
          {tab === 'chart' && <ChartView units={md.data.units} costCenters={md.data.costCenters} users={md.data.users} types={types.data} canManage={canManage} reload={md.reload}
            onOpenInList={(id) => { setListUnit(id); setTab('tree'); }} />}
          {tab === 'types' && <UnitTypes types={types.data} canManage={canManage} reload={async () => { await types.reload(); await md.reload(); }} />}
          {tab === 'jobs' && <JobFamilies key={dataVersion} users={md.data.users} canManage={canManage} />}
          {tab === 'positions' && <Positions key={dataVersion} users={md.data.users} units={md.data.units} canManage={canManage} />}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ hierarchy */

type Dialog =
  | { kind: 'create'; parentId: number }
  | { kind: 'edit'; unit: OrgUnitDto }
  | { kind: 'move'; unit: OrgUnitDto }
  | { kind: 'head'; unit: OrgUnitDto };

function Hierarchy({ units, costCenters, users, types, canManage, reload, initialSelectedId = null }: {
  units: OrgUnitDto[]; costCenters: CostCenterDto[]; users: UserDto[]; types: OrgUnitTypeDto[]; canManage: boolean; reload: () => Promise<void>; initialSelectedId?: number | null;
}) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);

  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const typeById = useMemo(() => new Map(types.map((x) => [x.id, x])), [types]);
  const children = useMemo(() => {
    const m = new Map<number | null, OrgUnitDto[]>();
    for (const u of units) {
      const k = u.parentId && byId.has(u.parentId) ? u.parentId : null;
      m.set(k, [...(m.get(k) ?? []), u]);
    }
    for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    return m;
  }, [units, byId]);
  const root = children.get(null)?.[0] ?? null;
  const selected = (selectedId && byId.get(selectedId)) || root;

  // depth-first flatten with depth; filtering keeps matches and their ancestors
  const flat = useMemo(() => {
    const out: { u: OrgUnitDto; depth: number }[] = [];
    const walk = (p: number | null, depth: number) => { for (const u of children.get(p) ?? []) { out.push({ u, depth }); walk(u.id, depth + 1); } };
    walk(null, 0);
    return out;
  }, [children]);
  const q = query.trim().toLocaleLowerCase();
  const filtering = !!q || !showInactive;
  const visible = useMemo(() => {
    const match = (u: OrgUnitDto) => (!q || `${u.code} ${u.name} ${u.nameEn ?? ''} ${u.headName ?? ''}`.toLocaleLowerCase().includes(q)) && (showInactive || u.isActive);
    if (filtering) {
      const keep = new Set<number>();
      for (const { u } of flat) if (match(u)) { let cur: OrgUnitDto | undefined = u; while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; } }
      return flat.filter(({ u }) => keep.has(u.id)).map((r) => ({ ...r, hit: match(r.u) }));
    }
    const hidden = (u: OrgUnitDto) => { let p = u.parentId; while (p) { if (collapsed.has(p)) return true; p = byId.get(p)?.parentId ?? null; } return false; };
    return flat.filter(({ u }) => !hidden(u)).map((r) => ({ ...r, hit: true }));
  }, [flat, q, showInactive, filtering, collapsed, byId]);

  const toggleActive = async (u: OrgUnitDto) => {
    if (u.isActive && !window.confirm(fmt(L.confirmDeactivate, { name: dn(u) }))) return;
    setRowError(null);
    try { await api('PATCH', `/org/units/${u.id}`, { isActive: !u.isActive }); await reload(); } catch (e) { setRowError(e); }
  };

  const parentIds = new Set(units.map((u) => u.parentId).filter((x): x is number => x !== null));

  return (
    <div className="org-layout">
      <Card flush>
        <div className="table-toolbar">
          <Input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {L.showInactive}</label>
          {!filtering && <>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>{L.expandAll}</Button>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set([...parentIds].filter((id) => id !== root?.id)))}>{L.collapseAll}</Button>
          </>}
          <span className="toolbar-right muted small">{units.length}</span>
        </div>
        <ErrorMessage error={rowError} />
        {visible.length === 0 ? <Empty>{t('common.noData')}</Empty> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>{L.unit}</th><th>{L.type}</th><th>{L.head}</th><th className="r">{L.ccs}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {visible.map(({ u, depth, hit }) => {
                  const hasKids = (children.get(u.id)?.length ?? 0) > 0;
                  const open = !collapsed.has(u.id);
                  const ty = typeById.get(u.typeId);
                  return (
                    <tr key={u.id} className={`tree-row clickable${u.isActive ? '' : ' is-inactive'}${selected?.id === u.id ? ' is-selected' : ''}`}
                      style={hit ? undefined : { opacity: 0.6 }} onClick={() => setSelectedId(u.id)} aria-selected={selected?.id === u.id}>
                      <td>
                        <div className="tree-name" style={{ paddingLeft: depth * 18 }}>
                          {hasKids && !filtering ? (
                            <button type="button" className={`tree-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-label={`${dn(u)}: ${open ? L.collapseAll : L.expandAll}`}
                              onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; }); }}>
                              <Icon name="chevron" size={14} />
                            </button>
                          ) : <span className="tree-spacer" />}
                          <span className="acc-code">{u.code}</span>
                          <button type="button" className="tree-label" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: depth < 2 ? 700 : 500 }}
                            onClick={(e) => { e.stopPropagation(); setSelectedId(u.id); }}>{dn(u)}</button>
                        </div>
                      </td>
                      <td>
                        <Badge tone={u.parentId === null ? 'dark' : 'neutral'}>{ty ? dn(ty) : u.typeName}</Badge>
                        {ty?.inBudgeting && <span className="ml-4"><Badge tone="info">{L.budgetSection}</Badge></span>}
                      </td>
                      <td>{u.headName ?? <span className="muted">—</span>}</td>
                      <td className="r num">{u.costCenterCount || <span className="muted">0</span>}</td>
                      <td>{u.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="org-panel">
        {!selected ? <Card><Empty>{L.selectUnit}</Empty></Card> : (
          <UnitPanel unit={selected} type={typeById.get(selected.typeId)} costCenters={costCenters.filter((c) => c.orgUnitId === selected.id)}
            canManage={canManage} onAction={setDialog} onToggle={() => toggleActive(selected)} />
        )}
      </div>

      {dialog && (dialog.kind === 'create' || dialog.kind === 'edit') && (
        <UnitModal dialog={dialog} units={units} types={types} users={users} onClose={() => setDialog(null)}
          onSaved={async (id) => { setDialog(null); await reload(); if (id) { setSelectedId(id); const p = byId.get(id)?.parentId; if (p) setCollapsed((s) => { const n = new Set(s); n.delete(p); return n; }); } }} />
      )}
      {dialog?.kind === 'move' && (
        <MoveModal unit={dialog.unit} units={units} types={types} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload(); }} />
      )}
      {dialog?.kind === 'head' && (
        <HeadModal unit={dialog.unit} users={users} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload(); }} />
      )}
    </div>
  );
}

/** Org chart tab: the visual tree plus the same create / edit / move / head dialogs as the hierarchy tab. */
function ChartView({ units, costCenters, users, types, canManage, reload, onOpenInList }: {
  units: OrgUnitDto[]; costCenters: CostCenterDto[]; users: UserDto[]; types: OrgUnitTypeDto[]; canManage: boolean; reload: () => Promise<void>; onOpenInList: (id: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return (
    <>
      <OrgChart units={units} costCenters={costCenters} types={types} canManage={canManage} selectedId={selectedId} onSelect={setSelectedId}
        onAction={setDialog} onOpenInList={onOpenInList} />
      {dialog && (dialog.kind === 'create' || dialog.kind === 'edit') && (
        <UnitModal dialog={dialog} units={units} types={types} users={users} onClose={() => setDialog(null)}
          onSaved={async (id) => { setDialog(null); await reload(); if (id) setSelectedId(id); }} />
      )}
      {dialog?.kind === 'move' && (
        <MoveModal unit={dialog.unit} units={units} types={types} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload(); }} />
      )}
      {dialog?.kind === 'head' && (
        <HeadModal unit={dialog.unit} users={users} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload(); }} />
      )}
    </>
  );
}

function UnitPanel({ unit, type, costCenters, canManage, onAction, onToggle }: {
  unit: OrgUnitDto; type: OrgUnitTypeDto | undefined; costCenters: CostCenterDto[]; canManage: boolean; onAction: (d: Dialog) => void; onToggle: () => void;
}) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const isRoot = unit.parentId === null;
  const canChildren = type?.canHaveChildren !== false;
  return (
    <Card title={<>{dn(unit)} {!unit.isActive && <Badge tone="muted">{t('common.inactive')}</Badge>}</>} subtitle={<><span className="acc-code">{unit.code}</span> {type ? dn(type) : unit.typeName}</>}>
      {unit.path.length > 1 && <div className="org-path" aria-label={L.parent}>{unit.path.slice(0, -1).map((p, i) => <span key={i}>{p}</span>)}</div>}
      {canManage && (
        <div className="org-panel-actions">
          <Button size="sm" variant="primary" disabled={!canChildren} title={canChildren ? undefined : L.noChildrenType} onClick={() => onAction({ kind: 'create', parentId: unit.id })}><Icon name="plus" /> {L.addChild}</Button>
          <Button size="sm" onClick={() => onAction({ kind: 'edit', unit })}>{t('common.edit')}</Button>
          <Button size="sm" onClick={() => onAction({ kind: 'head', unit })}>{L.setHead}</Button>
          <Button size="sm" disabled={isRoot} title={isRoot ? L.rootLocked : undefined} onClick={() => onAction({ kind: 'move', unit })}>{L.move}</Button>
          <Button size="sm" variant={unit.isActive ? 'danger' : 'success'} disabled={isRoot} title={isRoot ? L.rootLocked : undefined} onClick={onToggle}>
            {unit.isActive ? t('common.deactivate') : t('common.activate')}
          </Button>
        </div>
      )}
      {canManage && !canChildren && <p className="hint mb-8">{L.noChildrenType}</p>}
      <dl className="facts">
        <div><dt>{L.head}</dt><dd>{unit.headName ?? '—'}</dd></div>
        <div><dt>{L.type}</dt><dd>{type ? dn(type) : unit.typeName}{type?.inBudgeting ? ` · ${L.budgetSection}` : ''}</dd></div>
        <div><dt>{L.children}</dt><dd className="num">{unit.childCount}</dd></div>
        <div><dt>{L.ccs}</dt><dd className="num">{unit.costCenterCount}</dd></div>
      </dl>
      {unit.nameEn && <p className="small muted mb-8">{t('common.nameEn')}: {unit.nameEn}</p>}
      {unit.description && <p className="small mb-8">{unit.description}</p>}
      <h3 className="h3">{L.unitCcs}</h3>
      {costCenters.length === 0 ? <p className="muted small">{L.noCcs}</p> : (
        <ul className="mini-list">
          {costCenters.map((c) => (
            <li key={c.id} className={c.isActive ? '' : 'muted'}>
              <span><span className="acc-code">{c.code}</span>{c.name}</span>
              <span className="muted">{c.ownerName ?? '—'}{!c.isActive && ` · ${t('common.inactive')}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small" style={{ marginTop: 10 }}><Link to="/admin/cost-centers">{L.allCcs} →</Link></p>
    </Card>
  );
}

/** Unit types that may be created under `parent` (active, not the root type, parent rules satisfied). */
function typesUnder(types: OrgUnitTypeDto[], parent: OrgUnitDto | undefined): OrgUnitTypeDto[] {
  if (!parent) return [];
  const pt = types.find((x) => x.id === parent.typeId);
  if (pt && !pt.canHaveChildren) return [];
  return types.filter((x) => x.isActive && x.code !== 'COMPANY' && (x.allowedParentTypeIds.length === 0 || x.allowedParentTypeIds.includes(parent.typeId)));
}

function subtreeOf(units: OrgUnitDto[], id: number): Set<number> {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const u of units) if (u.parentId && out.has(u.parentId) && !out.has(u.id)) { out.add(u.id); grew = true; } }
  return out;
}

/** Indented option list of units in tree order. */
function unitTreeOptions(units: OrgUnitDto[], label: (u: OrgUnitDto) => string, filter: (u: OrgUnitDto) => boolean) {
  const byParent = new Map<number | null, OrgUnitDto[]>();
  const ids = new Set(units.map((u) => u.id));
  for (const u of units) { const k = u.parentId && ids.has(u.parentId) ? u.parentId : null; byParent.set(k, [...(byParent.get(k) ?? []), u]); }
  const out: { value: string; label: string }[] = [];
  const walk = (p: number | null, d: number) => {
    for (const u of (byParent.get(p) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))) {
      if (filter(u)) out.push({ value: String(u.id), label: `${nbsp(d)}${u.code} · ${label(u)}${u.isActive ? '' : ' ✕'}` });
      walk(u.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

function UnitModal({ dialog, units, types, users, onClose, onSaved }: {
  dialog: { kind: 'create'; parentId: number } | { kind: 'edit'; unit: OrgUnitDto };
  units: OrgUnitDto[]; types: OrgUnitTypeDto[]; users: UserDto[]; onClose: () => void; onSaved: (id?: number) => void;
}) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const editing = dialog.kind === 'edit' ? dialog.unit : null;
  const [parentId, setParentId] = useState(String(editing ? editing.parentId ?? '' : dialog.kind === 'create' ? dialog.parentId : ''));
  const parent = units.find((u) => u.id === Number(parentId));
  const under = typesUnder(types, parent);
  const allowedTypes = editing
    ? (editing.parentId === null ? types.filter((x) => x.id === editing.typeId) : [...under, ...types.filter((x) => x.id === editing.typeId && !under.includes(x))])
    : under;
  const [typeId, setTypeId] = useState(String(editing?.typeId ?? ''));
  const [f, setF] = useState({
    code: editing?.code ?? '', name: editing?.name ?? '', nameEn: editing?.nameEn ?? '', description: editing?.description ?? '',
    headUserId: editing?.headUserId ? String(editing.headUserId) : '', sortOrder: String(editing?.sortOrder ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // keep the type valid for the chosen parent
  useEffect(() => {
    if (editing) return;
    if (!allowedTypes.some((x) => String(x.id) === typeId)) setTypeId(allowedTypes[0] ? String(allowedTypes[0].id) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const save = async () => {
    setBusy(true); setError(null);
    const body = {
      typeId: Number(typeId), code: f.code.trim(), name: f.name.trim(), nameEn: f.nameEn.trim() || null, description: f.description.trim() || null,
      headUserId: f.headUserId ? Number(f.headUserId) : null, sortOrder: Number(f.sortOrder) || 0,
    };
    try {
      if (editing) {
        const patch: Record<string, unknown> = { ...body };
        if (editing.parentId === null || Number(typeId) === editing.typeId) delete patch.typeId;
        await api('PATCH', `/org/units/${editing.id}`, patch);
        onSaved(editing.id);
      } else {
        const created = await api<OrgUnitDto>('POST', '/org/units', { ...body, parentId: Number(parentId) });
        onSaved(created?.id);
      }
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const parentOptions = unitTreeOptions(units, dn, (u) => typesUnder(types, u).length > 0);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Modal wide title={editing ? `${L.editTitle} · ${editing.code}` : L.createTitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!typeId || !f.code.trim() || !f.name.trim() || (!editing && !parentId)} onClick={save}>{editing ? t('common.save') : t('common.create')}</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="grid-2">
          {editing ? (
            <Field label={L.parent}>{(id) => <Input id={id} disabled value={editing.path.slice(0, -1).join(' › ') || '—'} />}</Field>
          ) : (
            <Field label={L.parent}>{(id) => <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)} options={parentOptions} />}</Field>
          )}
          <Field label={L.type}>
            {(id) => <Select id={id} value={typeId} disabled={allowedTypes.length === 0} onChange={(e) => setTypeId(e.target.value)}
              options={allowedTypes.length ? allowedTypes.map((x) => ({ value: String(x.id), label: `${dn(x)} (${x.code})` })) : [{ value: '', label: '—' }]} />}
          </Field>
        </div>
        {allowedTypes.length === 0 && <Alert kind="warning">{L.noTypes}</Alert>}
        <div className="grid-2">
          <Field label={t('common.code')}>{(id) => <Input id={id} required maxLength={30} value={f.code} onChange={(e) => set('code', e.target.value)} />}</Field>
          <Field label={L.sortOrder}>{(id) => <Input id={id} type="number" value={f.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />}</Field>
          <Field label={t('common.name')}>{(id) => <Input id={id} required maxLength={160} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label={t('common.nameEn')}>{(id) => <Input id={id} maxLength={160} value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} />}</Field>
        </div>
        <Field label={L.head}>
          {(id) => <Select id={id} value={f.headUserId} onChange={(e) => set('headUserId', e.target.value)}
            options={[{ value: '', label: L.noHead }, ...users.filter((u) => u.isActive || String(u.id) === f.headUserId).map((u) => ({ value: String(u.id), label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}` }))]} />}
        </Field>
        <Field label={t('common.description')}>
          {(id) => <textarea id={id} className="input textarea" rows={2} maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <button type="submit" hidden />
      </form>
      <ErrorMessage error={error} />
    </Modal>
  );
}

function MoveModal({ unit, units, types, onClose, onSaved }: { unit: OrgUnitDto; units: OrgUnitDto[]; types: OrgUnitTypeDto[]; onClose: () => void; onSaved: () => void }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const own = subtreeOf(units, unit.id);
  const ty = types.find((x) => x.id === unit.typeId);
  const valid = (p: OrgUnitDto) => {
    if (own.has(p.id)) return false;
    const pt = types.find((x) => x.id === p.typeId);
    if (pt && !pt.canHaveChildren) return false;
    return !ty || ty.allowedParentTypeIds.length === 0 || ty.allowedParentTypeIds.includes(p.typeId);
  };
  const options = unitTreeOptions(units, dn, valid);
  const [parentId, setParentId] = useState(String(unit.parentId ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const target = units.find((u) => u.id === Number(parentId));
  const save = async () => {
    setBusy(true); setError(null);
    try { await api('PATCH', `/org/units/${unit.id}`, { parentId: Number(parentId) }); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={fmt(L.moveTitle, { name: dn(unit) })} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} disabled={!parentId || Number(parentId) === unit.parentId} onClick={save}>{L.move}</Button>
    </>}>
      <p className="muted">{L.moveHint}</p>
      {options.length === 0 ? <Alert kind="warning">{L.noTargets}</Alert> : (
        <Field label={L.newParent}>{(id) => <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)} options={options} />}</Field>
      )}
      {target && <p className="small"><b>{L.newPath}:</b> {[...target.path, dn(unit)].join(' › ')}</p>}
      <ErrorMessage error={error} />
    </Modal>
  );
}

function HeadModal({ unit, users, onClose, onSaved }: { unit: OrgUnitDto; users: UserDto[]; onClose: () => void; onSaved: () => void }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const [head, setHead] = useState(unit.headUserId ? String(unit.headUserId) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api('PATCH', `/org/units/${unit.id}`, { headUserId: head ? Number(head) : null }); onSaved(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={fmt(L.headTitle, { name: dn(unit) })} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" busy={busy} onClick={save}>{t('common.save')}</Button>
    </>}>
      <Field label={L.head}>
        {(id) => <Select id={id} value={head} onChange={(e) => setHead(e.target.value)}
          options={[{ value: '', label: L.noHead }, ...users.filter((u) => u.isActive || String(u.id) === head).map((u) => ({ value: String(u.id), label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}${u.orgUnitName ? ` (${u.orgUnitName})` : ''}` }))]} />}
      </Field>
      <ErrorMessage error={error} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ unit types */

interface TypeForm {
  code: string; name: string; nameEn: string; canHaveChildren: boolean; requiresCostCenter: boolean; inBudgeting: boolean; inWorkflow: boolean;
  isActive: boolean; sortOrder: string; allowedParentTypeIds: number[];
}

function UnitTypes({ types, canManage, reload }: { types: OrgUnitTypeDto[]; canManage: boolean; reload: () => Promise<void> }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  const [editing, setEditing] = useState<{ row: OrgUnitTypeDto | null; form: TypeForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const byId = new Map(types.map((x) => [x.id, x]));

  const open = (row: OrgUnitTypeDto | null) => {
    setError(null);
    setEditing({ row, form: row ? {
      code: row.code, name: row.name, nameEn: row.nameEn ?? '', canHaveChildren: row.canHaveChildren, requiresCostCenter: row.requiresCostCenter,
      inBudgeting: row.inBudgeting, inWorkflow: row.inWorkflow, isActive: row.isActive, sortOrder: String(row.sortOrder), allowedParentTypeIds: [...row.allowedParentTypeIds],
    } : { code: '', name: '', nameEn: '', canHaveChildren: true, requiresCostCenter: false, inBudgeting: false, inWorkflow: true, isActive: true, sortOrder: '50', allowedParentTypeIds: [] } });
  };
  const set = <K extends keyof TypeForm>(k: K, v: TypeForm[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    setBusy(true); setError(null);
    const body = {
      name: f.name.trim(), nameEn: f.nameEn.trim() || null, canHaveChildren: f.canHaveChildren, requiresCostCenter: f.requiresCostCenter, inBudgeting: f.inBudgeting,
      inWorkflow: f.inWorkflow, isActive: f.isActive, sortOrder: Number(f.sortOrder) || 0, allowedParentTypeIds: f.allowedParentTypeIds,
    };
    try {
      if (editing.row) await api('PATCH', `/org/types/${editing.row.id}`, body);
      else await api('POST', '/org/types', { ...body, code: f.code.trim() });
      setEditing(null);
      await reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const flag = (v: boolean) => <span className={`yes-no ${v ? 'is-yes' : 'is-no'}`}>{v ? '✓' : '—'}<span className="sr-only">{v ? t('common.yes') : t('common.no')}</span></span>;

  return (
    <>
      <Card flush>
        <div className="table-toolbar">
          <span className="muted small">{L.budgetingHint}</span>
          {canManage && <span className="toolbar-right"><Button size="sm" variant="primary" onClick={() => open(null)}><Icon name="plus" /> {L.newType}</Button></span>}
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.code')}</th><th>{t('common.name')}</th><th>{L.allowedParents}</th>
                <th className="r">{L.canHaveChildren}</th><th className="r">{L.inBudgeting}</th><th className="r">{L.inWorkflow}</th><th className="r">{L.requiresCostCenter}</th>
                <th className="r">{L.units}</th><th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((x) => (
                <tr key={x.id} className={`tree-row${canManage ? ' clickable' : ''}${x.isActive ? '' : ' is-inactive'}`} onClick={canManage ? () => open(x) : undefined}>
                  <td><span className="acc-code">{x.code}</span></td>
                  <td>{dn(x)}{x.nameEn && <span className="cell-sub">{x.nameEn}</span>}</td>
                  <td>{x.allowedParentTypeIds.length === 0 ? <span className="muted">{L.anyParent}</span> : (
                    <span className="unit-ccs">{x.allowedParentTypeIds.map((p) => <span key={p} className="cc-chip">{byId.get(p)?.code ?? p}</span>)}</span>
                  )}</td>
                  <td className="r">{flag(x.canHaveChildren)}</td>
                  <td className="r">{flag(x.inBudgeting)}</td>
                  <td className="r">{flag(x.inWorkflow)}</td>
                  <td className="r">{flag(x.requiresCostCenter)}</td>
                  <td className="r num">{x.unitCount}</td>
                  <td>{x.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Modal wide title={editing.row ? `${L.editType} · ${editing.row.code}` : L.newType} onClose={() => setEditing(null)} footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!editing.form.code.trim() || !editing.form.name.trim()} onClick={save}>{editing.row ? t('common.save') : t('common.create')}</Button>
        </>}>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid-2">
              <Field label={t('common.code')} hint={editing.row ? L.codeFixed : undefined}>
                {(id) => <Input id={id} required maxLength={30} disabled={!!editing.row} value={editing.form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />}
              </Field>
              <Field label={L.sortOrder}>{(id) => <Input id={id} type="number" value={editing.form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />}</Field>
              <Field label={t('common.name')}>{(id) => <Input id={id} required maxLength={160} value={editing.form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
              <Field label={t('common.nameEn')}>{(id) => <Input id={id} maxLength={160} value={editing.form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />}</Field>
            </div>
            <fieldset className="fieldset">
              <legend>{L.allowedParents}</legend>
              <p className="hint" style={{ marginBottom: 6 }}>{L.allowedHint}</p>
              <div className="check-grid">
                {types.filter((x) => x.canHaveChildren).map((x) => (
                  <label key={x.id} className="check">
                    <input type="checkbox" checked={editing.form.allowedParentTypeIds.includes(x.id)}
                      onChange={(e) => set('allowedParentTypeIds', e.target.checked ? [...editing.form.allowedParentTypeIds, x.id] : editing.form.allowedParentTypeIds.filter((p) => p !== x.id))} />
                    {dn(x)} <span className="muted small">({x.code})</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="fieldset">
              <legend>{L.flags}</legend>
              <div className="check-grid">
                <label className="check"><input type="checkbox" checked={editing.form.canHaveChildren} onChange={(e) => set('canHaveChildren', e.target.checked)} /> {L.canHaveChildren}</label>
                <label className="check"><input type="checkbox" checked={editing.form.inBudgeting} onChange={(e) => set('inBudgeting', e.target.checked)} /> {L.inBudgeting}</label>
                <label className="check"><input type="checkbox" checked={editing.form.inWorkflow} onChange={(e) => set('inWorkflow', e.target.checked)} /> {L.inWorkflow}</label>
                <label className="check"><input type="checkbox" checked={editing.form.requiresCostCenter} onChange={(e) => set('requiresCostCenter', e.target.checked)} /> {L.requiresCostCenter}</label>
                <label className="check"><input type="checkbox" checked={editing.form.isActive} disabled={editing.row?.code === 'COMPANY'} onChange={(e) => set('isActive', e.target.checked)} /> {t('common.active')}</label>
              </div>
            </fieldset>
            <button type="submit" hidden />
          </form>
          <ErrorMessage error={error} />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ job families & positions */

function userOptions(users: UserDto[], none: string) {
  return [{ value: '', label: none }, ...users.filter((u) => u.isActive).map((u) => ({ value: String(u.id), label: `${u.fullName}${u.jobTitle ? ` · ${u.jobTitle}` : ''}` }))];
}

function JobFamilies({ users, canManage }: { users: UserDto[]; canManage: boolean }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  type F = { code: string; name: string; ownerUserId: string; isActive: boolean };
  return (
    <CrudPage<JobFamilyDto, F>
      embedded title={L.tabJobs} subtitle={L.jobsHint} endpoint="/org/job-families" canManage={canManage} newLabel={L.newJob} canDelete={false}
      banner={<p className="hint mb-8">{L.jobsHint}</p>}
      rowClassName={(r) => `tree-row${r.isActive ? '' : ' is-inactive'}`}
      columns={[
        { header: t('common.code'), render: (r) => <span className="acc-code">{r.code}</span> },
        { header: t('common.name'), render: (r) => r.name },
        { header: t('common.owner'), render: (r) => r.ownerName ?? <span className="muted">—</span> },
        { header: t('common.status'), render: (r) => (r.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>) },
      ]}
      fields={[
        { key: 'code', label: t('common.code'), required: true },
        { key: 'name', label: t('common.name'), required: true },
        { key: 'ownerUserId', label: t('common.owner'), type: 'select', options: userOptions(users, L.noHead) },
        { key: 'isActive', label: t('common.active'), type: 'checkbox' },
      ]}
      emptyForm={() => ({ code: '', name: '', ownerUserId: '', isActive: true })}
      toForm={(r) => ({ code: r.code, name: r.name, ownerUserId: r.ownerUserId ? String(r.ownerUserId) : '', isActive: r.isActive })}
      toPayload={(f) => ({ code: f.code.trim(), name: f.name.trim(), ownerUserId: f.ownerUserId ? Number(f.ownerUserId) : null, isActive: f.isActive })}
    />
  );
}

function Positions({ users, units, canManage }: { users: UserDto[]; units: OrgUnitDto[]; canManage: boolean }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const dn = useDisplayName();
  type F = { code: string; title: string; orgUnitId: string; holderUserId: string; isActive: boolean };
  return (
    <CrudPage<PositionDto, F>
      embedded title={L.tabPositions} subtitle={L.positionsHint} endpoint="/org/positions" canManage={canManage} newLabel={L.newPosition} canDelete={false}
      banner={<p className="hint mb-8">{L.positionsHint}</p>}
      rowClassName={(r) => `tree-row${r.isActive ? '' : ' is-inactive'}`}
      columns={[
        { header: t('common.code'), render: (r) => <span className="acc-code">{r.code}</span> },
        { header: L.positionTitle, render: (r) => r.title },
        { header: t('common.unit'), render: (r) => r.orgUnitName ?? <span className="muted">—</span> },
        { header: L.holder, render: (r) => r.holderName ?? <span className="muted">—</span> },
        { header: t('common.status'), render: (r) => (r.isActive ? <Badge tone="success">{t('common.active')}</Badge> : <Badge tone="muted">{t('common.inactive')}</Badge>) },
      ]}
      fields={[
        { key: 'code', label: t('common.code'), required: true },
        { key: 'title', label: L.positionTitle, required: true },
        { key: 'orgUnitId', label: t('common.unit'), type: 'select', options: [{ value: '', label: L.noUnit }, ...unitTreeOptions(units, dn, () => true)] },
        { key: 'holderUserId', label: L.holder, type: 'select', options: userOptions(users, L.noHead) },
        { key: 'isActive', label: t('common.active'), type: 'checkbox' },
      ]}
      emptyForm={() => ({ code: '', title: '', orgUnitId: '', holderUserId: '', isActive: true })}
      toForm={(r) => ({ code: r.code, title: r.title, orgUnitId: r.orgUnitId ? String(r.orgUnitId) : '', holderUserId: r.holderUserId ? String(r.holderUserId) : '', isActive: r.isActive })}
      toPayload={(f) => ({ code: f.code.trim(), title: f.title.trim(), orgUnitId: f.orgUnitId ? Number(f.orgUnitId) : null, holderUserId: f.holderUserId ? Number(f.holderUserId) : null, isActive: f.isActive })}
    />
  );
}
