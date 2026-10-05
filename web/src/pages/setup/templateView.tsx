/* Shared read-only views of an industry template, used by the setup wizard and the templates page. */
import { Fragment, useMemo, useState } from 'react';
import type { Condition, ExpenseClass, IndustryTemplateDetailDto, Lang, TemplateAccountDto, TemplateContent, TemplateUnit } from '@finbridge/shared';
import { Badge, Empty, Icon } from '../../components/ui';
import { useI18n, useLocal, fmt, type TKey } from '../../i18n';
import '../../styles/admin-org.css';

const az = {
  code: 'Kod', category: 'Kateqoriya', account: 'Hesab', type: 'Növ', cls: 'Xərc sinfi', kind: 'Qrup / hesab', group: 'Qrup', leaf: 'Hesab',
  expandAll: 'Hamısını aç', collapseAll: 'Hamısını bağla', include: 'Daxil et', selectAll: 'Hamısını seç', clearAll: 'Heç birini seçmə',
  inherited: 'yuxarı qrupdan', noUnits: 'Şablonda struktur vahidi yoxdur.', noWorkflows: 'Şablonda təsdiq axını yoxdur.',
  root: 'Şirkət (kök vahid)', ccs: 'Xərc mərkəzləri', priority: 'Prioritet', sla: '{h} saat', condition: 'Şərt',
  stepCond: 'yalnız şərt ödəndikdə', always: 'Bütün sənədlər üçün', kpis: 'Əsas göstəricilər (KPI)', assumptions: 'Fərziyyələr',
  noKpis: 'KPI təyin edilməyib.', noAssumptions: 'Fərziyyə yoxdur.', formula: 'Düstur', jobFamilies: 'Peşə ailələri',
  budgeting: 'büdcə bölməsi', and: ' və ', or: ' və ya ', not: 'deyil: ',
  fields: { amount: 'Məbləğ', orgUnit: 'Struktur vahidi', department: 'Departament', branch: 'Filial', costCenter: 'Xərc mərkəzi', account: 'Hesab', expenseClass: 'Xərc sinfi', requestType: 'Sorğu növü', budgetKind: 'Versiya növü', industry: 'Sahə' } as Record<string, string>,
  types: { REVENUE: 'Gəlir', EXPENSE: 'Xərc', CAPEX: 'Kapital', OTHER: 'Digər' } as Record<string, string>,
};
const TEXT = {
  az,
  en: {
    code: 'Code', category: 'Category', account: 'Account', type: 'Type', cls: 'Expense class', kind: 'Group / account', group: 'Group', leaf: 'Account',
    expandAll: 'Expand all', collapseAll: 'Collapse all', include: 'Include', selectAll: 'Select all', clearAll: 'Select none',
    inherited: 'inherited', noUnits: 'The template has no org units.', noWorkflows: 'The template has no approval workflows.',
    root: 'Company (root unit)', ccs: 'Cost centers', priority: 'Priority', sla: '{h} h', condition: 'Condition',
    stepCond: 'only when condition matches', always: 'For all documents', kpis: 'Key indicators (KPIs)', assumptions: 'Assumptions',
    noKpis: 'No KPIs defined.', noAssumptions: 'No assumptions.', formula: 'Formula', jobFamilies: 'Job families',
    budgeting: 'budget section', and: ' and ', or: ' or ', not: 'not: ',
    fields: { amount: 'Amount', orgUnit: 'Org unit', department: 'Department', branch: 'Branch', costCenter: 'Cost center', account: 'Account', expenseClass: 'Expense class', requestType: 'Request type', budgetKind: 'Version kind', industry: 'Industry' },
    types: { REVENUE: 'Revenue', EXPENSE: 'Expense', CAPEX: 'Capital', OTHER: 'Other' },
  } satisfies typeof az,
};
export const ACCOUNT_TYPE_TEXT = { az: az.types, en: TEXT.en.types };

const OPS: Record<string, string> = { eq: '=', neq: '≠', in: '∈', notIn: '∉', gt: '>', gte: '≥', lt: '<', lte: '≤' };

export const tplName = (r: { nameAz: string; nameEn: string }, lang: Lang) => (lang === 'en' ? r.nameEn : r.nameAz);
export const tplDesc = (r: { descriptionAz: string; descriptionEn: string }, lang: Lang) => (lang === 'en' ? r.descriptionEn : r.descriptionAz);

