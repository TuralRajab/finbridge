import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { CostCenterDto, OrgUnitDto, OrgUnitTypeDto } from '@finbridge/shared';
import { Badge, Button, Icon, Input } from './ui';
import { fmt, useI18n, useLocal } from '../i18n';
import { useDisplayName } from '../lib/masterdata';
import { date } from '../lib/format';
import '../styles/org-chart.css';

const az = {
  chart: 'Təşkilati sxem', canvas: 'Təşkilati sxem: {n} vahid',
  search: 'Vahid, kod və ya rəhbər…', searchLabel: 'Sxemdə axtar', matches: '{i} / {n}', noMatches: 'Tapılmadı',
  prevMatch: 'Əvvəlki nəticə', nextMatch: 'Növbəti nəticə',
  expandAll: 'Hamısını aç', collapseAll: 'Hamısını bağla',
  zoomIn: 'Böyüt', zoomOut: 'Kiçilt', zoomReset: 'Miqyas 100%', fit: 'Ekrana sığdır', zoom: 'Miqyas',
  print: 'Çap et', showCcs: 'Xərc mərkəzləri', showInactive: 'Deaktivlər',
  typeFilter: 'Növ üzrə vurğula', allTypes: 'Bütün növlər',
  noHead: 'Rəhbər təyin edilməyib', head: 'Rəhbər', inactive: 'Deaktiv',
  childrenN: '{n} alt vahid', ccsN: '{n} xərc m.', moreCcs: '+{n} daha',
  expand: '{name}: {n} alt vahidi aç', collapse: '{name}: alt vahidləri bağla',
  hint: 'Dartaraq sürüşdürün, siçan təkəri ilə miqyası dəyişin. Ox düymələri ilə vahidlər arasında keçin, Enter ilə seçin.',
  close: 'Paneli bağla', path: 'Yol', type: 'Növ', budgetSection: 'Büdcə bölməsi', yes: 'Bəli', no: 'Xeyr',
  children: 'Alt vahidlər', ccs: 'Xərc mərkəzləri', noCcs: 'Bu vahiddə xərc mərkəzi yoxdur.', noChildren: 'Alt vahid yoxdur.',
  addChild: 'Alt vahid', edit: 'Redaktə et', setHead: 'Rəhbəri təyin et', move: 'Köçür', openInList: 'Siyahıda aç',
  noChildrenType: 'Bu növ vahidin alt vahidi ola bilməz.', rootLocked: 'Kök vahid köçürülə bilməz.',
  printedAt: 'Çap tarixi: {d}', units: '{n} vahid', details: 'Vahid haqqında', locate: 'Sxemdə göstər',
};
const TEXT = {
  az,
  en: {
    chart: 'Org chart', canvas: 'Org chart: {n} units',
    search: 'Unit, code or head…', searchLabel: 'Search the chart', matches: '{i} / {n}', noMatches: 'No match',
    prevMatch: 'Previous match', nextMatch: 'Next match',
    expandAll: 'Expand all', collapseAll: 'Collapse all',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Zoom 100%', fit: 'Fit to screen', zoom: 'Zoom',
    print: 'Print', showCcs: 'Cost centers', showInactive: 'Inactive',
    typeFilter: 'Highlight by type', allTypes: 'All types',
    noHead: 'No head assigned', head: 'Head', inactive: 'Inactive',
    childrenN: '{n} sub-units', ccsN: '{n} CCs', moreCcs: '+{n} more',
    expand: '{name}: expand {n} sub-units', collapse: '{name}: collapse sub-units',
    hint: 'Drag to pan, use the mouse wheel to zoom. Use arrow keys to move between units and Enter to select.',
    close: 'Close panel', path: 'Path', type: 'Type', budgetSection: 'Budget section', yes: 'Yes', no: 'No',
    children: 'Sub-units', ccs: 'Cost centers', noCcs: 'This unit has no cost centers.', noChildren: 'No sub-units.',
    addChild: 'Sub-unit', edit: 'Edit', setHead: 'Set head', move: 'Move', openInList: 'Open in list',
    noChildrenType: 'Units of this type cannot have sub-units.', rootLocked: 'The root unit cannot be moved.',
    printedAt: 'Printed: {d}', units: '{n} units', details: 'Unit details', locate: 'Show in chart',
  } satisfies typeof az,
};

export type OrgChartAction =
  | { kind: 'create'; parentId: number }
  | { kind: 'edit'; unit: OrgUnitDto }
  | { kind: 'move'; unit: OrgUnitDto }
  | { kind: 'head'; unit: OrgUnitDto };

/* ------------------------------------------------------------------ layout (tidy tree, no libraries) */

