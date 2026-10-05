import {
  applyUplift, can, SECTION_EDITABLE,
  type BudgetDetailDto, type BudgetDto, type BudgetLineDto, type BudgetSectionDto, type BudgetVersionDto, type SectionStatus,
  type VersionDiffRow, type VersionKind, type VersionStatus,
} from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors';
import type { UserRow } from '../lib/mappers';
import { costCenterFilter, getScope, inScopeCostCenter, inScopeUnit, type Scope } from '../lib/scope';
import { AccountIndex } from './accounts';
import { OrgIndex } from './org';
import { companyRow, getSettings } from './settings';
import { latestInstanceFor, registerHandler, startWorkflow, type InstanceRow } from './workflowEngine';

export const MONTH_COLS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const;
const SUM = MONTH_COLS.join(' + ');
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BudgetRow {
  id: number; company_id: number; fiscal_year: number; name: string; currency: string;
  current_version_id: number | null; approved_version_id: number | null; created_at: string;
}
export interface VersionRow {
  id: number; budget_id: number; version_no: number; name: string; kind: VersionKind; scenario_id: number; status: VersionStatus;
  based_on_version_id: number | null; change_request_id: number | null; workflow_instance_id: number | null; created_by: number | null;
  created_at: string; submitted_at: string | null; approved_at: string | null; locked_at: string | null;
}
export interface SectionRow {
  id: number; version_id: number; org_unit_id: number; status: SectionStatus; workflow_instance_id: number | null;
  submitted_by: number | null; submitted_at: string | null; approved_at: string | null;
}

export function loadBudget(companyId: number, id: number): BudgetRow {
  const b = get<BudgetRow>('SELECT * FROM budgets WHERE id = ? AND company_id = ?', id, companyId);
  if (!b) throw notFound('Budget');
  return b;
}

export function findBudgetByYear(companyId: number, year: number): BudgetRow | undefined {
  return get<BudgetRow>('SELECT * FROM budgets WHERE company_id = ? AND fiscal_year = ?', companyId, year);
}

export function loadVersion(budget: BudgetRow, versionId?: number | null): VersionRow {
  const id = versionId ?? budget.current_version_id;
  const v = id ? get<VersionRow>('SELECT * FROM budget_versions WHERE id = ? AND budget_id = ?', id, budget.id) : undefined;
  if (!v) throw notFound('Budget version');
  return v;
}

function versionTotals(versionId: number, scope?: Scope): { total: number; n: number } {
  const f = scope ? costCenterFilter(scope, 'cost_center_id') : { sql: '', params: [] };
  const r = get<{ total: number | null; n: number }>(`SELECT SUM(${SUM}) AS total, COUNT(*) AS n FROM budget_lines WHERE version_id = ?${f.sql}`, versionId, ...f.params);
  return { total: r2(r?.total ?? 0), n: r?.n ?? 0 };
}

export function toBudgetDto(b: BudgetRow, scope?: Scope): BudgetDto {
  const v = b.current_version_id ? get<VersionRow>('SELECT * FROM budget_versions WHERE id = ?', b.current_version_id) : undefined;
  return {
    id: b.id, fiscalYear: b.fiscal_year, name: b.name, currency: b.currency, currentVersionId: v?.id ?? null,
    currentVersionNo: v?.version_no ?? null, currentStatus: v?.status ?? null, approvedVersionId: b.approved_version_id,
    total: v ? versionTotals(v.id, scope).total : 0, createdAt: b.created_at,
  };
}

function versionDto(v: VersionRow, scope?: Scope): BudgetVersionDto {
  const t = versionTotals(v.id, scope);
  const creator = v.created_by ? get<{ full_name: string }>('SELECT full_name FROM users WHERE id = ?', v.created_by)?.full_name ?? null : null;
  const scenario = get<{ code: string }>('SELECT code FROM budget_scenarios WHERE id = ?', v.scenario_id)?.code ?? 'BASE';
  return {
    id: v.id, budgetId: v.budget_id, versionNo: v.version_no, name: v.name, kind: v.kind, status: v.status, scenarioCode: scenario,
    basedOnVersionId: v.based_on_version_id, changeRequestId: v.change_request_id, total: t.total, lineCount: t.n, createdBy: creator,
    createdAt: v.created_at, submittedAt: v.submitted_at, approvedAt: v.approved_at, lockedAt: v.locked_at, workflowInstanceId: v.workflow_instance_id,
  };
}