/** Expense class is stored on top-level groups; leaves inherit it from the nearest ancestor. */
export function templateClass(accounts: TemplateAccountDto[]): Map<string, { cls: ExpenseClass | null; inherited: boolean }> {
  const by = new Map(accounts.map((a) => [a.code, a]));
  const out = new Map<string, { cls: ExpenseClass | null; inherited: boolean }>();
  for (const a of accounts) {
    let cur: TemplateAccountDto | undefined = a;
    let inherited = false;
    while (cur && !cur.expenseClass && cur.parentCode) { cur = by.get(cur.parentCode); inherited = true; }
    out.set(a.code, { cls: cur?.expenseClass ?? null, inherited: inherited && !!cur?.expenseClass });
  }
  return out;
}

/** Number of postable (leaf) accounts per top-level group. */
export function accountGroups(accounts: TemplateAccountDto[]): { code: string; name: TemplateAccountDto; leaves: number }[] {
  const by = new Map(accounts.map((a) => [a.code, a]));
  const top = (a: TemplateAccountDto) => { let c = a; while (c.parentCode && by.get(c.parentCode)) c = by.get(c.parentCode)!; return c; };
  const counts = new Map<string, number>();
  for (const a of accounts) if (!a.isGroup) counts.set(top(a).code, (counts.get(top(a).code) ?? 0) + 1);
  return accounts.filter((a) => !a.parentCode).map((g) => ({ code: g.code, name: g, leaves: counts.get(g.code) ?? 0 }));
}

/** Leaf codes below a template account (the account itself when it is a leaf). */
function leavesOf(code: string, children: Map<string | null, TemplateAccountDto[]>): string[] {
  const kids = children.get(code) ?? [];
  if (!kids.length) return [code];
  return kids.flatMap((k) => (k.isGroup || children.has(k.code) ? leavesOf(k.code, children) : [k.code]));
}

/**
 * Converts excluded leaves into the API's excludedAccountCodes: the leaves themselves plus every group
 * whose leaves are all excluded (so no empty groups are created).
 */
export function excludedCodes(accounts: TemplateAccountDto[], excludedLeaves: Set<string>): string[] {
  const children = childMap(accounts);
  const out = new Set(excludedLeaves);
  for (const a of accounts) if (a.isGroup && leavesOf(a.code, children).every((c) => excludedLeaves.has(c))) out.add(a.code);
  return [...out];
}

function childMap(accounts: TemplateAccountDto[]): Map<string | null, TemplateAccountDto[]> {
  const codes = new Set(accounts.map((a) => a.code));
  const m = new Map<string | null, TemplateAccountDto[]>();
  for (const a of accounts) {
    const k = a.parentCode && codes.has(a.parentCode) ? a.parentCode : null;
    m.set(k, [...(m.get(k) ?? []), a]);
  }
  return m;
}

export function ClassBadge({ cls, inherited }: { cls: ExpenseClass | null; inherited?: boolean }) {
  const L = useLocal(TEXT);
  if (!cls) return <span className="muted">—</span>;
  return (
    <span title={inherited ? L.inherited : undefined}>
      <Badge tone={cls === 'CAPEX' ? 'info' : 'neutral'}>{cls}</Badge>
      {inherited && <span className="muted small"> ↳</span>}
    </span>
  );
}

