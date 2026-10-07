import type { IndustryTemplateDetailDto, IndustryTemplateDto, Lang, SetupApplyResult, TemplateAccountDto, TemplateContent } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { notFound } from '../lib/errors';
import { parseJson } from '../lib/json';
import { TEMPLATES } from '../templates/data';
import { rootUnitId } from './company';
import { saveDefinition } from './workflowDefinitions';

/** Upserts the built-in templates into the database (templates are data, not UI code). */
export function syncTemplates(): void {
  tx(() => {
    TEMPLATES.forEach((t, i) => {
      const existing = get<{ id: number; version: number }>('SELECT id, version FROM industry_templates WHERE code = ?', t.code);
      if (existing && existing.version >= t.version) return;
      let id = existing?.id;
      if (id) {
        run('UPDATE industry_templates SET name_az = ?, name_en = ?, description_az = ?, description_en = ?, content = ?, version = ?, sort_order = ? WHERE id = ?',
          t.nameAz, t.nameEn, t.descriptionAz, t.descriptionEn, JSON.stringify(t.content), t.version, i, id);
        run('DELETE FROM template_accounts WHERE template_id = ?', id);
      } else {
        id = run('INSERT INTO industry_templates (code, name_az, name_en, description_az, description_en, content, version, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          t.code, t.nameAz, t.nameEn, t.descriptionAz, t.descriptionEn, JSON.stringify(t.content), t.version, i).lastInsertRowid;
      }
      t.accounts.forEach((a, j) => {
        run(`INSERT INTO template_accounts (template_id, code, parent_code, name_az, name_en, account_type, category, expense_class, is_group, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id!, a.code, a.parentCode, a.nameAz, a.nameEn, a.accountType, a.category, a.expenseClass, a.isGroup ? 1 : 0, j);
      });
    });
  });
}

interface TemplateRow { id: number; code: string; name_az: string; name_en: string; description_az: string; description_en: string; content: string; version: number }

export function listTemplates(): IndustryTemplateDto[] {
  return all<TemplateRow & { n: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM template_accounts a WHERE a.template_id = t.id AND a.is_group = 0) AS n
       FROM industry_templates t WHERE t.is_active = 1 ORDER BY t.sort_order`,
  ).map((t) => ({
    code: t.code, nameAz: t.name_az, nameEn: t.name_en, descriptionAz: t.description_az, descriptionEn: t.description_en,
    accountCount: t.n, version: t.version,
  }));
}

export function getTemplate(code: string): IndustryTemplateDetailDto {
  const t = get<TemplateRow>('SELECT * FROM industry_templates WHERE code = ?', code);
  if (!t) throw notFound('Template');
  const accounts = all<{ code: string; parent_code: string | null; name_az: string; name_en: string; account_type: string; category: string | null; expense_class: string | null; is_group: number }>(
    'SELECT * FROM template_accounts WHERE template_id = ? ORDER BY sort_order', t.id,
  ).map((a): TemplateAccountDto => ({
    code: a.code, parentCode: a.parent_code, nameAz: a.name_az, nameEn: a.name_en, accountType: a.account_type as TemplateAccountDto['accountType'],
    category: a.category, expenseClass: a.expense_class as TemplateAccountDto['expenseClass'], isGroup: a.is_group === 1,
  }));
  return {
    code: t.code, nameAz: t.name_az, nameEn: t.name_en, descriptionAz: t.description_az, descriptionEn: t.description_en,
    accountCount: accounts.filter((a) => !a.isGroup).length, version: t.version, accounts,
    content: parseJson<TemplateContent>(t.content, { budgetingTypes: ['DEPARTMENT'], jobFamilies: [], units: [], costCenters: [], workflows: [], kpis: [], assumptionsAz: [], assumptionsEn: [] }),
  };
}

export interface ApplyOptions {
  accounts: boolean;
  excludedAccountCodes: string[];
  structure: boolean;
  costCenters: boolean;
  workflows: boolean;
  language: Lang;
}

/**
 * Merges a template into a company: only missing codes are created, existing data is never overwritten,
 * so applying again (or after customising) is safe.
 */
export function applyTemplate(companyId: number, userId: number, code: string, opts: ApplyOptions): SetupApplyResult {
  const tpl = getTemplate(code);
  const ts = nowIso();
  const result: SetupApplyResult = { accountsCreated: 0, accountsSkipped: 0, unitsCreated: 0, costCentersCreated: 0, workflowsCreated: 0 };
  const name = (az: string, en: string) => (opts.language === 'en' ? en : az);
  const alt = (az: string, en: string) => (opts.language === 'en' ? az : en);

  tx(() => {
    if (opts.accounts) {
      const excluded = new Set(opts.excludedAccountCodes.map((c) => c.toUpperCase()));
      // an excluded group excludes its subtree
      const parentOf = new Map(tpl.accounts.map((a) => [a.code, a.parentCode]));
      const isExcluded = (c: string): boolean => {
        let cur: string | null | undefined = c;
        while (cur) { if (excluded.has(cur.toUpperCase())) return true; cur = parentOf.get(cur); }
        return false;
      };
      const ids = new Map(all<{ id: number; code: string }>('SELECT id, code FROM accounts WHERE company_id = ?', companyId).map((a) => [a.code, a.id]));
      tpl.accounts.forEach((a, i) => {
        if (isExcluded(a.code)) return;
        if (ids.has(a.code)) { result.accountsSkipped++; return; }
        const parentId = a.parentCode ? ids.get(a.parentCode) ?? null : null;
        ids.set(a.code, run(
          `INSERT INTO accounts (company_id, parent_id, code, name, name_en, account_type, category, expense_class, is_group, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId, parentId, a.code, name(a.nameAz, a.nameEn), alt(a.nameAz, a.nameEn), a.accountType, a.category, a.expenseClass,
          a.isGroup ? 1 : 0, i, ts, ts,
        ).lastInsertRowid);
        result.accountsCreated++;
      });
    }

    const types = new Map(all<{ id: number; code: string }>('SELECT id, code FROM org_unit_types WHERE company_id = ?', companyId).map((t) => [t.code, t.id]));
    const units = new Map(all<{ id: number; code: string }>('SELECT id, code FROM org_units WHERE company_id = ?', companyId).map((u) => [u.code, u.id]));
    if (opts.structure) {
      for (const [code, id] of types) run('UPDATE org_unit_types SET in_budgeting = ? WHERE id = ?', tpl.content.budgetingTypes.includes(code) ? 1 : 0, id);
      const root = rootUnitId(companyId);
      tpl.content.units.forEach((u, i) => {
        if (units.has(u.code) || !types.has(u.type)) return;
        const parent = u.parent ? units.get(u.parent) : root;
        if (!parent) return;
        units.set(u.code, run(
          'INSERT INTO org_units (company_id, type_id, parent_id, code, name, name_en, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          companyId, types.get(u.type)!, parent, u.code, name(u.nameAz, u.nameEn), alt(u.nameAz, u.nameEn), i, ts, ts,
        ).lastInsertRowid);
        result.unitsCreated++;
      });
      for (const jf of tpl.content.jobFamilies) {
        run('INSERT OR IGNORE INTO job_families (company_id, code, name) VALUES (?, ?, ?)', companyId, jf.code, name(jf.nameAz, jf.nameEn));
      }
    }
    if (opts.costCenters) {
      const currency = get<{ base_currency: string }>('SELECT base_currency FROM companies WHERE id = ?', companyId)!.base_currency;
      const existing = new Set(all<{ code: string }>('SELECT code FROM cost_centers WHERE company_id = ?', companyId).map((c) => c.code));
      for (const c of tpl.content.costCenters) {
        const unit = units.get(c.unit);
        if (existing.has(c.code) || !unit) continue;
        run('INSERT INTO cost_centers (company_id, org_unit_id, code, name, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          companyId, unit, c.code, name(c.nameAz, c.nameEn), currency, ts, ts);
        result.costCentersCreated++;
      }
    }
    if (opts.workflows) {
      const names = new Set(all<{ k: string }>("SELECT workflow_type || '|' || name AS k FROM workflow_definitions WHERE company_id = ?", companyId).map((r) => r.k));
      for (const w of tpl.content.workflows) {
        if (names.has(`${w.type}|${w.name}`)) continue;
        saveDefinition(companyId, userId, null, {
          name: w.name, workflowType: w.type, description: null, priority: w.priority ?? 100, conditions: w.conditions ?? null,
          skipSelfApproval: true, isActive: true, effectiveFrom: null, effectiveTo: null,
          steps: w.steps.map((s, i) => ({
            seq: i + 1, name: s.name, approverType: s.approverType, approverConfig: s.config ?? {},
            condition: s.condition ?? null, slaHours: s.slaHours ?? null, escalation: null, ...(s.behaviour ?? {}),
          })),
        });
        result.workflowsCreated++;
      }
    }
    run('UPDATE companies SET industry_code = ?, setup_completed_at = COALESCE(setup_completed_at, ?) WHERE id = ?', code, ts, companyId);
    audit(companyId, userId, 'COMPANY', companyId, 'TEMPLATE_APPLIED', { template: code, ...result, options: opts });
  });
  return result;
}
