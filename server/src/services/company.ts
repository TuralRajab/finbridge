import { get, run, tx } from '../db/database';
import { nowIso } from '../lib/clock';
import { DEFAULT_UNIT_TYPES } from '../templates/data';
import { ensureSystemRoles } from './roles';

/** Creates the per-company defaults: org unit types, the company root unit, settings and the BASE scenario. */
export function bootstrapCompany(companyId: number, companyName: string): number {
  return tx(() => {
    const ts = nowIso();
    const ids = new Map<string, number>();
    for (const t of DEFAULT_UNIT_TYPES) {
      ids.set(t.code, run(
        `INSERT INTO org_unit_types (company_id, code, name, name_en, can_have_children, in_budgeting, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        companyId, t.code, t.name, t.nameEn, t.canHaveChildren ? 1 : 0, t.inBudgeting ? 1 : 0, t.sort, ts,
      ).lastInsertRowid);
    }
    for (const t of DEFAULT_UNIT_TYPES) {
      for (const p of t.parents) run('INSERT INTO org_unit_type_parents (type_id, parent_type_id) VALUES (?, ?)', ids.get(t.code)!, ids.get(p)!);
    }
    const rootId = run(
      'INSERT INTO org_units (company_id, type_id, parent_id, code, name, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)',
      companyId, ids.get('COMPANY')!, 'ROOT', companyName, ts, ts,
    ).lastInsertRowid;
    run('INSERT INTO company_settings (company_id, updated_at) VALUES (?, ?)', companyId, ts);
    run("INSERT INTO budget_scenarios (company_id, code, name, is_default) VALUES (?, 'BASE', 'Əsas ssenari', 1)", companyId);
    ensureSystemRoles(companyId);
    return rootId;
  });
}

export function rootUnitId(companyId: number): number {
  return get<{ id: number }>('SELECT id FROM org_units WHERE company_id = ? AND parent_id IS NULL ORDER BY id LIMIT 1', companyId)!.id;
}
