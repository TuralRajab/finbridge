/**
 * Shared building blocks of the workflow-engine pages (definitions list, builder, preview):
 * human-readable condition summaries, the visual condition builder, approver-type texts,
 * reference data for pickers and the client-side rule context used by the live preview.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  APPROVER_TYPES, COMPANY_ROLES, CONDITION_FIELDS, NUMERIC_FIELDS, REQUEST_TYPES, VERSION_KINDS,
  type AccountDto, type ApproverConfig, type ApproverType, type Condition, type ConditionField, type ConditionOp,
  type JobFamilyDto, type OrgUnitTypeDto, type PositionDto, type Rule, type RuleContext, type WorkflowPreviewDto, type WorkflowStepDto,
} from '@finbridge/shared';
import { api, ApiError } from '../../api/client';
import { useI18n, useLocal, type TKey } from '../../i18n';
import { money, parseAmount } from '../../lib/format';
import { treeOptions, useMasterData, type MasterData } from '../../lib/masterdata';
import { useAsync } from '../../lib/useAsync';
import { Button, errorText, Icon, Input, Select } from '../../components/ui';

/* ------------------------------------------------------------------ texts */

const az = {
  field: {
    amount: 'Məbləğ', orgUnit: 'Struktur vahidi', department: 'Departament', branch: 'Filial', costCenter: 'Xərc mərkəzi',
    account: 'Hesab', expenseClass: 'Xərc sinfi', requestType: 'Sorğu növü', budgetKind: 'Versiya növü', industry: 'Sənaye kodu',
  } as Record<ConditionField, string>,
  op: {
    eq: 'bərabərdir (=)', neq: 'bərabər deyil (≠)', in: 'siyahıdadır (∈)', notIn: 'siyahıda deyil (∉)',
    gt: 'böyükdür (>)', gte: 'böyük və ya bərabər (≥)', lt: 'kiçikdir (<)', lte: 'kiçik və ya bərabər (≤)',
  } as Record<ConditionOp, string>,
  and: 'və', or: 'və ya', not: 'DEYİL',
  always: 'Həmişə (şərtsiz)',
  matchAll: 'Bütün şərtlər ödənməlidir (VƏ)',
  matchAny: 'Ən azı bir şərt ödənməlidir (VƏ YA)',
  negate: 'Qrupu inkar et (DEYİL)',
  addRule: 'Şərt əlavə et',
  addGroup: 'Qrup əlavə et',
  removeRule: 'Şərti sil',
  removeGroup: 'Qrupu sil',
  noRules: 'Şərt yoxdur — qayda hər sənədə tətbiq olunur.',
  noRulesStep: 'Şərt yoxdur — mərhələ həmişə tətbiq olunur.',
  fieldLabel: 'Sahə',
  opLabel: 'Müqayisə',
  valueLabel: 'Dəyər',
  addValue: 'Dəyər əlavə et…',
  removeValue: 'Dəyəri çıxar: {v}',
  industryHint: 'Kodları vergüllə ayırın',
  explain: {
    SPECIFIC_USER: 'Seçilmiş konkret istifadəçi təsdiqləyir.',
    ROLE: 'Seçilmiş rolda olan bütün aktiv istifadəçilər; birinin təsdiqi kifayətdir.',
    CEO: 'CEO rolunda olan istifadəçi.',
    CFO: 'CFO rolunda olan istifadəçi.',
    FINANCE_MANAGER: 'Maliyyə meneceri rolunda olan istifadəçilər.',
    DEPARTMENT_HEAD: 'Sənədin aid olduğu vahidin yuxarısında seçilmiş növdə (standart: Departament) olan ilk vahidin rəhbəri.',
    ORG_UNIT_OWNER: 'Sənədin struktur vahidinin rəhbəri (yoxdursa, ən yaxın yuxarı vahidin rəhbəri).',
    EXECUTIVE: 'Şirkətdən sonrakı ən yuxarı səviyyəli vahidin (kurator direktorluğun) rəhbəri.',
    COST_CENTER_OWNER: 'Xərc mərkəzinin büdcə sahibi.',
    COST_CENTER_RESPONSIBLE: 'Xərc mərkəzinin məsul şəxsi (təyin edilməyibsə, sahibi).',
    JOB_FAMILY_OWNER: 'Seçilmiş peşə ailəsinin sahibi; seçilməyibsə, sorğu edənin peşə ailəsinin sahibi.',
    POSITION_HOLDER: 'Seçilmiş ştat vahidini (vəzifəni) tutan şəxs.',
    DYNAMIC_MANAGER: 'Sorğu edənin birbaşa rəhbəri (istifadəçi kartındakı rəhbər).',
  } as Record<ApproverType, string>,
  cfgUser: 'İstifadəçi',
  cfgRole: 'Rol',
  cfgUnitType: 'Vahid növü',
  cfgUnitTypeHint: 'Boş qalsa, Departament növü götürülür.',
  cfgJobFamily: 'Peşə ailəsi',
  cfgJobFamilyAny: 'Sorğu edənin peşə ailəsi',
  cfgPosition: 'Ştat vahidi (vəzifə)',
  cfgCodeOnly: 'kod: {code}',
  noHolder: 'tutulmayıb',
  serverIssue: '{path}: {msg}',
  step: 'Mərhələ {n}',
};
const en: typeof az = {
  field: {
    amount: 'Amount', orgUnit: 'Org unit', department: 'Department', branch: 'Branch', costCenter: 'Cost center',
    account: 'Account', expenseClass: 'Expense class', requestType: 'Request type', budgetKind: 'Version kind', industry: 'Industry code',
  },
  op: {
    eq: 'equals (=)', neq: 'does not equal (≠)', in: 'is one of (∈)', notIn: 'is not one of (∉)',
    gt: 'greater than (>)', gte: 'at least (≥)', lt: 'less than (<)', lte: 'at most (≤)',
  },
  and: 'and', or: 'or', not: 'NOT',
  always: 'Always (no conditions)',
  matchAll: 'All conditions must match (AND)',
  matchAny: 'At least one condition must match (OR)',
  negate: 'Negate group (NOT)',
  addRule: 'Add condition',
  addGroup: 'Add group',
  removeRule: 'Remove condition',
  removeGroup: 'Remove group',
  noRules: 'No conditions — the definition applies to every item.',
  noRulesStep: 'No conditions — the step always applies.',
  fieldLabel: 'Field',
  opLabel: 'Comparison',
  valueLabel: 'Value',
  addValue: 'Add value…',
  removeValue: 'Remove value: {v}',
  industryHint: 'Separate codes with commas',
  explain: {
    SPECIFIC_USER: 'The selected user approves.',
    ROLE: 'All active users with the selected role; one approval is enough.',
    CEO: 'The user with the CEO role.',
    CFO: 'The user with the CFO role.',
    FINANCE_MANAGER: 'Users with the Finance manager role.',
    DEPARTMENT_HEAD: 'Head of the nearest unit of the selected type (default: Department) above the item.',
    ORG_UNIT_OWNER: 'Head of the item\'s org unit (or of the nearest parent unit that has a head).',
    EXECUTIVE: 'Head of the top-level unit (executive area) below the company.',
    COST_CENTER_OWNER: 'Budget owner of the cost center.',
    COST_CENTER_RESPONSIBLE: 'Responsible person of the cost center (falls back to its owner).',
    JOB_FAMILY_OWNER: 'Owner of the selected job family; if none is selected, of the requester\'s job family.',
    POSITION_HOLDER: 'The person holding the selected position.',
    DYNAMIC_MANAGER: 'The requester\'s line manager (from the user record).',
  },
  cfgUser: 'User',
  cfgRole: 'Role',
  cfgUnitType: 'Unit type',
  cfgUnitTypeHint: 'Defaults to the Department type when empty.',
  cfgJobFamily: 'Job family',
  cfgJobFamilyAny: 'Requester\'s job family',
  cfgPosition: 'Position',
  cfgCodeOnly: 'code: {code}',
  noHolder: 'vacant',
  serverIssue: '{path}: {msg}',
  step: 'Step {n}',
};
export const WF_TEXT = { az, en };
export type WfText = typeof az;
export function useWfText(): WfText { return useLocal(WF_TEXT); }

