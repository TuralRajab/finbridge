import { useMemo, useState } from 'react';
import type { BudgetDetailDto, BudgetLineDto, PlanningComparisonDto, PlanningRow } from '@finbridge/shared';
import { api, qs } from '../../api/client';
import { Sparkline } from '../../components/charts/Sparkline';
import { Alert, Button, ErrorMessage, Field, Icon, Input, Modal, Select, Spinner } from '../../components/ui';
import { fmt, useI18n, useLocal } from '../../i18n';
import { money, parseAmount } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { Delta, DetailedError, sum } from './budgetUi';
import { PctDelta } from './PlanningTab';
import '../../styles/planning.css';

/* ------------------------------------------------------------------ texts */

const az = {
  refTitle: 'Müqayisə sütunları:',
  refActual: 'Keçən il fakt',
  refBudget: 'Keçən il büdcə',
  refDelta: 'Δ% plan / fakt',
  refSpark: 'Aylıq trend',
  colActual: 'Fakt {year}',
  colForecast: 'Fakt/proqnoz {year}',
  colBudget: 'Büdcə {year}',
  colDelta: 'Δ% plan / fakt',
  colSpark: 'Trend',
  sparkLabel: '{line}: {year} faktı (sütunlar) və plan (xətt) aylar üzrə',
  noRef: 'Keçən il üzrə məlumat yoxdur',
  refError: 'Keçən ilin məlumatı yüklənmədi.',
  partialHint: '{year} ili natamamdır ({n} ay fakt): qalan aylar üçün büdcə götürülür.',
  fill: 'Keçən ilin faktından doldur (+x%)',
  fillTitle: 'Keçən ilin faktından doldur',
  fillDirty: 'Əvvəlcə yadda saxlanmamış dəyişiklikləri saxlayın və ya ləğv edin.',
  fillNoEdit: 'Redaktə edilə bilən sətir yoxdur.',
  fillIntro: 'Seçilmiş sətirlərin aylıq məbləğləri {year} ilinin faktı əsasında, göstərilən faizlə dəyişdirilmiş şəkildə yenidən hesablanır. Saxlamadan əvvəl dəyişiklikləri yoxlayın.',
  fillPartial: '{year} ili natamamdır: {n} ay üçün fakt, qalan aylar üçün yekun büdcə götürülür.',
  pct: 'Dəyişiklik, %',
  pctHint: 'Məs. 5 = +5%, −3 = −3%',
  rounding: 'Yuvarlaqlaşdırma',
  round1: '1 AZN',
  round10: '10 AZN',
  round100: '100 AZN',
  target: 'Sətirlər',
  targetSelected: 'Seçilmiş sətirlər ({n})',
  targetVisible: 'Ekranda görünən sətirlər ({n})',
  line: 'Sətir',
  current: 'Cari plan',
  proposed: 'Yeni plan',
  change: 'Fərq',
  total: 'Cəmi',
  skipped: '{n} sətir buraxılır: keçən il faktı yoxdur, redaktə bağlıdır və ya eyni hesab üzrə bir neçə sətir var.',
  nothing: 'Doldurula bilən sətir yoxdur.',
  apply: '{n} sətri yadda saxla',
  cancel: 'Ləğv et',
  invalidPct: 'Faiz düzgün deyil.',
  selectLine: 'Sətri seç: {line}',
  selectAll: 'Görünən redaktə edilə bilən sətirlərin hamısını seç',
  selectedN: '{n} sətir seçilib',
  clearSel: 'Seçimi təmizlə',
};
const TEXT = {
  az,
  en: {
    refTitle: 'Reference columns:',
    refActual: 'Last year actual',
    refBudget: 'Last year budget',
    refDelta: 'Δ% plan / actual',
    refSpark: 'Monthly trend',
    colActual: 'Actual {year}',
    colForecast: 'Actual/forecast {year}',
    colBudget: 'Budget {year}',
    colDelta: 'Δ% plan / actual',
    colSpark: 'Trend',
    sparkLabel: '{line}: {year} actual (columns) and plan (line) by month',
    noRef: 'No data for last year',
    refError: 'Last year\'s data could not be loaded.',
    partialHint: '{year} is not complete ({n} months of actuals): the budget is used for the remaining months.',
    fill: 'Fill from last year\'s actual (+x%)',
    fillTitle: 'Fill from last year\'s actual',
    fillDirty: 'Save or discard your unsaved changes first.',
    fillNoEdit: 'There are no editable lines.',
    fillIntro: 'The monthly amounts of the chosen lines are recalculated from the {year} actuals, adjusted by the percentage below. Review the changes before saving.',
    fillPartial: '{year} is not complete: actuals are used for {n} months and the final budget for the remaining months.',
    pct: 'Change, %',
    pctHint: 'E.g. 5 = +5%, −3 = −3%',
    rounding: 'Rounding',
    round1: '1 AZN',
    round10: '10 AZN',
    round100: '100 AZN',
    target: 'Lines',
    targetSelected: 'Selected lines ({n})',
    targetVisible: 'Lines currently shown ({n})',
    line: 'Line',
    current: 'Current plan',
    proposed: 'New plan',
    change: 'Change',
    total: 'Total',
    skipped: '{n} lines are skipped: no actual last year, editing closed, or several lines on the same account.',
    nothing: 'There are no lines that can be filled.',
    apply: 'Save {n} lines',
    cancel: 'Cancel',
    invalidPct: 'Invalid percentage.',
    selectLine: 'Select line: {line}',
    selectAll: 'Select all visible editable lines',
    selectedN: '{n} lines selected',
    clearSel: 'Clear selection',
  } satisfies typeof az,
};
export type RefTexts = typeof az;
export function useRefTexts(): RefTexts { return useLocal(TEXT); }