const W = 216; // box width
const BASE_H = 124; // box height without cost-center chips
const GX = 28; // horizontal gap between sibling subtrees
const GY = 52; // vertical gap between levels
const INDENT = 30; // indent of a stacked (vertical) leaf group
const STACK_GAP = 14;
const CHIP_H = 22;
const MAX_CHIPS = 3;
const PAD = 40;
const MIN_K = 0.1;
const READABLE_K = 0.8; // zoom used when jumping to a unit
const MAX_K = 2;

interface LNode {
  u: OrgUnitDto;
  depth: number;
  parent: LNode | null;
  kids: LNode[];
  childTotal: number; // visible children incl. collapsed ones
  collapsed: boolean;
  stacked: boolean;
  h: number;
  w: number;
  x: number;
  y: number;
  ccs: CostCenterDto[];
}

interface Layout { roots: LNode[]; nodes: LNode[]; byId: Map<number, LNode>; edges: { id: number; d: string }[]; width: number; height: number }

function nodeHeight(ccCount: number, showCcs: boolean) {
  if (!showCcs || ccCount === 0) return BASE_H;
  return BASE_H + 8 + Math.min(ccCount, MAX_CHIPS) * CHIP_H + (ccCount > MAX_CHIPS ? 18 : 0);
}

function buildLayout(units: OrgUnitDto[], ccs: CostCenterDto[], collapsed: Set<number>, showInactive: boolean, showCcs: boolean): Layout {
  const ids = new Set(units.map((u) => u.id));
  const kidsOf = new Map<number | null, OrgUnitDto[]>();
  for (const u of units) {
    if (!showInactive && !u.isActive) continue;
    const k = u.parentId !== null && ids.has(u.parentId) ? u.parentId : null;
    const list = kidsOf.get(k);
    if (list) list.push(u); else kidsOf.set(k, [u]);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const ccOf = new Map<number, CostCenterDto[]>();
  for (const c of ccs) {
    if (!showInactive && !c.isActive) continue;
    const list = ccOf.get(c.orgUnitId);
    if (list) list.push(c); else ccOf.set(c.orgUnitId, [c]);
  }
  for (const list of ccOf.values()) list.sort((a, b) => a.code.localeCompare(b.code));

  const nodes: LNode[] = [];
  const byId = new Map<number, LNode>();
  const build = (u: OrgUnitDto, depth: number, parent: LNode | null): LNode => {
    const all = kidsOf.get(u.id) ?? [];
    const isCollapsed = all.length > 0 && collapsed.has(u.id);
    const unitCcs = ccOf.get(u.id) ?? [];
    const n: LNode = { u, depth, parent, kids: [], childTotal: all.length, collapsed: isCollapsed, stacked: false, h: nodeHeight(unitCcs.length, showCcs), w: W, x: 0, y: 0, ccs: unitCcs };
    nodes.push(n); byId.set(u.id, n);
    if (!isCollapsed) n.kids = all.map((c) => build(c, depth + 1, n));
    return n;
  };
  // roots: the top unit plus any orphaned units whose parent is not visible
  const roots = (kidsOf.get(null) ?? []).map((u) => build(u, 0, null));

  // pass 1: subtree widths (post-order)
  const measure = (n: LNode): number => {
    if (n.kids.length === 0) { n.w = W; return W; }
    for (const k of n.kids) measure(k);
    // a group of 3+ leaves below a non-root unit is stacked vertically to keep the chart compact
    n.stacked = n.depth >= 1 && n.kids.length >= 3 && n.kids.every((k) => k.kids.length === 0);
    if (n.stacked) { n.w = W + INDENT; return n.w; }
    const total = n.kids.reduce((s, k) => s + k.w, 0) + GX * (n.kids.length - 1);
    n.w = Math.max(W, total);
    return n.w;
  };
  // pass 2: positions (pre-order); rowH = tallest box among the node and its siblings
  const edges: { id: number; d: string }[] = [];
  let bottom = 0;
  const place = (n: LNode, left: number, y: number, rowH: number) => {
    n.y = y;
    bottom = Math.max(bottom, y + n.h);
    if (n.kids.length === 0) { n.x = left + (n.w - W) / 2; return; }
    if (n.stacked) {
      n.x = left;
      let cy = y + n.h + GY * 0.5;
      const sx = n.x + INDENT / 2;
      for (const k of n.kids) {
        k.x = left + INDENT; k.y = cy;
        bottom = Math.max(bottom, cy + k.h);
        edges.push({ id: k.u.id, d: `M${sx},${y + n.h}V${cy + Math.min(k.h, BASE_H) / 2}H${k.x}` });
        cy += k.h + STACK_GAP;
      }
      return;
    }
    const total = n.kids.reduce((s, k) => s + k.w, 0) + GX * (n.kids.length - 1);
    let cx = left + (n.w - total) / 2;
    const childY = y + rowH + GY;
    const childRowH = Math.max(...n.kids.map((k) => k.h));
    for (const k of n.kids) { place(k, cx, childY, childRowH); cx += k.w + GX; }
    const first = n.kids[0]; const last = n.kids[n.kids.length - 1];
    n.x = (first.x + last.x) / 2;
    const px = n.x + W / 2;
    const busY = y + rowH + GY / 2;
    for (const k of n.kids) edges.push({ id: k.u.id, d: `M${px},${y + n.h}V${busY}H${k.x + W / 2}V${k.y}` });
  };
  let left = PAD;
  for (const r of roots) { measure(r); place(r, left, PAD, r.h); left += r.w + GX * 2; }
  return { roots, nodes, byId, edges, width: Math.max(left - GX * 2 + PAD, W + PAD * 2), height: bottom + PAD };
}

/* ------------------------------------------------------------------ helpers */

const PALETTE = 10;
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase();
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ component */

export function OrgChart({ units, costCenters, types, canManage, selectedId, onSelect, onAction, onOpenInList }: {
  units: OrgUnitDto[]; costCenters: CostCenterDto[]; types: OrgUnitTypeDto[]; canManage: boolean;
  selectedId: number | null; onSelect: (id: number | null) => void;
  onAction: (a: OrgChartAction) => void; onOpenInList: (id: number) => void;
}) {
  const L = useLocal(TEXT);
  const { locale } = useI18n();
  const dn = useDisplayName();

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const typeById = useMemo(() => new Map(types.map((x) => [x.id, x])), [types]);
  // stable colour slot per unit type (by sort order, then id)
  const typeSlot = useMemo(() => {
    const sorted = [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    return new Map(sorted.map((x, i) => [x.id, i % PALETTE]));
  }, [types]);
  const usedTypes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const u of units) counts.set(u.typeId, (counts.get(u.typeId) ?? 0) + 1);
    return [...types].filter((x) => counts.has(x.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((x) => ({ type: x, count: counts.get(x.id) ?? 0 }));
  }, [types, units]);

  const depthOf = useCallback((u: OrgUnitDto) => { let d = 0; let p = u.parentId; while (p !== null && d < 100) { d++; p = unitById.get(p)?.parentId ?? null; } return d; }, [unitById]);
  const parentIds = useMemo(() => new Set(units.map((u) => u.parentId).filter((x): x is number => x !== null)), [units]);

  // default: show three levels (root, its children, grandchildren)
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(units.filter((u) => parentIds.has(u.id) && depthOf(u) >= 2).map((u) => u.id)));
  const [showCcs, setShowCcs] = useState(false);
  const [showInactive, setShowInactive] = useState(true);
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [focusId, setFocusId] = useState<number | null>(null);

  const layout = useMemo(() => buildLayout(units, costCenters, collapsed, showInactive, showCcs), [units, costCenters, collapsed, showInactive, showCcs]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const [zoomPct, setZoomPct] = useState(100);
  const initialised = useRef(false);
  const anchor = useRef<{ id: number; sx: number; sy: number } | null>(null);
  const pendingCenter = useRef<number | null>(null);
  const pendingFocus = useRef(false);

  const size = () => ({ cw: canvasRef.current?.clientWidth ?? 800, ch: canvasRef.current?.clientHeight ?? 600 });
  const apply = useCallback(() => {
    const v = view.current;
    const { cw, ch } = size();
    const lw = layout.width * v.k; const lh = layout.height * v.k;
    // keep at least a strip of the chart inside the canvas
    v.x = clamp(v.x, Math.min(80 - lw, cw - lw - 40), Math.max(cw - 80, 40));
    v.y = clamp(v.y, Math.min(80 - lh, ch - lh - 40), Math.max(ch - 80, 40));
    if (stageRef.current) stageRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    setZoomPct(Math.round(v.k * 100));
  }, [layout]);

  const zoomAt = useCallback((k: number, px?: number, py?: number) => {
    const v = view.current;
    const { cw, ch } = size();
    const ax = px ?? cw / 2; const ay = py ?? ch / 2;
    const nk = clamp(k, MIN_K, MAX_K);
    v.x = ax - ((ax - v.x) / v.k) * nk;
    v.y = ay - ((ay - v.y) / v.k) * nk;
    v.k = nk;
    apply();
  }, [apply]);

  const fit = useCallback(() => {
    const { cw, ch } = size();
    const k = clamp(Math.min(cw / layout.width, ch / layout.height, 1), MIN_K, 1);
    view.current = { k, x: (cw - layout.width * k) / 2, y: Math.max(0, (ch - layout.height * k) / 2) };
    apply();
  }, [layout, apply]);

  const centerOn = useCallback((id: number, onlyIfHidden = false, minK = 0) => {
    const n = layout.byId.get(id);
    if (!n) return;
    const v = view.current;
    const { cw, ch } = size();
    if (v.k < minK) { v.k = minK; onlyIfHidden = false; }
    const sx = v.x + n.x * v.k; const sy = v.y + n.y * v.k;
    if (onlyIfHidden && sx >= 8 && sy >= 8 && sx + W * v.k <= cw - 8 && sy + n.h * v.k <= ch - 8) return;
    v.x = cw / 2 - (n.x + W / 2) * v.k;
    v.y = Math.min(ch / 2, ch / 3 + 40) - (n.y + n.h / 2) * v.k;
    apply();
  }, [layout, apply]);

  const centerRef = useRef(centerOn);
  centerRef.current = centerOn;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** Centre a unit once it is laid out (now, or after the pending expand re-layouts). */
  const pendingK = useRef(0);
  const reveal = (id: number, minK = READABLE_K) => {
    if (layoutRef.current.byId.has(id)) {
      pendingCenter.current = null;
      requestAnimationFrame(() => centerRef.current(id, true, minK));
    } else { pendingCenter.current = id; pendingK.current = minK; }
  };
  const clickSelect = useRef(false);

  // initial view, keep anchors stable on re-layout, run pending centring
  useLayoutEffect(() => {
    if (!initialised.current && canvasRef.current) {
      initialised.current = true;
      const { cw } = size();
      const k = clamp(Math.min((cw - 16) / layout.width, 1), 0.75, 1);
      const root = layout.roots[0];
      const x = layout.width * k <= cw ? (cw - layout.width * k) / 2 : root ? cw / 2 - (root.x + W / 2) * k : 0;
      view.current = { k, x, y: 8 };
    }
    const a = anchor.current;
    if (a) {
      anchor.current = null;
      const n = layout.byId.get(a.id);
      if (n) { view.current.x = a.sx - n.x * view.current.k; view.current.y = a.sy - n.y * view.current.k; }
    }
    apply();
    if (pendingCenter.current !== null && layout.byId.has(pendingCenter.current)) {
      centerOn(pendingCenter.current, true, pendingK.current);
      pendingCenter.current = null;
    }
    if (pendingFocus.current && focusId !== null) {
      pendingFocus.current = false;
      stageRef.current?.querySelector<HTMLElement>(`[data-id="${focusId}"]`)?.focus({ preventScroll: true });
    }
  }, [layout, apply, centerOn, focusId]);

  // open fitted to the canvas so the whole structure is visible at first sight
  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (didFit.current || !layout.width) return;
    didFit.current = true;
    fit();
  }, [layout, fit]);

  // keep the stage within bounds when the canvas is resized
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  const remember = (id: number) => {
    const n = layout.byId.get(id);
    if (n) anchor.current = { id, sx: view.current.x + n.x * view.current.k, sy: view.current.y + n.y * view.current.k };
  };
  const expandAncestors = (ids: number[], s: Set<number>) => {
    const next = new Set(s);
    for (const id of ids) { let p = unitById.get(id)?.parentId ?? null; while (p !== null) { next.delete(p); p = unitById.get(p)?.parentId ?? null; } }
    return next;
  };
  const toggle = (id: number) => {
    remember(id);
    setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // external selection (e.g. a unit created in a modal): reveal and centre it
  useEffect(() => {
    if (selectedId === null) return;
    setCollapsed((s) => { const n = expandAncestors([selectedId], s); return n.size === s.size ? s : n; });
    reveal(selectedId, clickSelect.current ? 0 : READABLE_K);
    clickSelect.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---------------------------------------------------------------- search
  const q = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!q) return [] as number[];
    const order = new Map<number, number>();
    let i = 0;
    const kids = new Map<number | null, OrgUnitDto[]>();
    for (const u of units) { const k = u.parentId !== null && unitById.has(u.parentId) ? u.parentId : null; kids.set(k, [...(kids.get(k) ?? []), u]); }
    const walk = (p: number | null) => { for (const u of (kids.get(p) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))) { order.set(u.id, i++); walk(u.id); } };
    walk(null);
    return units
      .filter((u) => (showInactive || u.isActive) && `${u.code} ${u.name} ${u.nameEn ?? ''} ${u.headName ?? ''}`.toLocaleLowerCase().includes(q))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((u) => u.id);
  }, [q, units, unitById, showInactive]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const currentMatch = matches.length ? matches[Math.min(matchIdx, matches.length - 1)] : null;

  useEffect(() => {
    setMatchIdx(0);
    if (!matches.length) return;
    setCollapsed((s) => { const n = expandAncestors(matches, s); return n.size === s.size ? s : n; });
    reveal(matches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  const stepMatch = (d: number) => {
    if (!matches.length) return;
    const i = (Math.min(matchIdx, matches.length - 1) + d + matches.length) % matches.length;
    setMatchIdx(i);
    centerOn(matches[i], false, READABLE_K);
  };

  // ---------------------------------------------------------------- pan / zoom input
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(view.current.k * factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; pinch: { d: number; k: number; mx: number; my: number } | null } | null>(null);
  const suppressClick = useRef(false);

  const pinchInfo = () => {
    const [a, b] = [...ptrs.current.values()];
    const r = canvasRef.current!.getBoundingClientRect();
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.oc-controls')) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = view.current;
    if (ptrs.current.size === 2) {
      const p = pinchInfo();
      drag.current = { sx: 0, sy: 0, vx: v.x, vy: v.y, moved: true, pinch: { d: p.d, k: v.k, mx: p.mx, my: p.my } };
      canvasRef.current?.setPointerCapture(e.pointerId);
    } else if (ptrs.current.size === 1) {
      drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, pinch: null };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.has(e.pointerId) || !drag.current) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = drag.current;
    const v = view.current;
    if (g.pinch && ptrs.current.size >= 2) {
      const p = pinchInfo();
      const nk = clamp(g.pinch.k * (p.d / g.pinch.d), MIN_K, MAX_K);
      // zoom around the initial midpoint and follow the midpoint movement
      v.x = p.mx - ((g.pinch.mx - g.vx) / g.pinch.k) * nk;
      v.y = p.my - ((g.pinch.my - g.vy) / g.pinch.k) * nk;
      v.k = nk;
      apply();
      return;
    }
    const dx = e.clientX - g.sx; const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > 5) {
      g.moved = true;
      canvasRef.current?.setPointerCapture(e.pointerId);
      canvasRef.current?.classList.add('is-panning');
    }
    if (g.moved && !g.pinch) { v.x = g.vx + dx; v.y = g.vy + dy; apply(); }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    const g = drag.current;
    if (g?.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    if (ptrs.current.size === 1 && g?.pinch) {
      // continue as a one-finger pan
      const [p] = [...ptrs.current.values()];
      drag.current = { sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: true, pinch: null };
    } else if (ptrs.current.size === 0) {
      drag.current = null;
      canvasRef.current?.classList.remove('is-panning');
    }
  };

  // ---------------------------------------------------------------- keyboard
  const moveFocus = (id: number | null | undefined) => {
    if (id === null || id === undefined) return;
    pendingFocus.current = true;
    setFocusId(id);
    if (layout.byId.has(id)) {
      stageRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
      pendingFocus.current = false;
      centerOn(id, true);
    }
  };
  const onNodeKey = (e: ReactKeyboardEvent, n: LNode) => {
    const siblings = n.parent ? n.parent.kids : layout.roots;
    const i = siblings.indexOf(n);
    switch (e.key) {
      case 'Enter': case ' ': e.preventDefault(); clickSelect.current = true; onSelect(n.u.id); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(n.parent?.u.id); break;
      case 'ArrowDown':
        e.preventDefault();
        if (n.collapsed) toggle(n.u.id); else moveFocus(n.kids[0]?.u.id);
        break;
      case 'ArrowLeft': e.preventDefault(); if (n.parent?.stacked) moveFocus(n.parent.u.id); else moveFocus(siblings[i - 1]?.u.id); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(siblings[i + 1]?.u.id); break;
      case '+': case '-': if (n.childTotal > 0 && n.collapsed === (e.key === '+')) { e.preventDefault(); toggle(n.u.id); } break;
      default:
    }
  };
  const onCanvasKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const v = view.current;
    if (e.key === '+' || e.key === '=') zoomAt(v.k * 1.2);
    else if (e.key === '-') zoomAt(v.k / 1.2);
    else if (e.key === '0') fit();
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') v.x += step; if (e.key === 'ArrowRight') v.x -= step;
      if (e.key === 'ArrowUp') v.y += step; if (e.key === 'ArrowDown') v.y -= step;
      apply();
    }
  };

  // ---------------------------------------------------------------- print just the chart
  const print = () => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    document.head.appendChild(style);
    const scale = Math.min(1, 1030 / layout.width);
    canvasRef.current?.style.setProperty('--oc-print-scale', String(scale));
    canvasRef.current?.style.setProperty('--oc-print-h', `${Math.ceil(layout.height * scale) + 60}px`);
    document.body.classList.add('oc-printing');
    const done = () => { document.body.classList.remove('oc-printing'); style.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };

  // ---------------------------------------------------------------- render
  const selected = selectedId !== null ? unitById.get(selectedId) ?? null : null;
  const lineage = useMemo(() => {
    const s = new Set<number>();
    let n = selectedId !== null ? layout.byId.get(selectedId) : undefined;
    while (n?.parent) { s.add(n.u.id); n = n.parent; }
    return s;
  }, [selectedId, layout]);
  const tabStop = focusId !== null && layout.byId.has(focusId) ? focusId : selectedId !== null && layout.byId.has(selectedId) ? selectedId : layout.roots[0]?.u.id;
  const allParents = units.filter((u) => parentIds.has(u.id)).map((u) => u.id);
  const rootIds = new Set(layout.roots.map((r) => r.u.id));
  const typeLabel = (u: OrgUnitDto) => { const ty = typeById.get(u.typeId); return ty ? dn(ty) : u.typeName; };

  return (
    <div className={`oc${selected ? ' has-panel' : ''}`}>
      <div className="oc-toolbar">
        <div className="oc-search">
          <Input type="search" placeholder={L.search} aria-label={L.searchLabel} value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } }} />
          {q && (
            <span className="oc-search-nav" aria-live="polite">
              <span className={`small ${matches.length ? 'muted' : 'oc-nomatch'}`}>{matches.length ? fmt(L.matches, { i: Math.min(matchIdx, matches.length - 1) + 1, n: matches.length }) : L.noMatches}</span>
              <button type="button" className="icon-btn oc-ib" aria-label={L.prevMatch} title={L.prevMatch} disabled={matches.length < 2} onClick={() => stepMatch(-1)}><span className="oc-rot-up"><Icon name="chevron" size={14} /></span></button>
              <button type="button" className="icon-btn oc-ib" aria-label={L.nextMatch} title={L.nextMatch} disabled={matches.length < 2} onClick={() => stepMatch(1)}><span className="oc-rot-down"><Icon name="chevron" size={14} /></span></button>
            </span>
          )}
        </div>
        <label className="check oc-check"><input type="checkbox" checked={showCcs} onChange={(e) => setShowCcs(e.target.checked)} /> {L.showCcs}</label>
        <label className="check oc-check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {L.showInactive}</label>
        <span className="oc-toolbar-right">
          <Button size="sm" variant="ghost" onClick={() => { const r = layout.roots[0]; if (r) remember(r.u.id); setCollapsed(new Set()); }}>{L.expandAll}</Button>
          <Button size="sm" variant="ghost" onClick={() => { const r = layout.roots[0]; if (r) remember(r.u.id); setCollapsed(new Set(allParents.filter((id) => !rootIds.has(id)))); }}>{L.collapseAll}</Button>
          <Button size="sm" onClick={print}><Icon name="report" size={14} /> {L.print}</Button>
        </span>
      </div>
      <div className="oc-legend" role="group" aria-label={L.typeFilter}>
        <span className="oc-legend-label small muted">{L.typeFilter}:</span>
        <button type="button" className={`oc-type-chip${typeFilter === null ? ' is-on' : ''}`} aria-pressed={typeFilter === null} onClick={() => setTypeFilter(null)}>{L.allTypes} <span className="oc-count">{units.length}</span></button>
        {usedTypes.map(({ type, count }) => (
          <button key={type.id} type="button" className={`oc-type-chip oc-c${typeSlot.get(type.id) ?? 0}${typeFilter === type.id ? ' is-on' : ''}`}
            aria-pressed={typeFilter === type.id} onClick={() => setTypeFilter((f) => (f === type.id ? null : type.id))}>
            <span className="oc-swatch" aria-hidden="true" />{dn(type)} <span className="oc-count">{count}</span>
          </button>
        ))}
      </div>

      <div className="oc-body">
        <div ref={canvasRef} className="oc-canvas" tabIndex={0} aria-label={`${fmt(L.canvas, { n: units.length })}. ${L.hint}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); } }}
          onKeyDown={onCanvasKey}
          style={{ '--oc-h': `${layout.height}px` } as CSSProperties}>
          <div className="oc-print-head" aria-hidden="true">
            <b>{L.chart}</b> <span>{fmt(L.units, { n: layout.nodes.length })}</span> <span>{fmt(L.printedAt, { d: date(new Date().toISOString(), locale) })}</span>
          </div>
          <div ref={stageRef} className="oc-stage" style={{ width: layout.width, height: layout.height }} role="tree" aria-label={L.chart}>
            <svg className="oc-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <path className="oc-edge" d={layout.edges.map((e) => e.d).join('')} />
              {lineage.size > 0 && <path className="oc-edge is-lineage" d={layout.edges.filter((e) => lineage.has(e.id)).map((e) => e.d).join('')} />}
            </svg>
            {layout.nodes.map((n) => {
              const u = n.u;
              const slot = typeSlot.get(u.typeId) ?? 0;
              const dim = typeFilter !== null && u.typeId !== typeFilter;
              const isSel = u.id === selectedId;
              const cls = `oc-node oc-c${slot}${u.isActive ? '' : ' is-inactive'}${dim ? ' is-dim' : ''}${isSel ? ' is-selected' : ''}${matchSet.has(u.id) ? ' is-match' : ''}${currentMatch === u.id ? ' is-current' : ''}${u.parentId === null ? ' is-root' : ''}`;
              const siblings = n.parent ? n.parent.kids : layout.roots;
              return (
                <div key={u.id} style={{ left: n.x, top: n.y }} className="oc-slot">
                  <div data-id={u.id} className={cls} style={{ width: W, height: n.h }} role="treeitem"
                    tabIndex={u.id === tabStop ? 0 : -1} aria-selected={isSel} aria-level={n.depth + 1} aria-setsize={siblings.length} aria-posinset={siblings.indexOf(n) + 1}
                    aria-expanded={n.childTotal > 0 ? !n.collapsed : undefined}
                    aria-label={`${dn(u)}, ${u.code}, ${typeLabel(u)}, ${L.head}: ${u.headName ?? L.noHead}${u.isActive ? '' : `, ${L.inactive}`}`}
                    onClick={() => { setFocusId(u.id); clickSelect.current = true; onSelect(isSel ? null : u.id); }}
                    onFocus={() => setFocusId(u.id)} onKeyDown={(e) => onNodeKey(e, n)}>
                    <div className="oc-node-top">
                      <span className="oc-type"><span className="oc-swatch" aria-hidden="true" />{typeLabel(u)}</span>
                      <span className="oc-code">{u.code}</span>
                    </div>
                    <div className="oc-name" title={dn(u)}>{dn(u)}</div>
                    {u.headName ? (
                      <div className="oc-head"><span className="oc-avatar" aria-hidden="true">{initials(u.headName)}</span><span className="oc-head-name" title={u.headName}>{u.headName}</span></div>
                    ) : (
                      <div className="oc-head is-missing"><span className="oc-avatar" aria-hidden="true">!</span><span className="oc-head-name">{L.noHead}</span></div>
                    )}
                    <div className="oc-meta">
                      <span>{fmt(L.childrenN, { n: u.childCount })}</span>
                      <span aria-hidden="true">·</span>
                      <span>{fmt(L.ccsN, { n: u.costCenterCount })}</span>
                      {!u.isActive && <span className="oc-inactive">{L.inactive}</span>}
                    </div>
                    {showCcs && n.ccs.length > 0 && (
                      <ul className="oc-ccs">
                        {n.ccs.slice(0, MAX_CHIPS).map((c) => (
                          <li key={c.id} className={c.isActive ? '' : 'is-off'} title={`${c.code} · ${c.name}`}><span className="oc-cc-code">{c.code}</span>{c.name}</li>
                        ))}
                        {n.ccs.length > MAX_CHIPS && <li className="oc-more">{fmt(L.moreCcs, { n: n.ccs.length - MAX_CHIPS })}</li>}
                      </ul>
                    )}
                  </div>
                  {n.childTotal > 0 && (
                    <button type="button" tabIndex={-1} className={`oc-toggle${n.collapsed ? ' is-collapsed' : ''}${n.stacked ? ' is-stacked' : ''}`} style={{ top: n.h - 11 }}
                      aria-label={fmt(n.collapsed ? L.expand : L.collapse, { name: dn(u), n: n.childTotal })} title={fmt(n.collapsed ? L.expand : L.collapse, { name: dn(u), n: n.childTotal })}
                      onClick={(e) => { e.stopPropagation(); toggle(u.id); }}>
                      {n.collapsed ? `+${n.childTotal}` : '−'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="oc-controls" role="group" aria-label={L.zoom}>
            <button type="button" className="oc-ctl" aria-label={L.zoomIn} title={L.zoomIn} onClick={() => zoomAt(view.current.k * 1.25)}>+</button>
            <button type="button" className="oc-ctl oc-ctl-pct" aria-label={L.zoomReset} title={L.zoomReset} onClick={() => zoomAt(1)}>{zoomPct}%</button>
            <button type="button" className="oc-ctl" aria-label={L.zoomOut} title={L.zoomOut} onClick={() => zoomAt(view.current.k / 1.25)}>−</button>
            <button type="button" className="oc-ctl" aria-label={L.fit} title={L.fit} onClick={fit}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            </button>
          </div>
          <p className="oc-hint small">{L.hint}</p>
        </div>

        {selected && (
          <UnitDetails unit={selected} type={typeById.get(selected.typeId)} slot={typeSlot.get(selected.typeId) ?? 0}
            costCenters={costCenters.filter((c) => c.orgUnitId === selected.id)}
            children={units.filter((u) => u.parentId === selected.id).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))}
            canManage={canManage} onAction={onAction} onOpenInList={onOpenInList}
            onSelect={(id) => onSelect(id)} onLocate={() => centerOn(selected.id, false, READABLE_K)} onClose={() => {
              onSelect(null);
              stageRef.current?.querySelector<HTMLElement>(`[data-id="${selected.id}"]`)?.focus({ preventScroll: true });
            }} />
        )}
      </div>
    </div>
  );
}

function UnitDetails({ unit, type, slot, costCenters, children, canManage, onAction, onOpenInList, onSelect, onLocate, onClose }: {
  unit: OrgUnitDto; type: OrgUnitTypeDto | undefined; slot: number; costCenters: CostCenterDto[]; children: OrgUnitDto[]; canManage: boolean;
  onAction: (a: OrgChartAction) => void; onOpenInList: (id: number) => void; onSelect: (id: number) => void; onLocate: () => void; onClose: () => void;
}) {
  const L = useLocal(TEXT);
  const dn = useDisplayName();
  const isRoot = unit.parentId === null;
  const canChildren = type?.canHaveChildren !== false;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (window.matchMedia('(max-width: 900px)').matches) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [unit.id]);
  return (
    <aside ref={ref} className={`oc-panel oc-c${slot}`} aria-label={`${L.details}: ${dn(unit)}`}>
      <header className="oc-panel-head">
        <div className="oc-panel-title">
          <div className="oc-panel-badges">
            <span className="oc-type"><span className="oc-swatch" aria-hidden="true" />{type ? dn(type) : unit.typeName}</span>
            {type?.inBudgeting && <Badge tone="info">{L.budgetSection}</Badge>}
            {!unit.isActive && <Badge tone="muted">{L.inactive}</Badge>}
          </div>
          <h3>{dn(unit)}</h3>
          <span className="acc-code">{unit.code}</span>
        </div>
        <button type="button" className="icon-btn" aria-label={L.close} title={L.close} onClick={onClose}><Icon name="x" size={16} /></button>
      </header>
      {unit.path.length > 1 && (
        <nav className="org-path" aria-label={L.path}>{unit.path.slice(0, -1).map((p, i) => <span key={i}>{p}</span>)}</nav>
      )}
      <div className={`oc-panel-head-user${unit.headName ? '' : ' is-missing'}`}>
        <span className="oc-avatar oc-avatar-lg" aria-hidden="true">{unit.headName ? initials(unit.headName) : '!'}</span>
        <div><div className="small muted">{L.head}</div><b>{unit.headName ?? L.noHead}</b></div>
      </div>
      <div className="oc-panel-actions">
        {canManage && <>
          <Button size="sm" variant="primary" disabled={!canChildren} title={canChildren ? undefined : L.noChildrenType} onClick={() => onAction({ kind: 'create', parentId: unit.id })}><Icon name="plus" size={14} /> {L.addChild}</Button>
          <Button size="sm" onClick={() => onAction({ kind: 'edit', unit })}>{L.edit}</Button>
          <Button size="sm" onClick={() => onAction({ kind: 'head', unit })}>{L.setHead}</Button>
          <Button size="sm" disabled={isRoot} title={isRoot ? L.rootLocked : undefined} onClick={() => onAction({ kind: 'move', unit })}>{L.move}</Button>
        </>}
        <Button size="sm" variant="ghost" onClick={onLocate}>{L.locate}</Button>
        <Button size="sm" variant="ghost" onClick={() => onOpenInList(unit.id)}>{L.openInList} →</Button>
      </div>
      {canManage && !canChildren && <p className="hint mb-8">{L.noChildrenType}</p>}
      <dl className="facts oc-facts">
        <div><dt>{L.type}</dt><dd>{type ? dn(type) : unit.typeName}</dd></div>
        <div><dt>{L.budgetSection}</dt><dd>{type?.inBudgeting ? L.yes : L.no}</dd></div>
        <div><dt>{L.children}</dt><dd className="num">{unit.childCount}</dd></div>
        <div><dt>{L.ccs}</dt><dd className="num">{unit.costCenterCount}</dd></div>
      </dl>
      {unit.description && <p className="small mb-8">{unit.description}</p>}
      <h4 className="oc-h4">{L.ccs}</h4>
      {costCenters.length === 0 ? <p className="muted small">{L.noCcs}</p> : (
        <ul className="mini-list">
          {costCenters.map((c) => (
            <li key={c.id} className={c.isActive ? '' : 'muted'}>
              <span><span className="acc-code">{c.code}</span>{c.name}</span>
              <span className="muted">{c.ownerName ?? '—'}{!c.isActive && ` · ${L.inactive}`}</span>
            </li>
          ))}
        </ul>
      )}
      <h4 className="oc-h4">{L.children}</h4>
      {children.length === 0 ? <p className="muted small">{L.noChildren}</p> : (
        <ul className="mini-list oc-kids">
          {children.map((c) => (
            <li key={c.id} className={c.isActive ? '' : 'muted'}>
              <button type="button" className="oc-link" onClick={() => onSelect(c.id)}><span className="acc-code">{c.code}</span>{dn(c)}</button>
              <span className="muted">{c.headName ?? '—'}{!c.isActive && ` · ${L.inactive}`}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