export const OP_SYMBOL: Record<ConditionOp, string> = { eq: '=', neq: '≠', in: '∈', notIn: '∉', gt: '>', gte: '≥', lt: '<', lte: '≤' };
export const NUMERIC_OPS: ConditionOp[] = ['gte', 'gt', 'lte', 'lt', 'eq', 'neq'];
export const CODE_OPS: ConditionOp[] = ['in', 'notIn', 'eq', 'neq'];
export const opsFor = (f: ConditionField): ConditionOp[] => (NUMERIC_FIELDS.includes(f) ? NUMERIC_OPS : CODE_OPS);
export const isMultiOp = (op: ConditionOp) => op === 'in' || op === 'notIn';

/* ------------------------------------------------------------------ reference data */

export interface WfRefs extends MasterData {
  types: OrgUnitTypeDto[];
  jobFamilies: JobFamilyDto[];
  positions: PositionDto[];
}

export function useWfRefs() {
  const md = useMasterData({ users: true });
  const extra = useAsync(async () => {
    const [types, jobFamilies, positions] = await Promise.all([
      api<OrgUnitTypeDto[]>('GET', '/org/types'),
      api<JobFamilyDto[]>('GET', '/org/job-families'),
      api<PositionDto[]>('GET', '/org/positions'),
    ]);
    return { types, jobFamilies, positions };
  }, []);
  const data: WfRefs | null = md.data && extra.data ? { ...md.data, ...extra.data } : null;
  return { data, error: md.error ?? extra.error, loading: md.loading || extra.loading };
}