/* ------------------------------------------------------------------ reference data */

export interface RefCols { actual: boolean; budget: boolean; delta: boolean; spark: boolean }
const REF_KEY = 'finbridge.budgetLines.refCols';

export function useRefCols(): [RefCols, (c: RefCols) => void] {
  const [cols, setCols] = useState<RefCols>(() => {
    try {
      const raw = localStorage.getItem(REF_KEY);
      if (raw) return { actual: false, budget: false, delta: false, spark: false, ...JSON.parse(raw) };
    } catch { /* storage unavailable */ }
    return { actual: true, budget: false, delta: true, spark: false };
  });
  const set = (c: RefCols) => {
    setCols(c);
    try { localStorage.setItem(REF_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  };
  return [cols, set];
}

export interface LineRefs {
  data: PlanningComparisonDto | null;
  error: unknown;
  loading: boolean;
  byKey: Map<string, PlanningRow>;
  /** cost center × account keys that have more than one plan line (fill helper skips them). */
  duplicates: Set<string>;
}
export const lineKey = (l: { costCenterId: number | null; accountId: number | null }) => `${l.costCenterId}:${l.accountId}`;

export function useLineRefs(detail: BudgetDetailDto, lines: BudgetLineDto[], enabled: boolean, reloadKey: number): LineRefs {
  const { data, error, loading } = useAsync(
    () => (enabled ? api<PlanningComparisonDto>('GET', `/budgets/${detail.id}/planning${qs({ versionId: detail.version.id, groupBy: 'line', years: 1 })}`) : Promise.resolve(null)),
    [detail.id, detail.version.id, enabled, reloadKey],
  );
  const byKey = useMemo(() => new Map((data?.rows ?? []).map((r) => [lineKey(r), r])), [data]);
  const duplicates = useMemo(() => {
    const n = new Map<string, number>();
    lines.forEach((l) => n.set(lineKey(l), (n.get(lineKey(l)) ?? 0) + 1));
    return new Set([...n.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [lines]);
  return { data, error, loading, byKey, duplicates };
}

export function RefToggles({ cols, setCols, refs, T }: { cols: RefCols; setCols: (c: RefCols) => void; refs: LineRefs; T: RefTexts }) {
  const info = refs.data?.years[0];
  const box = (k: keyof RefCols, label: string) => (
    <label><input type="checkbox" checked={cols[k]} onChange={(e) => setCols({ ...cols, [k]: e.target.checked })} />{label}</label>
  );
  return (
    <div className="pc-ref-toggles" role="group" aria-label={T.refTitle}>
      <span className="pc-ref-title">{T.refTitle}</span>
      {box('actual', T.refActual)}{box('budget', T.refBudget)}{box('delta', T.refDelta)}{box('spark', T.refSpark)}
      {info && !info.complete && (cols.actual || cols.delta || cols.spark) && <span className="muted">{fmt(T.partialHint, { year: info.year, n: info.monthsWithActuals })}</span>}
      {refs.error ? <span className="muted">{T.refError}</span> : null}
    </div>
  );
}

export function refHeaders(cols: RefCols, refs: LineRefs, T: RefTexts) {
  const info = refs.data?.years[0];
  const year = info?.year ?? '';
  const out: { key: string; label: string }[] = [];
  if (cols.actual) out.push({ key: 'actual', label: fmt(info && !info.complete ? T.colForecast : T.colActual, { year }) });
  if (cols.budget) out.push({ key: 'budget', label: fmt(T.colBudget, { year }) });
  if (cols.delta) out.push({ key: 'delta', label: T.colDelta });
  if (cols.spark) out.push({ key: 'spark', label: T.colSpark });
  return out;
}

/** Reference cells for one grid row (or the totals row when `months` is the sum and `rows` the refs of all visible lines). */
export function RefCells({ cols, refs, rows, months, label, T }: {
  cols: RefCols; refs: LineRefs; rows: (PlanningRow | undefined)[]; months: number[]; label: string; T: RefTexts;
}) {
  const { locale } = useI18n();
  const known = rows.filter((r): r is PlanningRow => !!r);
  const has = known.length > 0;
  const full = sum(known.map((r) => r.years[0]?.fullYear ?? 0));
  const budget = sum(known.map((r) => r.years[0]?.finalBudget ?? 0));
  const plan = sum(months);
  const abs = Math.round((plan - full) * 100) / 100;
  const info = refs.data?.years[0];
  const lastMonths = Array.from({ length: 12 }, (_, i) => sum(known.map((r) => r.lastYearMonths?.[i] ?? 0)));
  let first = true;
  const cls = () => { const c = `r num pc-ref${first ? ' pc-ref-first' : ''}`; first = false; return c; };
  const none = <span className="muted" title={T.noRef}>—</span>;
  return (
    <>
      {cols.actual && <td className={cls()}>{has ? money(full, locale) : none}</td>}
      {cols.budget && <td className={cls()}>{has ? money(budget, locale) : none}</td>}
      {cols.delta && <td className={cls()}>{has ? <PctDelta d={{ abs, pct: full === 0 ? null : Math.round((abs / full) * 1000) / 10 }} /> : none}</td>}
      {cols.spark && <td className={cls()}>{has
        ? <Sparkline reference={lastMonths} plan={months} label={fmt(T.sparkLabel, { line: label, year: info?.year ?? '' })} />
        : none}</td>}
    </>
  );
}

/* ------------------------------------------------------------------ fill helper */

export function FillFromLastYearModal({ detail, selected, visible, refs, T, onClose, onSaved }: {
  detail: BudgetDetailDto; selected: BudgetLineDto[]; visible: BudgetLineDto[]; refs: LineRefs; T: RefTexts;
  onClose: () => void; onSaved: (lines: BudgetLineDto[]) => void;
}) {
  const { locale } = useI18n();
  const [pctText, setPctText] = useState('5');
  const [rounding, setRounding] = useState(10);
  const [target, setTarget] = useState<'selected' | 'visible'>(selected.length ? 'selected' : 'visible');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const p = parseAmount(pctText);
  const validPct = p !== null && p > -100 && p <= 1000;
  const info = refs.data?.years[0];
  const pool = target === 'selected' ? selected : visible;

  const changes = useMemo(() => {
    if (!validPct) return [];
    const out: { line: BudgetLineDto; months: number[]; before: number; after: number }[] = [];
    for (const l of pool) {
      if (!l.canEdit || refs.duplicates.has(lineKey(l))) continue;
      const ref = refs.byKey.get(lineKey(l));
      const base = ref?.lastYearMonths;
      if (!base || base.every((v) => v === 0)) continue;
      const months = base.map((v) => Math.round((v * (1 + p! / 100)) / rounding) * rounding);
      const after = sum(months);
      if (months.every((v, i) => v === l.months[i])) continue;
      out.push({ line: l, months, before: l.total, after });
    }
    return out;
  }, [pool, refs, p, validPct, rounding]);
  const skipped = pool.length - changes.length;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const updated = await api<BudgetLineDto[]>('PATCH', `/budgets/${detail.id}/lines`, { lines: changes.map((c) => ({ id: c.line.id, months: c.months })) });
      onSaved(updated);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const before = sum(changes.map((c) => c.before));
  const after = sum(changes.map((c) => c.after));
  return (
    <Modal wide title={T.fillTitle} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{T.cancel}</Button>
      <Button variant="primary" busy={busy} disabled={!changes.length || !validPct} onClick={save}><Icon name="check" /> {fmt(T.apply, { n: changes.length })}</Button>
    </>}>
      <p className="mb-8">{fmt(T.fillIntro, { year: info?.year ?? '' })}</p>
      {info && !info.complete && <Alert kind="info">{fmt(T.fillPartial, { year: info.year, n: info.monthsWithActuals })}</Alert>}
      <div className="pc-fill-opts">
        <Field label={T.pct} hint={T.pctHint} error={validPct ? undefined : T.invalidPct}>
          {(id) => <Input id={id} inputMode="decimal" value={pctText} onChange={(e) => setPctText(e.target.value)} />}
        </Field>
        <Field label={T.rounding}>
          {(id) => <Select id={id} value={rounding} onChange={(e) => setRounding(Number(e.target.value))}
            options={[{ value: 1, label: T.round1 }, { value: 10, label: T.round10 }, { value: 100, label: T.round100 }]} />}
        </Field>
        <Field label={T.target}>
          {(id) => <Select id={id} value={target} onChange={(e) => setTarget(e.target.value as 'selected' | 'visible')}
            options={[
              ...(selected.length ? [{ value: 'selected', label: fmt(T.targetSelected, { n: selected.length }) }] : []),
              { value: 'visible', label: fmt(T.targetVisible, { n: visible.length }) },
            ]} />}
        </Field>
      </div>
      {refs.data && skipped > 0 && <p className="small muted">{fmt(T.skipped, { n: skipped })}</p>}
      {refs.error ? <ErrorMessage error={refs.error} /> : !refs.data ? <Spinner /> : changes.length === 0 ? <Alert kind="warning">{T.nothing}</Alert> : (
        <div className="pc-fill-preview">
          <table className="table">
            <thead><tr><th>{T.line}</th><th className="r">{T.current}</th><th className="r">{T.proposed}</th><th className="r">{T.change}</th></tr></thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.line.id}>
                  <td><b>{c.line.costCenterCode}</b> <span className="acc-code">{c.line.accountCode}</span> <span className="small">{c.line.accountName}</span></td>
                  <td className="r num">{money(c.before, locale)}</td>
                  <td className="r num"><b>{money(c.after, locale)}</b></td>
                  <td className="r num"><Delta value={c.after - c.before} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><b>{T.total}</b></td>
              <td className="r num"><b>{money(before, locale)}</b></td>
              <td className="r num"><b>{money(after, locale)}</b></td>
              <td className="r num"><Delta value={after - before} strong /></td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <DetailedError error={error} />
    </Modal>
  );
}