/* ------------------------------------------------------------------ creation */

function insertLine(versionId: number, ccId: number, accId: number, description: string, months: number[], userId: number | null): number {
  const ts = nowIso();
  return run(
    `INSERT INTO budget_lines (version_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?, ?, ?)`,
    versionId, ccId, accId, description, ...months.map(r2), ts, userId, ts,
  ).lastInsertRowid;
}

/** One section per budgeting unit that has active cost centers. */
export function ensureSections(companyId: number, versionId: number, org?: OrgIndex): void {
  const idx = org ?? OrgIndex.load(companyId);
  const units = new Set<number>();
  for (const c of idx.costCenters.values()) if (c.isActive) units.add(idx.sectionOf(c.orgUnitId).id);
  for (const r of all<{ cost_center_id: number }>('SELECT DISTINCT cost_center_id FROM budget_lines WHERE version_id = ?', versionId)) {
    if (idx.costCenters.has(r.cost_center_id)) units.add(idx.sectionOfCostCenter(r.cost_center_id).id);
  }
  for (const u of units) run("INSERT OR IGNORE INTO budget_sections (version_id, org_unit_id, status) VALUES (?, ?, 'NOT_STARTED')", versionId, u);
}

export function createBudget(user: UserRow, input: { fiscalYear: number; name: string; copyFromBudgetId?: number | null; upliftPct: number }): BudgetRow {
  const companyId = user.company_id!;
  if (findBudgetByYear(companyId, input.fiscalYear)) throw conflict('BUDGET_EXISTS', `A budget for ${input.fiscalYear} already exists`);
  const source = input.copyFromBudgetId ? loadBudget(companyId, input.copyFromBudgetId) : null;
  const sourceVersion = source?.current_version_id ? loadVersion(source) : null;
  return tx(() => {
    const ts = nowIso();
    const currency = companyRow(companyId).base_currency;
    const scenario = get<{ id: number }>('SELECT id FROM budget_scenarios WHERE company_id = ? AND is_default = 1', companyId)!.id;
    const budgetId = run('INSERT INTO budgets (company_id, fiscal_year, name, currency, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      companyId, input.fiscalYear, input.name, currency, user.id, ts).lastInsertRowid;
    const versionId = run(
      `INSERT INTO budget_versions (budget_id, version_no, name, kind, scenario_id, status, created_by, created_at, notes)
       VALUES (?, 1, ?, 'INITIAL', ?, 'DRAFT', ?, ?, ?)`,
      budgetId, 'İlkin büdcə', scenario, user.id, ts, sourceVersion ? `Copied from ${source!.fiscal_year} v${sourceVersion.version_no} (${input.upliftPct >= 0 ? '+' : ''}${input.upliftPct}%)` : null,
    ).lastInsertRowid;
    run('UPDATE budgets SET current_version_id = ? WHERE id = ?', versionId, budgetId);
    if (sourceVersion) {
      const accs = AccountIndex.load(companyId);
      for (const l of all<Record<string, number | string>>('SELECT * FROM budget_lines WHERE version_id = ?', sourceVersion.id)) {
        const acc = accs.accounts.get(Number(l.account_id));
        if (!acc || !acc.isActive) continue;
        insertLine(versionId, Number(l.cost_center_id), Number(l.account_id), String(l.description), applyUplift(MONTH_COLS.map((m) => Number(l[m])), input.upliftPct), user.id);
      }
    }
    ensureSections(companyId, versionId);
    audit(companyId, user.id, 'BUDGET', budgetId, 'CREATED', { fiscalYear: input.fiscalYear, copyFrom: source?.fiscal_year ?? null, upliftPct: input.upliftPct });
    return loadBudget(companyId, budgetId);
  });
}

/* ------------------------------------------------------------------ editing rules */

function sectionsOf(versionId: number): Map<number, SectionRow> {
  return new Map(all<SectionRow>('SELECT * FROM budget_sections WHERE version_id = ?', versionId).map((s) => [s.org_unit_id, s]));
}

export function canEditSection(user: UserRow, version: VersionRow, section: SectionRow | undefined, scope: Scope, unitId: number): boolean {
  if (version.status !== 'DRAFT' || !can(user.role, 'budget.edit')) return false;
  const status = section?.status ?? 'NOT_STARTED';
  if (!SECTION_EDITABLE.includes(status)) return false;
  return can(user.role, 'budget.manage') || inScopeUnit(scope, unitId);
}

function canSubmitSection(user: UserRow, version: VersionRow, section: SectionRow, scope: Scope, org: OrgIndex): boolean {
  if (version.status !== 'DRAFT' || !can(user.role, 'budget.submit') || !SECTION_EDITABLE.includes(section.status)) return false;
  if (can(user.role, 'budget.manage')) return true;
  // the head of the section (or of an ancestor) submits it
  return org.ancestors(section.org_unit_id).some((u) => u.headUserId === user.id) && inScopeUnit(scope, section.org_unit_id);
}

function assertLineEditable(user: UserRow, version: VersionRow, ccId: number, scope: Scope, org: OrgIndex, sections: Map<number, SectionRow>): number {
  const section = org.sectionOfCostCenter(ccId);
  if (version.status !== 'DRAFT') throw new HttpError(409, 'VERSION_LOCKED', 'This budget version is not a draft; use a change request');
  if (!canEditSection(user, version, sections.get(section.id), scope, section.id)) {
    throw new HttpError(409, 'BUDGET_NOT_EDITABLE', 'These budget lines cannot be edited in the current status');
  }
  if (!can(user.role, 'budget.manage') && !inScopeCostCenter(scope, ccId)) throw forbidden();
  return section.id;
}

function markInProgress(versionId: number, unitId: number): void {
  run("INSERT OR IGNORE INTO budget_sections (version_id, org_unit_id, status) VALUES (?, ?, 'NOT_STARTED')", versionId, unitId);
  run("UPDATE budget_sections SET status = 'IN_PROGRESS' WHERE version_id = ? AND org_unit_id = ? AND status = 'NOT_STARTED'", versionId, unitId);
}

/* ------------------------------------------------------------------ read */

export function budgetDetail(user: UserRow, budget: BudgetRow, versionId?: number | null): BudgetDetailDto {
  const org = OrgIndex.load(budget.company_id);
  const scope = getScope(user, org);
  const version = loadVersion(budget, versionId);
  const sections = sectionsOf(version.id);
  const totals = new Map<number, { total: number; n: number }>();
  for (const r of all<{ cost_center_id: number; total: number; n: number }>(
    `SELECT cost_center_id, SUM(${SUM}) AS total, COUNT(*) AS n FROM budget_lines WHERE version_id = ? GROUP BY cost_center_id`, version.id,
  )) {
    if (!org.costCenters.has(r.cost_center_id)) continue;
    const u = org.sectionOfCostCenter(r.cost_center_id).id;
    const t = totals.get(u) ?? { total: 0, n: 0 };
    t.total += r.total; t.n += r.n;
    totals.set(u, t);
  }
  const heads = new Map(all<{ id: number; full_name: string }>('SELECT id, full_name FROM users WHERE company_id = ?', budget.company_id).map((u) => [u.id, u.full_name]));
  const sectionDtos: BudgetSectionDto[] = [...sections.values()]
    .filter((s) => org.units.has(s.org_unit_id) && inScopeUnit(scope, s.org_unit_id))
    .map((s) => {
      const u = org.unit(s.org_unit_id);
      const t = totals.get(u.id) ?? { total: 0, n: 0 };
      return {
        orgUnitId: u.id, code: u.code, name: u.name, headName: u.headUserId ? heads.get(u.headUserId) ?? null : null, status: s.status,
        total: r2(t.total), lineCount: t.n, submittedAt: s.submitted_at, approvedAt: s.approved_at, workflowInstanceId: s.workflow_instance_id,
        canEdit: canEditSection(user, version, s, scope, u.id),
        canSubmit: t.n > 0 && canSubmitSection(user, version, s, scope, org),
        canReopen: version.status === 'DRAFT' && can(user.role, 'budget.manage') && s.status === 'APPROVED',
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const versions = all<VersionRow>('SELECT * FROM budget_versions WHERE budget_id = ? ORDER BY version_no', budget.id).map((v) => versionDto(v, scope));
  const withLines = sectionDtos.filter((s) => s.lineCount > 0);
  return {
    ...toBudgetDto(budget, scope),
    versions,
    version: versionDto(version, scope),
    sections: sectionDtos,
    canSubmitVersion: version.status === 'DRAFT' && can(user.role, 'budget.manage') && withLines.length > 0 && withLines.every((s) => s.status === 'APPROVED'),
    canLock: version.status === 'APPROVED' && can(user.role, 'budget.manage'),
    canImport: version.status === 'DRAFT' && can(user.role, 'excel.import') && can(user.role, 'budget.manage'),
    canCreateChange: version.status === 'LOCKED' && version.id === budget.current_version_id && can(user.role, 'change.create'),
  };
}

interface LineRow extends Record<string, unknown> {
  id: number; cost_center_id: number; account_id: number; description: string; updated_at: string; updated_by_name: string | null;
}

export function listLines(user: UserRow, budget: BudgetRow, versionId: number | null, filter: { sectionUnitId?: number; costCenterId?: number } = {}): BudgetLineDto[] {
  const org = OrgIndex.load(budget.company_id);
  const accs = AccountIndex.load(budget.company_id);
  const scope = getScope(user, org);
  const version = loadVersion(budget, versionId);
  const sections = sectionsOf(version.id);
  const f = costCenterFilter(scope, 'bl.cost_center_id');
  const rows = all<LineRow>(
    `SELECT bl.*, u.full_name AS updated_by_name FROM budget_lines bl LEFT JOIN users u ON u.id = bl.updated_by
      WHERE bl.version_id = ?${f.sql}${filter.costCenterId ? ' AND bl.cost_center_id = ?' : ''}`,
    version.id, ...f.params, ...(filter.costCenterId ? [filter.costCenterId] : []),
  );
  const out: BudgetLineDto[] = [];
  for (const r of rows) {
    const cc = org.costCenters.get(r.cost_center_id);
    const acc = accs.accounts.get(r.account_id);
    if (!cc || !acc) continue;
    const section = org.sectionOf(cc.orgUnitId);
    if (filter.sectionUnitId && section.id !== filter.sectionUnitId) continue;
    const months = MONTH_COLS.map((m) => Number(r[m]));
    out.push({
      id: r.id, costCenterId: cc.id, costCenterCode: cc.code, costCenterName: cc.name, sectionUnitId: section.id, sectionName: section.name,
      accountId: acc.id, accountCode: acc.code, accountName: acc.name, expenseClass: accs.expenseClassOf(acc.id), description: r.description,
      months, total: r2(months.reduce((a, b) => a + b, 0)),
      canEdit: canEditSection(user, version, sections.get(section.id), scope, section.id) && (can(user.role, 'budget.manage') || inScopeCostCenter(scope, cc.id)),
      updatedAt: r.updated_at, updatedBy: r.updated_by_name,
    });
  }
  return out.sort((a, b) => a.costCenterCode.localeCompare(b.costCenterCode) || a.accountCode.localeCompare(b.accountCode) || a.id - b.id);
}

/* ------------------------------------------------------------------ line edits */

export function addLine(user: UserRow, budget: BudgetRow, input: { costCenterId: number; accountId: number; description: string; months: number[] }): number {
  const version = loadVersion(budget);
  const org = OrgIndex.load(budget.company_id);
  const cc = org.cc(input.costCenterId);
  if (!cc.isActive) throw badRequest('VALIDATION_ERROR', 'Cost center is inactive');
  AccountIndex.load(budget.company_id).assertUsable(input.accountId, cc.id, 'budget');
  return tx(() => {
    const unitId = assertLineEditable(user, version, cc.id, getScope(user, org), org, sectionsOf(version.id));
    const id = insertLine(version.id, cc.id, input.accountId, input.description, input.months, user.id);
    markInProgress(version.id, unitId);
    audit(budget.company_id, user.id, 'BUDGET_LINE', id, 'CREATED', { versionId: version.id, costCenterId: cc.id, accountId: input.accountId, months: input.months });
    return id;
  });
}

export function updateLines(user: UserRow, budget: BudgetRow, lines: { id: number; description?: string; months?: number[] }[]): void {
  const version = loadVersion(budget);
  const org = OrgIndex.load(budget.company_id);
  const scope = getScope(user, org);
  const sections = sectionsOf(version.id);
  tx(() => {
    for (const l of lines) {
      const existing = get<Record<string, number | string>>('SELECT * FROM budget_lines WHERE id = ? AND version_id = ?', l.id, version.id);
      if (!existing) throw notFound('Budget line');
      const unitId = assertLineEditable(user, version, Number(existing.cost_center_id), scope, org, sections);
      const before = MONTH_COLS.map((m) => Number(existing[m]));
      const after = l.months ? l.months.map(r2) : before;
      run(`UPDATE budget_lines SET ${MONTH_COLS.map((m) => `${m} = ?`).join(', ')}, description = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        ...after, l.description ?? String(existing.description), user.id, nowIso(), l.id);
      markInProgress(version.id, unitId);
      const changes: Record<string, [unknown, unknown]> = {};
      after.forEach((v, i) => { if (v !== before[i]) changes[`m${i + 1}`] = [before[i], v]; });
      if (l.description !== undefined && l.description !== existing.description) changes.description = [existing.description, l.description];
      if (Object.keys(changes).length) audit(budget.company_id, user.id, 'BUDGET_LINE', l.id, 'UPDATED', changes);
    }
  });
}

export function deleteLine(user: UserRow, budget: BudgetRow, lineId: number): void {
  const version = loadVersion(budget);
  const org = OrgIndex.load(budget.company_id);
  const line = get<Record<string, number | string>>('SELECT * FROM budget_lines WHERE id = ? AND version_id = ?', lineId, version.id);
  if (!line) throw notFound('Budget line');
  tx(() => {
    const unitId = assertLineEditable(user, version, Number(line.cost_center_id), getScope(user, org), org, sectionsOf(version.id));
    run('DELETE FROM budget_lines WHERE id = ?', lineId);
    markInProgress(version.id, unitId);
    audit(budget.company_id, user.id, 'BUDGET_LINE', lineId, 'DELETED', { costCenterId: line.cost_center_id, accountId: line.account_id, months: MONTH_COLS.map((m) => line[m]) });
  });
}

/* ------------------------------------------------------------------ workflow */

export function submitSection(user: UserRow, budget: BudgetRow, unitId: number): void {
  const version = loadVersion(budget);
  const org = OrgIndex.load(budget.company_id);
  const scope = getScope(user, org);
  const section = sectionsOf(version.id).get(unitId);
  if (!section) throw notFound('Budget section');
  if (!canSubmitSection(user, version, section, scope, org)) {
    if (!SECTION_EDITABLE.includes(section.status) || version.status !== 'DRAFT') throw new HttpError(409, 'INVALID_TRANSITION', 'This section cannot be submitted in its current status');
    throw forbidden();
  }
  const ccIds = org.ccsInSubtree(unitId).map((c) => c.id).filter((id) => org.sectionOfCostCenter(id).id === unitId);
  const total = ccIds.length
    ? get<{ t: number | null }>(`SELECT SUM(${SUM}) AS t FROM budget_lines WHERE version_id = ? AND cost_center_id IN (${ccIds.map(() => '?').join(',')})`, version.id, ...ccIds)?.t ?? 0
    : 0;
  const lines = ccIds.length ? get<{ n: number }>(`SELECT COUNT(*) AS n FROM budget_lines WHERE version_id = ? AND cost_center_id IN (${ccIds.map(() => '?').join(',')})`, version.id, ...ccIds)?.n ?? 0 : 0;
  if (!lines) throw badRequest('VALIDATION_ERROR', 'The section has no budget lines');
  tx(() => {
    const inst = startWorkflow({
      companyId: budget.company_id, type: 'BUDGET_SUBMISSION', entityType: 'BUDGET_SECTION', entityId: section.id,
      subject: { orgUnitId: unitId, costCenterIds: ccIds, requesterId: user.id },
      context: { ...org.ruleContextForUnit(unitId), amount: r2(total), budgetKind: version.kind, industry: companyRow(budget.company_id).industry_code },
    });
    const fresh = get<SectionRow>('SELECT * FROM budget_sections WHERE id = ?', section.id)!;
    if (fresh.status !== 'APPROVED') {
      run("UPDATE budget_sections SET status = 'IN_APPROVAL', workflow_instance_id = ?, submitted_by = ?, submitted_at = ? WHERE id = ?", inst.id, user.id, nowIso(), section.id);
    } else {
      run('UPDATE budget_sections SET workflow_instance_id = ?, submitted_by = ?, submitted_at = ? WHERE id = ?', inst.id, user.id, nowIso(), section.id);
    }
    audit(budget.company_id, user.id, 'BUDGET_SECTION', section.id, 'SUBMITTED', { unit: org.unit(unitId).code, total: r2(total) });
  });
}

export function reopenSection(user: UserRow, budget: BudgetRow, unitId: number, comment: string | null): void {
  const version = loadVersion(budget);
  if (!can(user.role, 'budget.manage')) throw forbidden();
  const section = sectionsOf(version.id).get(unitId);
  if (!section) throw notFound('Budget section');
  if (version.status !== 'DRAFT' || section.status !== 'APPROVED') throw new HttpError(409, 'INVALID_TRANSITION', 'Only approved sections of a draft version can be reopened');
  run("UPDATE budget_sections SET status = 'IN_PROGRESS', approved_at = NULL WHERE id = ?", section.id);
  audit(budget.company_id, user.id, 'BUDGET_SECTION', section.id, 'REOPENED', { comment });
}

export function submitVersion(user: UserRow, budget: BudgetRow): void {
  const version = loadVersion(budget);
  if (!can(user.role, 'budget.manage')) throw forbidden();
  if (version.status !== 'DRAFT') throw new HttpError(409, 'INVALID_TRANSITION', 'Only draft versions can be submitted');
  const detail = budgetDetail(user, budget);
  const withLines = detail.sections.filter((s) => s.lineCount > 0);
  if (!withLines.length) throw badRequest('VALIDATION_ERROR', 'The budget has no lines');
  const open = withLines.filter((s) => s.status !== 'APPROVED');
  if (open.length) throw new HttpError(409, 'SECTIONS_NOT_APPROVED', `Sections not yet approved: ${open.map((s) => s.name).join(', ')}`);
  const org = OrgIndex.load(budget.company_id);
  tx(() => {
    const inst = startWorkflow({
      companyId: budget.company_id, type: 'BUDGET_APPROVAL', entityType: 'BUDGET_VERSION', entityId: version.id,
      subject: { orgUnitId: org.root().id, costCenterIds: [], requesterId: user.id },
      context: { amount: detail.version.total, budgetKind: version.kind, industry: companyRow(budget.company_id).industry_code, orgUnit: [org.root().code] },
    });
    const fresh = get<VersionRow>('SELECT * FROM budget_versions WHERE id = ?', version.id)!;
    if (fresh.status === 'DRAFT') run("UPDATE budget_versions SET status = 'IN_APPROVAL', submitted_at = ?, workflow_instance_id = ? WHERE id = ?", nowIso(), inst.id, version.id);
    else run('UPDATE budget_versions SET submitted_at = ?, workflow_instance_id = ? WHERE id = ?', nowIso(), inst.id, version.id);
    audit(budget.company_id, user.id, 'BUDGET_VERSION', version.id, 'SUBMITTED', { total: detail.version.total });
  });
}

export function lockVersion(userId: number, budget: BudgetRow, versionId?: number): void {
  const version = loadVersion(budget, versionId);
  if (version.status !== 'APPROVED') throw new HttpError(409, 'INVALID_TRANSITION', 'Only approved versions can be locked');
  tx(() => {
    run("UPDATE budget_versions SET status = 'LOCKED', locked_at = ? WHERE id = ?", nowIso(), version.id);
    run('UPDATE budgets SET current_version_id = ?, approved_version_id = COALESCE(approved_version_id, ?) WHERE id = ?', version.id, version.id, budget.id);
    audit(budget.company_id, userId, 'BUDGET_VERSION', version.id, 'LOCKED', { versionNo: version.version_no });
  });
}

/**
 * Creates REVISED version n+1 from the current locked version with the given deltas, locks it and
 * marks the previous version SUPERSEDED. The previous version's lines are never modified.
 */
export function createRevisedVersion(companyId: number, budgetId: number, changeRequestId: number, deltas: { ccId: number; accId: number; month: number; delta: number }[], userId: number): number {
  const budget = loadBudget(companyId, budgetId);
  const base = loadVersion(budget);
  if (base.status !== 'LOCKED') throw new HttpError(409, 'INVALID_TRANSITION', 'Change requests can only be applied to a locked budget');
  return tx(() => {
    const ts = nowIso();
    const no = (get<{ n: number }>('SELECT MAX(version_no) AS n FROM budget_versions WHERE budget_id = ?', budget.id)?.n ?? 0) + 1;
    const vid = run(
      `INSERT INTO budget_versions (budget_id, version_no, name, kind, scenario_id, status, based_on_version_id, change_request_id, created_by, created_at)
       VALUES (?, ?, ?, 'REVISED', ?, 'DRAFT', ?, ?, ?, ?)`,
      budget.id, no, `Yenidən baxılmış büdcə v${no}`, base.scenario_id, base.id, changeRequestId, userId, ts,
    ).lastInsertRowid;
    const lines = all<Record<string, number | string>>('SELECT * FROM budget_lines WHERE version_id = ? ORDER BY id', base.id);
    const newIds = new Map<string, number>();
    for (const l of lines) {
      const id = insertLine(vid, Number(l.cost_center_id), Number(l.account_id), String(l.description), MONTH_COLS.map((m) => Number(l[m])), Number(l.updated_by) || null);
      const key = `${l.cost_center_id}:${l.account_id}`;
      if (!newIds.has(key)) newIds.set(key, id);
    }
    for (const d of deltas) {
      const key = `${d.ccId}:${d.accId}`;
      let lineId = newIds.get(key);
      if (!lineId) {
        lineId = insertLine(vid, d.ccId, d.accId, '', Array(12).fill(0), userId);
        newIds.set(key, lineId);
      }
      run(`UPDATE budget_lines SET m${d.month} = ROUND(m${d.month} + ?, 2), updated_by = ?, updated_at = ? WHERE id = ?`, d.delta, userId, ts, lineId);
    }
    for (const s of all<SectionRow>('SELECT * FROM budget_sections WHERE version_id = ?', base.id)) {
      run("INSERT INTO budget_sections (version_id, org_unit_id, status, approved_at) VALUES (?, ?, 'APPROVED', ?)", vid, s.org_unit_id, s.approved_at ?? ts);
    }
    run("UPDATE budget_versions SET status = 'LOCKED', approved_at = ?, locked_at = ? WHERE id = ?", ts, ts, vid);
    run("UPDATE budget_versions SET status = 'SUPERSEDED', superseded_at = ? WHERE id = ?", ts, base.id);
    run('UPDATE budgets SET current_version_id = ? WHERE id = ?', vid, budget.id);
    audit(companyId, userId, 'BUDGET_VERSION', vid, 'CREATED_FROM_CHANGE', { basedOn: base.version_no, versionNo: no, changeRequestId, deltas });
    return vid;
  });
}

export function compareVersions(budget: BudgetRow, aId: number, bId: number): VersionDiffRow[] {
  const a = loadVersion(budget, aId);
  const b = loadVersion(budget, bId);
  const org = OrgIndex.load(budget.company_id);
  const accs = AccountIndex.load(budget.company_id);
  const cells = (vid: number) => {
    const m = new Map<string, number>();
    for (const l of all<Record<string, number>>('SELECT * FROM budget_lines WHERE version_id = ?', vid)) {
      MONTH_COLS.forEach((c, i) => {
        const k = `${l.cost_center_id}:${l.account_id}:${i + 1}`;
        m.set(k, (m.get(k) ?? 0) + Number(l[c]));
      });
    }
    return m;
  };
  const ca = cells(a.id);
  const cb = cells(b.id);
  const keys = new Set([...ca.keys(), ...cb.keys()]);
  const out: VersionDiffRow[] = [];
  for (const k of keys) {
    const before = r2(ca.get(k) ?? 0);
    const after = r2(cb.get(k) ?? 0);
    if (before === after) continue;
    const [cc, acc, month] = k.split(':').map(Number);
    const c = org.costCenters.get(cc);
    const ac = accs.accounts.get(acc);
    out.push({ costCenterCode: c?.code ?? '?', costCenterName: c?.name ?? '?', accountCode: ac?.code ?? '?', accountName: ac?.name ?? '?', month, before, after, difference: r2(after - before) });
  }
  return out.sort((x, y) => x.costCenterCode.localeCompare(y.costCenterCode) || x.accountCode.localeCompare(y.accountCode) || x.month - y.month);
}

/* ------------------------------------------------------------------ workflow handlers */

registerHandler('BUDGET_SECTION', {
  onApproved(inst: InstanceRow) {
    run("UPDATE budget_sections SET status = 'APPROVED', approved_at = ? WHERE id = ?", nowIso(), inst.entity_id);
  },
  onRejected(inst: InstanceRow) {
    run("UPDATE budget_sections SET status = 'RETURNED' WHERE id = ?", inst.entity_id);
  },
  onReturned(inst: InstanceRow) {
    run("UPDATE budget_sections SET status = 'RETURNED' WHERE id = ?", inst.entity_id);
  },
  onCancelled(inst: InstanceRow) {
    run("UPDATE budget_sections SET status = 'IN_PROGRESS' WHERE id = ?", inst.entity_id);
  },
  describe(companyId: number, entityId: number) {
    const r = get<{ unit: string; year: number; budget_id: number; version_id: number }>(
      `SELECT u.name AS unit, b.fiscal_year AS year, b.id AS budget_id, v.id AS version_id FROM budget_sections s
         JOIN org_units u ON u.id = s.org_unit_id JOIN budget_versions v ON v.id = s.version_id JOIN budgets b ON b.id = v.budget_id
        WHERE s.id = ? AND b.company_id = ?`, entityId, companyId,
    );
    const total = r ? sectionTotal(companyId, r.version_id, entityId) : null;
    return { title: r ? `${r.unit} — ${r.year}` : `#${entityId}`, subtitle: 'BUDGET_SECTION', amount: total, currency: companyRow(companyId).base_currency, link: r ? `/budgets/${r.budget_id}` : '/budgets' };
  },
});

function sectionTotal(companyId: number, versionId: number, sectionId: number): number {
  const s = get<{ org_unit_id: number }>('SELECT org_unit_id FROM budget_sections WHERE id = ?', sectionId);
  if (!s) return 0;
  const org = OrgIndex.load(companyId);
  const ids = [...org.costCenters.values()].filter((c) => org.sectionOf(c.orgUnitId).id === s.org_unit_id).map((c) => c.id);
  if (!ids.length) return 0;
  return r2(get<{ t: number | null }>(`SELECT SUM(${SUM}) AS t FROM budget_lines WHERE version_id = ? AND cost_center_id IN (${ids.map(() => '?').join(',')})`, versionId, ...ids)?.t ?? 0);
}

registerHandler('BUDGET_VERSION', {
  onApproved(inst: InstanceRow, actorId: number) {
    run("UPDATE budget_versions SET status = 'APPROVED', approved_at = ? WHERE id = ?", nowIso(), inst.entity_id);
    const v = get<{ budget_id: number }>('SELECT budget_id FROM budget_versions WHERE id = ?', inst.entity_id)!;
    if (getSettings(inst.company_id).autoLockOnApproval) lockVersion(actorId, loadBudget(inst.company_id, v.budget_id), inst.entity_id);
  },
  onRejected(inst: InstanceRow) {
    run("UPDATE budget_versions SET status = 'DRAFT' WHERE id = ?", inst.entity_id);
  },
  onReturned(inst: InstanceRow) {
    run("UPDATE budget_versions SET status = 'DRAFT' WHERE id = ?", inst.entity_id);
  },
  onCancelled(inst: InstanceRow) {
    run("UPDATE budget_versions SET status = 'DRAFT' WHERE id = ?", inst.entity_id);
  },
  describe(companyId: number, entityId: number) {
    const r = get<{ name: string; year: number; budget_id: number; version_no: number }>(
      'SELECT b.name, b.fiscal_year AS year, b.id AS budget_id, v.version_no FROM budget_versions v JOIN budgets b ON b.id = v.budget_id WHERE v.id = ? AND b.company_id = ?',
      entityId, companyId,
    );
    const total = get<{ t: number | null }>(`SELECT SUM(${SUM}) AS t FROM budget_lines WHERE version_id = ?`, entityId)?.t ?? 0;
    return { title: r ? `${r.name} · v${r.version_no}` : `#${entityId}`, subtitle: 'BUDGET_VERSION', amount: r2(total), currency: companyRow(companyId).base_currency, link: r ? `/budgets/${r.budget_id}` : '/budgets' };
  },
});

export { latestInstanceFor };