/* ------------------------------------------------------------------ summaries */

function valueText(field: ConditionField, v: string | number, locale: string, t: (k: TKey) => string): string {
  if (field === 'amount') return money(Number(v), locale);
  if (field === 'requestType' && (REQUEST_TYPES as readonly string[]).includes(String(v))) return t(`requestType.${v}` as TKey);
  if (field === 'budgetKind' && (VERSION_KINDS as readonly string[]).includes(String(v))) return t(`versionKind.${v}` as TKey);
  return String(v);
}

export function ruleText(r: Rule, W: WfText, locale: string, t: (k: TKey) => string, withField = true): string {
  const vals = (Array.isArray(r.value) ? r.value : [r.value]).map((v) => valueText(r.field, v, locale, t));
  const shown = vals.length > 4 ? `${vals.slice(0, 4).join(', ')} +${vals.length - 4}` : vals.join(', ');
  return `${withField ? `${W.field[r.field] ?? r.field} ` : ''}${OP_SYMBOL[r.op] ?? r.op} ${shown || '—'}`;
}

/** "Hesab ∈ 701-01 və Məbləğ ≥ 50 000"; null → "" */
export function conditionText(c: Condition | null | undefined, W: WfText, locale: string, t: (k: TKey) => string, nested = false): string {
  if (!c) return '';
  if ('field' in c) return ruleText(c, W, locale, t);
  if ('not' in c) return `${W.not} (${conditionText(c.not, W, locale, t, false)})`;
  const list = 'all' in c ? c.all : c.any;
  const parts = list.map((x) => conditionText(x, W, locale, t, true)).filter(Boolean);
  if (!parts.length) return '';
  const s = parts.join(` ${'all' in c ? W.and : W.or} `);
  return nested && parts.length > 1 ? `(${s})` : s;
}

/** Short chip for step thresholds: a single amount rule shows "≥ 10 000". */
export function stepConditionChip(c: Condition | null | undefined, W: WfText, locale: string, t: (k: TKey) => string): string {
  if (!c) return '';
  const single = 'field' in c ? c : 'all' in c && c.all.length === 1 && 'field' in c.all[0] ? c.all[0] : null;
  if (single && single.field === 'amount') return ruleText(single, W, locale, t, false);
  return conditionText(c, W, locale, t);
}

export function stepsChain(steps: WorkflowStepDto[], W: WfText, locale: string, t: (k: TKey) => string): string {
  return steps.map((s) => {
    const chip = stepConditionChip(s.condition, W, locale, t);
    return chip ? `${s.name} (${chip})` : s.name;
  }).join(' → ');
}

export function approverLabel(type: ApproverType, cfg: ApproverConfig, refs: WfRefs | null, t: (k: TKey) => string): string {
  const base = t(`approverType.${type}` as TKey);
  if (!refs) return base;
  if (type === 'SPECIFIC_USER' && cfg.userId) return `${base}: ${refs.users.find((u) => u.id === cfg.userId)?.fullName ?? `#${cfg.userId}`}`;
  if (type === 'ROLE' && cfg.role) return `${base}: ${t(`roles.${cfg.role}` as TKey)}`;
  if (type === 'POSITION_HOLDER') {
    const p = refs.positions.find((x) => x.id === cfg.positionId || (!cfg.positionId && x.code === cfg.positionCode));
    if (p) return `${base}: ${p.title}`;
  }
  if (type === 'JOB_FAMILY_OWNER' && (cfg.jobFamilyId || cfg.jobFamilyCode)) {
    const j = refs.jobFamilies.find((x) => x.id === cfg.jobFamilyId || (!cfg.jobFamilyId && x.code === cfg.jobFamilyCode));
    if (j) return `${base}: ${j.name}`;
  }
  if (type === 'DEPARTMENT_HEAD' && cfg.unitTypeCode && cfg.unitTypeCode !== 'DEPARTMENT') {
    return `${base}: ${refs.types.find((x) => x.code === cfg.unitTypeCode)?.name ?? cfg.unitTypeCode}`;
  }
  return base;
}

/* ------------------------------------------------------------------ effective state */

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function effectiveState(from: string | null, to: string | null, day = todayIso()): 'current' | 'future' | 'expired' {
  if (from && from > day) return 'future';
  if (to && to < day) return 'expired';
  return 'current';
}

/* ------------------------------------------------------------------ server error details */

interface ZodIssue { path?: (string | number)[]; message?: string }