/** Template chart of accounts as an expandable tree-table; with `excluded` it shows include checkboxes. */
export function TemplateAccountTree({ accounts, excluded, onChange }: {
  accounts: TemplateAccountDto[]; excluded?: Set<string>; onChange?: (next: Set<string>) => void;
}) {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const children = useMemo(() => childMap(accounts), [accounts]);
  const classes = useMemo(() => templateClass(accounts), [accounts]);
  const groups = useMemo(() => accounts.filter((a) => children.has(a.code)).map((a) => a.code), [accounts, children]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selectable = !!excluded && !!onChange;

  const toggleLeaves = (codes: string[], include: boolean) => {
    if (!excluded || !onChange) return;
    const next = new Set(excluded);
    for (const c of codes) { if (include) next.delete(c); else next.add(c); }
    onChange(next);
  };

  const rows: JSX.Element[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of children.get(parent) ?? []) {
      const isGroup = children.has(a.code);
      const leaves = isGroup ? leavesOf(a.code, children) : [a.code];
      const excludedCount = excluded ? leaves.filter((c) => excluded.has(c)).length : 0;
      const allOut = excludedCount === leaves.length;
      const open = !collapsed.has(a.code);
      const c = classes.get(a.code);
      rows.push(
        <tr key={a.code} className={`tree-row${isGroup ? ' tree-group' : ''}${allOut && selectable ? ' is-excluded' : ''}`}>
          <td>
            <div className="tree-name" style={{ paddingLeft: depth * 18 }}>
              {isGroup ? (
                <button type="button" className={`tree-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-label={`${a.code} ${open ? L.collapseAll : L.expandAll}`}
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(a.code)) n.delete(a.code); else n.add(a.code); return n; })}>
                  <Icon name="chevron" size={14} />
                </button>
              ) : <span className="tree-spacer" />}
              {selectable && (
                <input type="checkbox" className="tree-check" aria-label={`${L.include}: ${a.code} ${tplName(a, lang)}`}
                  checked={!allOut}
                  ref={(el) => { if (el) el.indeterminate = isGroup && excludedCount > 0 && !allOut; }}
                  onChange={(e) => toggleLeaves(leaves, e.target.checked)} />
              )}
              <span className="acc-code">{a.code}</span>
              <span className="tree-label">{tplName(a, lang)}</span>
              {isGroup && <span className="muted small">({leaves.length - excludedCount}/{leaves.length})</span>}
            </div>
          </td>
          <td>{L.types[a.accountType] ?? a.accountType}</td>
          <td><ClassBadge cls={c?.cls ?? null} inherited={c?.inherited} /></td>
          <td>{isGroup ? <Badge tone="dark">{L.group}</Badge> : <Badge tone="muted">{L.leaf}</Badge>}</td>
          <td className="muted">{a.category ?? '—'}</td>
        </tr>,
      );
      if (isGroup && open) walk(a.code, depth + 1);
    }
  };
  walk(null, 0);

  const leafCodes = accounts.filter((a) => !children.has(a.code)).map((a) => a.code);
  return (
    <>
      <div className="table-toolbar">
        <div className="tree-tools">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCollapsed(new Set())}>{L.expandAll}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCollapsed(new Set(groups))}>{L.collapseAll}</button>
          {selectable && <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleLeaves(leafCodes, true)}>{L.selectAll}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleLeaves(leafCodes, false)}>{L.clearAll}</button>
          </>}
        </div>
        {selectable && <span className="toolbar-right muted small">{leafCodes.length - leafCodes.filter((c) => excluded!.has(c)).length} / {leafCodes.length}</span>}
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>{L.account}</th><th>{L.type}</th><th>{L.cls}</th><th>{L.kind}</th><th>{L.category}</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </>
  );
}

/** Units of the template as a nested tree below the company root, with their cost centers. */
export function TemplateStructure({ content }: { content: TemplateContent }) {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const codes = new Set(content.units.map((u) => u.code));
  const byParent = new Map<string | null, TemplateUnit[]>();
  for (const u of content.units) {
    const k = u.parent && codes.has(u.parent) ? u.parent : null;
    byParent.set(k, [...(byParent.get(k) ?? []), u]);
  }
  const ccs = (unit: string) => content.costCenters.filter((c) => c.unit === unit);
  const render = (parent: string | null): JSX.Element | null => {
    const list = byParent.get(parent);
    if (!list?.length) return null;
    return (
      <ul>
        {list.map((u) => (
          <li key={u.code}>
            <div className="unit-node">
              <span className="acc-code">{u.code}</span>
              <b>{tplName(u, lang)}</b>
              <Badge tone="neutral">{u.type}</Badge>
              {content.budgetingTypes.includes(u.type) && <Badge tone="info">{L.budgeting}</Badge>}
            </div>
            {ccs(u.code).length > 0 && (
              <div className="unit-ccs" aria-label={L.ccs}>
                {ccs(u.code).map((c) => <span key={c.code} className="cc-chip"><b>{c.code}</b> {tplName(c, lang)}</span>)}
              </div>
            )}
            {render(u.code)}
          </li>
        ))}
      </ul>
    );
  };
  if (!content.units.length) return <Empty>{L.noUnits}</Empty>;
  return (
    <>
      <ul className="unit-tree">
        <li>
          <div className="unit-node"><Icon name="company" /> <b>{L.root}</b> <Badge tone="dark">COMPANY</Badge></div>
          {render(null)}
        </li>
      </ul>
      {content.jobFamilies.length > 0 && (
        <>
          <h3 className="h3" style={{ marginTop: 16 }}>{L.jobFamilies}</h3>
          <div className="unit-ccs">{content.jobFamilies.map((j) => <span key={j.code} className="cc-chip"><b>{j.code}</b> {tplName(j, lang)}</span>)}</div>
        </>
      )}
    </>
  );
}

export function useConditionText() {
  const L = useLocal(TEXT);
  const fn = (c: Condition | null | undefined): string => {
    if (!c) return '';
    if ('all' in c) return c.all.map(fn).join(L.and);
    if ('any' in c) return `(${c.any.map(fn).join(L.or)})`;
    if ('not' in c) return L.not + fn(c.not);
    const v = Array.isArray(c.value) ? c.value.join(', ') : String(c.value);
    return `${L.fields[c.field] ?? c.field} ${OPS[c.op] ?? c.op} ${v}`;
  };
  return fn;
}

export function TemplateWorkflows({ content }: { content: TemplateContent }) {
  const L = useLocal(TEXT);
  const { t } = useI18n();
  const cond = useConditionText();
  if (!content.workflows.length) return <Empty>{L.noWorkflows}</Empty>;
  return (
    <>
      {content.workflows.map((w, i) => (
        <div key={`${w.type}-${w.name}-${i}`} className="wf-tpl">
          <div className="wf-tpl-head">
            <b>{w.name}</b>
            <span className="row" style={{ gap: 6 }}>
              <Badge tone="info">{t(`workflowType.${w.type}` as TKey)}</Badge>
              <Badge tone="muted">{L.priority}: {w.priority ?? 100}</Badge>
            </span>
          </div>
          <ol className="wf-chain">
            {w.steps.map((s, j) => (
              <li key={j}>
                <span>{s.name}</span>
                <small>{t(`approverType.${s.approverType}` as TKey)}{s.config?.role ? ` · ${t(`roles.${s.config.role}` as TKey)}` : ''}{s.config?.unitTypeCode ? ` · ${s.config.unitTypeCode}` : ''}</small>
                {s.slaHours ? <small>⏱ {fmt(L.sla, { h: s.slaHours })}</small> : null}
                {s.condition ? <small title={cond(s.condition)}>({L.stepCond})</small> : null}
              </li>
            ))}
          </ol>
          <div className="wf-cond">{L.condition}: {w.conditions ? cond(w.conditions) : L.always}</div>
        </div>
      ))}
    </>
  );
}

export function TemplateKpis({ content }: { content: TemplateContent }) {
  const L = useLocal(TEXT);
  const { lang } = useI18n();
  const assumptions = lang === 'en' ? content.assumptionsEn : content.assumptionsAz;
  return (
    <div className="grid-2 gap-lg">
      <div>
        <h3 className="h3">{L.kpis}</h3>
        {content.kpis.length === 0 ? <p className="muted">{L.noKpis}</p> : (
          <ul className="kv">
            {content.kpis.map((k) => (
              <li key={k.code}><span>{tplName(k, lang)}</span><span className="muted small">{lang === 'en' ? k.formulaEn : k.formulaAz}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="h3">{L.assumptions}</h3>
        {assumptions.length === 0 ? <p className="muted">{L.noAssumptions}</p> : <ul className="bullets">{assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      </div>
    </div>
  );
}

/** Compact summary of a template (counts by area + accounts per top-level group). */
export function TemplateSummary({ tpl }: { tpl: IndustryTemplateDetailDto }) {
  const { lang } = useI18n();
  const L = useLocal(SUMMARY);
  const groups = accountGroups(tpl.accounts);
  const types = [...new Set(tpl.content.units.map((u) => u.type))];
  return (
    <>
      <div className="summary-grid">
        <Stat label={L.accounts} value={tpl.accountCount} foot={fmt(L.groups, { n: tpl.accounts.length - tpl.accountCount })} />
        <Stat label={L.units} value={tpl.content.units.length} foot={types.join(', ') || '—'} />
        <Stat label={L.ccs} value={tpl.content.costCenters.length} />
        <Stat label={L.workflows} value={tpl.content.workflows.length} foot={fmt(L.kpis, { n: tpl.content.kpis.length })} />
      </div>
      <h3 className="h3">{L.byGroup}</h3>
      <ul className="kv" style={{ marginBottom: 8 }}>
        {groups.map((g) => (
          <Fragment key={g.code}>
            <li><span><span className="acc-code">{g.code}</span>{tplName(g.name, lang)}</span><span className="num">{g.leaves}</span></li>
          </Fragment>
        ))}
      </ul>
    </>
  );
}

const SUMMARY_AZ = { accounts: 'Büdcə hesabları', groups: '+ {n} qrup', units: 'Struktur vahidləri', ccs: 'Xərc mərkəzləri', workflows: 'Təsdiq axınları', kpis: '{n} KPI', byGroup: 'Qruplar üzrə hesab sayı' };
const SUMMARY = {
  az: SUMMARY_AZ,
  en: { accounts: 'Budget accounts', groups: '+ {n} groups', units: 'Org units', ccs: 'Cost centers', workflows: 'Approval workflows', kpis: '{n} KPIs', byGroup: 'Accounts per group' } satisfies typeof SUMMARY_AZ,
};

export function Stat({ label, value, foot }: { label: string; value: number | string; foot?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