/** Translated error text plus the server's validation details (zod issues or a specific message). */
export function serverErrorLines(err: unknown, t: (k: TKey) => string, W: WfText): string[] {
  if (!err) return [];
  const head = errorText(err, t);
  if (!(err instanceof ApiError)) return [head];
  const lines = [head];
  if (Array.isArray(err.details)) {
    for (const i of err.details as ZodIssue[]) {
      const path = (i.path ?? []).map((p, idx, arr) => (arr[idx - 1] === 'steps' && typeof p === 'number' ? W.step.replace('{n}', String(p + 1)) : String(p)))
        .filter((p) => p !== 'steps').join(' · ');
      lines.push(W.serverIssue.replace('{path}', path || '—').replace('{msg}', i.message ?? ''));
    }
  } else if (err.message && err.message !== head && err.message !== 'Invalid input') {
    lines.push(err.message);
  }
  return lines;
}

export function ServerErrors({ error }: { error: unknown }) {
  const { t } = useI18n();
  const W = useWfText();
  const lines = serverErrorLines(error, t, W);
  if (!lines.length) return null;
  return (
    <div className="alert alert-error" role="alert">
      {lines[0]}
      {lines.length > 1 && <ul className="error-list">{lines.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}

/* ------------------------------------------------------------------ option lists */

export function codeOptions(field: ConditionField, refs: WfRefs | null, t: (k: TKey) => string, lang: string): { value: string; label: string }[] {
  const nm = (r: { name: string; nameEn?: string | null }) => (lang === 'en' && r.nameEn ? r.nameEn : r.name);
  switch (field) {
    case 'expenseClass': return ['OPEX', 'CAPEX'].map((v) => ({ value: v, label: t(`expenseClass.${v}` as TKey) }));
    case 'requestType': return REQUEST_TYPES.map((v) => ({ value: v, label: t(`requestType.${v}` as TKey) }));
    case 'budgetKind': return VERSION_KINDS.map((v) => ({ value: v, label: t(`versionKind.${v}` as TKey) }));
    default: break;
  }
  if (!refs) return [];
  switch (field) {
    case 'orgUnit': return treeOptions(refs.units, nm).map((o) => ({ value: o.row.code, label: o.label }));
    case 'department': return treeOptions(refs.units, nm, (u) => u.typeCode === 'DEPARTMENT').map((o) => ({ value: o.row.code, label: o.label.trim() }));
    case 'branch': return treeOptions(refs.units, nm, (u) => u.typeCode === 'BRANCH').map((o) => ({ value: o.row.code, label: o.label.trim() }));
    case 'costCenter': return [...refs.costCenters].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));
    case 'account': return treeOptions(refs.accounts, (a: AccountDto) => nm(a)).map((o) => ({ value: o.row.code, label: o.label }));
    default: return [];
  }
}

/* ------------------------------------------------------------------ condition builder */

interface RuleNode { kind: 'rule'; key: number; rule: Rule }
interface GroupNode { kind: 'group'; key: number; mode: 'all' | 'any'; negate: boolean; children: CNode[] }
type CNode = RuleNode | GroupNode;

let keySeq = 1;
const nextKey = () => keySeq++;

function toNode(c: Condition): CNode {
  if ('field' in c) return { kind: 'rule', key: nextKey(), rule: { ...c } };
  return toGroup(c);
}
function toGroup(c: Condition | null | undefined): GroupNode {
  if (!c) return { kind: 'group', key: nextKey(), mode: 'all', negate: false, children: [] };
  if ('field' in c) return { kind: 'group', key: nextKey(), mode: 'all', negate: false, children: [toNode(c)] };
  if ('not' in c) { const g = toGroup(c.not); return { ...g, negate: !g.negate }; }
  if ('all' in c) return { kind: 'group', key: nextKey(), mode: 'all', negate: false, children: c.all.map(toNode) };
  return { kind: 'group', key: nextKey(), mode: 'any', negate: false, children: c.any.map(toNode) };
}
function fromNode(n: CNode): Condition | null {
  if (n.kind === 'rule') return n.rule;
  const items = n.children.map(fromNode).filter((x): x is Condition => !!x);
  if (!items.length) return null;
  const inner: Condition = n.mode === 'all' ? { all: items } : { any: items };
  return n.negate ? { not: inner } : inner;
}

function defaultRule(field: ConditionField = 'amount'): Rule {
  return NUMERIC_FIELDS.includes(field) ? { field, op: 'gte', value: 0 } : { field, op: 'in', value: [] };
}

/** Visual editor for nested all/any/not groups of field/op/value rules. Keep it keyed by the source record. */
export function ConditionBuilder({ value, onChange, refs, disabled, stepMode }: {
  value: Condition | null; onChange: (c: Condition | null) => void; refs: WfRefs | null; disabled?: boolean; stepMode?: boolean;
}) {
  const W = useWfText();
  const [root, setRoot] = useState<GroupNode>(() => toGroup(value));
  const update = (next: GroupNode) => { setRoot(next); onChange(fromNode(next)); };
  return (
    <div className="cb">
      <GroupEditor node={root} depth={0} refs={refs} disabled={disabled} onChange={(g) => update(g)} />
      {!root.children.length && <p className="muted small cb-empty">{stepMode ? W.noRulesStep : W.noRules}</p>}
    </div>
  );
}

function GroupEditor({ node, depth, onChange, onRemove, refs, disabled }: {
  node: GroupNode; depth: number; onChange: (g: GroupNode) => void; onRemove?: () => void; refs: WfRefs | null; disabled?: boolean;
}) {
  const W = useWfText();
  const setChild = (i: number, c: CNode | null) => {
    const children = [...node.children];
    if (c) children[i] = c; else children.splice(i, 1);
    onChange({ ...node, children });
  };
  return (
    <div className={`cb-group${depth ? ' cb-nested' : ''}${node.negate ? ' cb-negated' : ''}`} role="group">
      <div className="cb-group-head">
        <Select aria-label={`${W.matchAll} / ${W.matchAny}`} value={node.mode} disabled={disabled}
          onChange={(e) => onChange({ ...node, mode: e.target.value as 'all' | 'any' })}
          options={[{ value: 'all', label: W.matchAll }, { value: 'any', label: W.matchAny }]} />
        <label className="cb-check">
          <input type="checkbox" checked={node.negate} disabled={disabled} onChange={(e) => onChange({ ...node, negate: e.target.checked })} />
          {W.negate}
        </label>
        {onRemove && !disabled && (
          <button type="button" className="icon-btn cb-remove" onClick={onRemove} aria-label={W.removeGroup} title={W.removeGroup}><Icon name="trash" /></button>
        )}
      </div>
      {node.children.length > 0 && (
        <ol className="cb-items">
          {node.children.map((c, i) => (
            <li key={c.key}>
              {i > 0 && <span className="cb-joiner" aria-hidden="true">{node.mode === 'all' ? W.and : W.or}</span>}
              {c.kind === 'rule'
                ? <RuleEditor rule={c.rule} refs={refs} disabled={disabled} onChange={(r) => setChild(i, { ...c, rule: r })} onRemove={() => setChild(i, null)} />
                : <GroupEditor node={c} depth={depth + 1} refs={refs} disabled={disabled} onChange={(g) => setChild(i, g)} onRemove={() => setChild(i, null)} />}
            </li>
          ))}
        </ol>
      )}
      {!disabled && (
        <div className="cb-add">
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...node, children: [...node.children, { kind: 'rule', key: nextKey(), rule: defaultRule() }] })}>
            <Icon name="plus" /> {W.addRule}
          </Button>
          {depth < 2 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...node, children: [...node.children, { kind: 'group', key: nextKey(), mode: node.mode === 'all' ? 'any' : 'all', negate: false, children: [{ kind: 'rule', key: nextKey(), rule: defaultRule() }] }] })}>
              <Icon name="plus" /> {W.addGroup}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RuleEditor({ rule, onChange, onRemove, refs, disabled }: {
  rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; refs: WfRefs | null; disabled?: boolean;
}) {
  const W = useWfText();
  const setField = (field: ConditionField) => onChange(defaultRule(field));
  const setOp = (op: ConditionOp) => {
    const arr = Array.isArray(rule.value) ? rule.value : rule.value === '' ? [] : [rule.value];
    if (NUMERIC_FIELDS.includes(rule.field)) onChange({ ...rule, op });
    else onChange({ ...rule, op, value: isMultiOp(op) ? arr : String(arr[0] ?? '') });
  };
  return (
    <div className="cb-rule">
      <Select aria-label={W.fieldLabel} value={rule.field} disabled={disabled} onChange={(e) => setField(e.target.value as ConditionField)}
        options={CONDITION_FIELDS.map((f) => ({ value: f, label: W.field[f] }))} />
      <Select aria-label={W.opLabel} value={rule.op} disabled={disabled} onChange={(e) => setOp(e.target.value as ConditionOp)}
        options={(opsFor(rule.field).includes(rule.op) ? opsFor(rule.field) : [rule.op, ...opsFor(rule.field)]).map((o) => ({ value: o, label: W.op[o] }))} />
      <div className="cb-value"><RuleValue rule={rule} refs={refs} disabled={disabled} onChange={(v) => onChange({ ...rule, value: v })} /></div>
      {!disabled && <button type="button" className="icon-btn cb-remove" onClick={onRemove} aria-label={W.removeRule} title={W.removeRule}><Icon name="x" /></button>}
    </div>
  );
}

export function AmountInput({ value, onChange, disabled, label, id }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string; id?: string }) {
  const { locale } = useI18n();
  const [text, setText] = useState(() => money(value, locale, value % 1 ? 2 : 0));
  const parsed = parseAmount(text);
  return (
    <Input id={id} aria-label={id ? undefined : label} inputMode="decimal" className={`r num${parsed === null ? ' invalid' : ''}`} value={text} disabled={disabled}
      onChange={(e) => { setText(e.target.value); const n = parseAmount(e.target.value); if (n !== null) onChange(n); }}
      onBlur={() => { const n = parseAmount(text); if (n !== null) setText(money(n, locale, n % 1 ? 2 : 0)); }} />
  );
}

function RuleValue({ rule, onChange, refs, disabled }: { rule: Rule; onChange: (v: Rule['value']) => void; refs: WfRefs | null; disabled?: boolean }) {
  const W = useWfText();
  const { t, lang } = useI18n();
  const options = useMemo(() => codeOptions(rule.field, refs, t, lang), [rule.field, refs, t, lang]);
  if (NUMERIC_FIELDS.includes(rule.field)) {
    const n = Number(Array.isArray(rule.value) ? rule.value[0] : rule.value) || 0;
    return <AmountInput label={W.valueLabel} value={n} disabled={disabled} onChange={onChange} />;
  }
  if (rule.field === 'industry') {
    const text = Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? '');
    return (
      <Input aria-label={W.valueLabel} placeholder={W.industryHint} value={text} disabled={disabled}
        onChange={(e) => {
          const parts = e.target.value.split(',').map((s) => s.trim().toUpperCase());
          onChange(isMultiOp(rule.op) ? parts.filter((p, i) => p || i === parts.length - 1) : e.target.value.trim().toUpperCase());
        }} />
    );
  }
  if (!isMultiOp(rule.op)) {
    const v = String(Array.isArray(rule.value) ? rule.value[0] ?? '' : rule.value ?? '');
    const opts = v && !options.some((o) => o.value === v) ? [{ value: v, label: v }, ...options] : options;
    return <Select aria-label={W.valueLabel} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: '—' }, ...opts]} />;
  }
  const vals = (Array.isArray(rule.value) ? rule.value : rule.value === '' ? [] : [rule.value]).map(String);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label.trim().split(' · ')[0] ?? v;
  return (
    <div className="cb-multi">
      {vals.map((v) => (
        <span key={v} className="cb-chip" title={options.find((o) => o.value === v)?.label.trim()}>
          {labelOf(v)}
          {!disabled && (
            <button type="button" aria-label={W.removeValue.replace('{v}', v)} onClick={() => onChange(vals.filter((x) => x !== v))}>×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <Select aria-label={W.addValue} value="" className="cb-add-select"
          onChange={(e) => { if (e.target.value && !vals.includes(e.target.value)) onChange([...vals, e.target.value]); }}
          options={[{ value: '', label: W.addValue }, ...options.filter((o) => !vals.includes(o.value))]} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ approver config */

export function ApproverFields({ type, config, onChange, refs, disabled, idPrefix }: {
  type: ApproverType; config: ApproverConfig; onChange: (c: ApproverConfig) => void; refs: WfRefs | null; disabled?: boolean; idPrefix: string;
}) {
  const W = useWfText();
  const { t } = useI18n();
  if (!refs) return null;
  const field = (label: string, node: (id: string) => ReactNode, hint?: string) => {
    const id = `${idPrefix}-${label}`;
    return <div className="field"><label htmlFor={id}>{label}</label>{node(id)}{hint && <small className="hint">{hint}</small>}</div>;
  };
  switch (type) {
    case 'SPECIFIC_USER':
      return field(W.cfgUser, (id) => (
        <Select id={id} value={config.userId ?? ''} disabled={disabled} onChange={(e) => onChange({ userId: e.target.value ? Number(e.target.value) : undefined })}
          options={[{ value: '', label: t('common.select') }, ...refs.users.filter((u) => u.isActive || u.id === config.userId)
            .sort((a, b) => a.fullName.localeCompare(b.fullName)).map((u) => ({ value: u.id, label: `${u.fullName} · ${t(`roles.${u.role}` as TKey)}` }))]} />
      ));
    case 'ROLE':
      return field(W.cfgRole, (id) => (
        <Select id={id} value={config.role ?? ''} disabled={disabled} onChange={(e) => onChange({ role: e.target.value || undefined })}
          options={[{ value: '', label: t('common.select') }, ...COMPANY_ROLES.map((r) => ({ value: r, label: t(`roles.${r}` as TKey) }))]} />
      ));
    case 'DEPARTMENT_HEAD':
      return field(W.cfgUnitType, (id) => (
        <Select id={id} value={config.unitTypeCode ?? ''} disabled={disabled} onChange={(e) => onChange({ unitTypeCode: e.target.value || undefined })}
          options={[{ value: '', label: refs.types.find((x) => x.code === 'DEPARTMENT')?.name ?? 'DEPARTMENT' },
            ...refs.types.filter((x) => x.code !== 'DEPARTMENT').map((x) => ({ value: x.code, label: x.name }))]} />
      ), W.cfgUnitTypeHint);
    case 'JOB_FAMILY_OWNER': {
      const cur = config.jobFamilyId ?? refs.jobFamilies.find((j) => j.code === config.jobFamilyCode)?.id;
      return field(W.cfgJobFamily, (id) => (
        <Select id={id} value={cur ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? { jobFamilyId: Number(e.target.value) } : {})}
          options={[{ value: '', label: W.cfgJobFamilyAny }, ...refs.jobFamilies.map((j) => ({ value: j.id, label: `${j.code} · ${j.name}${j.ownerName ? ` (${j.ownerName})` : ''}` }))]} />
      ), !cur && config.jobFamilyCode ? W.cfgCodeOnly.replace('{code}', config.jobFamilyCode) : undefined);
    }
    case 'POSITION_HOLDER': {
      const cur = config.positionId ?? refs.positions.find((p) => p.code === config.positionCode)?.id;
      return field(W.cfgPosition, (id) => (
        <Select id={id} value={cur ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? { positionId: Number(e.target.value) } : {})}
          options={[{ value: '', label: t('common.select') }, ...refs.positions.filter((p) => p.isActive || p.id === cur)
            .map((p) => ({ value: p.id, label: `${p.code} · ${p.title} (${p.holderName ?? W.noHolder})` }))]} />
      ), !cur && config.positionCode ? W.cfgCodeOnly.replace('{code}', config.positionCode) : undefined);
    }
    default:
      return null;
  }
}

export const approverTypeOptions = (t: (k: TKey) => string) => APPROVER_TYPES.map((a) => ({ value: a, label: t(`approverType.${a}` as TKey) }));

/* ------------------------------------------------------------------ client-side rule context (live preview of unsaved drafts) */

export interface SampleInput {
  amount: number;
  costCenterId: number | null;
  orgUnitId: number | null;
  accountId: number | null;
  requestType: 'PURCHASE' | 'EXPENSE' | '';
  budgetKind: (typeof VERSION_KINDS)[number] | '';
}
export const EMPTY_SAMPLE: SampleInput = { amount: 0, costCenterId: null, orgUnitId: null, accountId: null, requestType: '', budgetKind: '' };

/** Mirrors the server's preview context (OrgIndex.ruleContextForUnit + AccountIndex.ruleContext). */
export function sampleContext(s: SampleInput, refs: WfRefs, industry: string | null): RuleContext {
  const unitById = new Map(refs.units.map((u) => [u.id, u]));
  const cc = s.costCenterId ? refs.costCenters.find((c) => c.id === s.costCenterId) : undefined;
  const rootUnit = refs.units.find((u) => u.parentId === null);
  const unitId = cc ? cc.orgUnitId : s.orgUnitId ?? rootUnit?.id ?? null;
  const chain: typeof refs.units = [];
  const seen = new Set<number>();
  for (let u = unitId ? unitById.get(unitId) : undefined; u && !seen.has(u.id); u = u.parentId ? unitById.get(u.parentId) : undefined) { seen.add(u.id); chain.push(u); }
  const ctx: RuleContext = {
    orgUnit: chain.map((u) => u.code),
    department: chain.find((u) => u.typeCode === 'DEPARTMENT')?.code ?? null,
    branch: chain.find((u) => u.typeCode === 'BRANCH')?.code ?? null,
    amount: s.amount, requestType: s.requestType || null, budgetKind: s.budgetKind || null,
    costCenter: cc ? [cc.code] : [], industry,
  };
  if (s.accountId) {
    const accById = new Map(refs.accounts.map((a) => [a.id, a]));
    const accChain: AccountDto[] = [];
    const seenA = new Set<number>();
    for (let a = accById.get(s.accountId); a && !seenA.has(a.id); a = a.parentId ? accById.get(a.parentId) : undefined) { seenA.add(a.id); accChain.push(a); }
    ctx.account = accChain.map((a) => a.code);
    ctx.expenseClass = accChain.find((a) => a.expenseClass)?.expenseClass ?? null;
  }
  return ctx;
}

export function previewBody(s: SampleInput) {
  return {
    amount: s.amount,
    ...(s.costCenterId ? { costCenterId: s.costCenterId } : {}),
    ...(s.orgUnitId && !s.costCenterId ? { orgUnitId: s.orgUnitId } : {}),
    ...(s.accountId ? { accountId: s.accountId } : {}),
    ...(s.requestType ? { requestType: s.requestType } : {}),
    ...(s.budgetKind ? { budgetKind: s.budgetKind } : {}),
  };
}

const sampleAz = {
  amount: 'Məbləğ (baza valyutası)',
  ccHint: 'Xərc mərkəzi seçilibsə, struktur vahidi ondan götürülür.',
  rootUnit: 'Şirkət (kök vahid)',
  anyAccount: '— hesab seçilməyib —',
  anyCc: '— xərc mərkəzi seçilməyib —',
  none: '—',
  requestType: 'Sorğu növü',
  budgetKind: 'Büdcə versiyasının növü',
};
const SAMPLE_TEXT = { az: sampleAz, en: {
  amount: 'Amount (base currency)',
  ccHint: 'When a cost center is chosen, its org unit is used.',
  rootUnit: 'Company (root unit)',
  anyAccount: '— no account —',
  anyCc: '— no cost center —',
  none: '—',
  requestType: 'Request type',
  budgetKind: 'Budget version kind',
} satisfies typeof sampleAz };

/** Inputs describing a sample item for routing tests. */
export function SampleForm({ value, onChange, refs, children }: { value: SampleInput; onChange: (s: SampleInput) => void; refs: WfRefs; children?: ReactNode }) {
  const L = useLocal(SAMPLE_TEXT);
  const { t, lang } = useI18n();
  const nm = (r: { name: string; nameEn?: string | null }) => (lang === 'en' && r.nameEn ? r.nameEn : r.name);
  const set = (p: Partial<SampleInput>) => onChange({ ...value, ...p });
  const f = (label: string, node: (id: string) => ReactNode, hint?: string) => {
    const id = `sample-${label}`;
    return <div className="field"><label htmlFor={id}>{label}</label>{node(id)}{hint && <small className="hint">{hint}</small>}</div>;
  };
  return (
    <div className="wfp-form">
      {children}
      {f(L.amount, (id) => <AmountInput id={id} label={L.amount} value={value.amount} onChange={(n) => set({ amount: n })} />)}
      {f(t('common.costCenter'), (id) => (
        <Select id={id} value={value.costCenterId ?? ''} onChange={(e) => set({ costCenterId: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: L.anyCc }, ...[...refs.costCenters].filter((c) => c.isActive).sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} />
      ), L.ccHint)}
      {f(t('common.unit'), (id) => (
        <Select id={id} value={value.costCenterId ? '' : value.orgUnitId ?? ''} disabled={!!value.costCenterId} onChange={(e) => set({ orgUnitId: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: L.rootUnit }, ...treeOptions(refs.units, nm, (u) => u.isActive).map((o) => ({ value: o.value, label: o.label }))]} />
      ))}
      {f(t('common.account'), (id) => (
        <Select id={id} value={value.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: '', label: L.anyAccount }, ...treeOptions(refs.accounts, nm, (a) => a.isActive).map((o) => ({ value: o.value, label: o.label }))]} />
      ))}
      <div className="grid-2">
        {f(L.requestType, (id) => (
          <Select id={id} value={value.requestType} onChange={(e) => set({ requestType: e.target.value as SampleInput['requestType'] })}
            options={[{ value: '', label: L.none }, ...REQUEST_TYPES.map((r) => ({ value: r, label: t(`requestType.${r}` as TKey) }))]} />
        ))}
        {f(L.budgetKind, (id) => (
          <Select id={id} value={value.budgetKind} onChange={(e) => set({ budgetKind: e.target.value as SampleInput['budgetKind'] })}
            options={[{ value: '', label: L.none }, ...VERSION_KINDS.map((r) => ({ value: r, label: t(`versionKind.${r}` as TKey) }))]} />
        ))}
      </div>
    </div>
  );
}

/** Result list of POST /workflows/preview. */
export function PreviewSteps({ result }: { result: WorkflowPreviewDto }) {
  const { t } = useI18n();
  const L = useLocal(PREVIEW_TEXT);
  return (
    <ol className="wfp-steps">
      {result.steps.map((s) => (
        <li key={s.seq} className={s.included ? (s.approvers.length ? 'is-ok' : 'is-warn') : 'is-skip'}>
          <span className="wfp-dot" aria-hidden="true">{s.included ? s.seq : '–'}</span>
          <div>
            <div className="wfp-name">{s.name} <span className="muted small">· {t(`approverType.${s.approverType}` as TKey)}</span></div>
            {s.included
              ? s.approvers.length
                ? <div className="small">{L.approvers}: <strong>{s.approvers.join(', ')}</strong></div>
                : <div className="small wfp-warn"><Icon name="alert" /> {L.noApprover}</div>
              : <div className="small muted">{L.skipped}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const previewAz = {
  approvers: 'Təsdiqləyənlər',
  noApprover: 'Təsdiqləyən tapılmadı — göndərmə zamanı xəta verəcək. Strukturda məsul şəxsi təyin edin.',
  skipped: 'Mərhələ şərti ödənmir — ötürüləcək',
};
const PREVIEW_TEXT = { az: previewAz, en: {
  approvers: 'Approvers',
  noApprover: 'No approver resolved — submission would fail. Assign the responsible person in the organisation setup.',
  skipped: 'Step condition not met — will be skipped',
} satisfies typeof previewAz };
