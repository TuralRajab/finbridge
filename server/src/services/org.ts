import type { RuleContext } from '@finbridge/shared';
import { all } from '../db/database';
import { badRequest, HttpError, notFound } from '../lib/errors';

export interface UnitNode {
  id: number;
  typeId: number;
  typeCode: string;
  typeName: string;
  inBudgeting: boolean;
  canHaveChildren: boolean;
  parentId: number | null;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  headUserId: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CcNode {
  id: number;
  code: string;
  name: string;
  orgUnitId: number;
  ownerUserId: number | null;
  responsibleUserId: number | null;
  isActive: boolean;
}

/**
 * In-memory view of one company's organisation tree (units + cost centers).
 * Company structures are small (hundreds of nodes), so loading per request keeps logic simple and correct.
 */
export class OrgIndex {
  readonly units = new Map<number, UnitNode>();
  readonly children = new Map<number | null, number[]>();
  readonly costCenters = new Map<number, CcNode>();
  readonly ccByUnit = new Map<number, number[]>();

  static load(companyId: number): OrgIndex {
    const idx = new OrgIndex();
    const rows = all<{
      id: number; type_id: number; type_code: string; type_name: string; in_budgeting: number; can_have_children: number;
      parent_id: number | null; code: string; name: string; name_en: string | null; description: string | null;
      head_user_id: number | null; is_active: number; sort_order: number;
    }>(
      `SELECT u.*, t.code AS type_code, t.name AS type_name, t.in_budgeting, t.can_have_children
         FROM org_units u JOIN org_unit_types t ON t.id = u.type_id
        WHERE u.company_id = ? ORDER BY u.sort_order, u.code`,
      companyId,
    );
    for (const r of rows) {
      idx.units.set(r.id, {
        id: r.id, typeId: r.type_id, typeCode: r.type_code, typeName: r.type_name, inBudgeting: r.in_budgeting === 1,
        canHaveChildren: r.can_have_children === 1, parentId: r.parent_id, code: r.code, name: r.name, nameEn: r.name_en,
        description: r.description, headUserId: r.head_user_id, isActive: r.is_active === 1, sortOrder: r.sort_order,
      });
      const list = idx.children.get(r.parent_id) ?? [];
      list.push(r.id);
      idx.children.set(r.parent_id, list);
    }
    for (const c of all<{ id: number; code: string; name: string; org_unit_id: number; owner_user_id: number | null; responsible_user_id: number | null; is_active: number }>(
      'SELECT id, code, name, org_unit_id, owner_user_id, responsible_user_id, is_active FROM cost_centers WHERE company_id = ? ORDER BY code', companyId,
    )) {
      idx.costCenters.set(c.id, {
        id: c.id, code: c.code, name: c.name, orgUnitId: c.org_unit_id, ownerUserId: c.owner_user_id,
        responsibleUserId: c.responsible_user_id, isActive: c.is_active === 1,
      });
      const list = idx.ccByUnit.get(c.org_unit_id) ?? [];
      list.push(c.id);
      idx.ccByUnit.set(c.org_unit_id, list);
    }
    return idx;
  }

  unit(id: number): UnitNode {
    const u = this.units.get(id);
    if (!u) throw notFound('Org unit');
    return u;
  }

  cc(id: number): CcNode {
    const c = this.costCenters.get(id);
    if (!c) throw notFound('Cost center');
    return c;
  }

  root(): UnitNode {
    const roots = this.children.get(null) ?? [];
    if (!roots.length) throw new HttpError(409, 'SETUP_REQUIRED', 'Company has no organisation root');
    return this.unit(roots[0]);
  }

  /** Self first, then parent … root. */
  ancestors(unitId: number, includeSelf = true): UnitNode[] {
    const out: UnitNode[] = [];
    const seen = new Set<number>();
    let cur: UnitNode | undefined = this.units.get(unitId);
    if (cur && !includeSelf) cur = cur.parentId ? this.units.get(cur.parentId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.parentId ? this.units.get(cur.parentId) : undefined;
    }
    return out;
  }

  path(unitId: number): string[] {
    return this.ancestors(unitId).reverse().map((u) => u.name);
  }

  subtree(unitId: number): Set<number> {
    const out = new Set<number>();
    const stack = [unitId];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(this.children.get(id) ?? []));
    }
    return out;
  }

  ccsInSubtree(unitId: number): CcNode[] {
    const units = this.subtree(unitId);
    return [...this.costCenters.values()].filter((c) => units.has(c.orgUnitId));
  }

  nearestOfType(unitId: number, typeCode: string): UnitNode | null {
    return this.ancestors(unitId).find((u) => u.typeCode === typeCode) ?? null;
  }

  /** Budget section = nearest ancestor-or-self whose type participates in budgeting, else the root. */
  sectionOf(unitId: number): UnitNode {
    return this.ancestors(unitId).find((u) => u.inBudgeting) ?? this.root();
  }

  sectionOfCostCenter(ccId: number): UnitNode {
    return this.sectionOf(this.cc(ccId).orgUnitId);
  }

  /** The top-level unit below the company root that contains `unitId` (the "executive area"). */
  topLevel(unitId: number): UnitNode {
    const chain = this.ancestors(unitId);
    return chain.length >= 2 ? chain[chain.length - 2] : chain[0];
  }

  ruleContextForUnit(unitId: number): RuleContext {
    const chain = this.ancestors(unitId);
    return {
      orgUnit: chain.map((u) => u.code),
      department: chain.find((u) => u.typeCode === 'DEPARTMENT')?.code ?? null,
      branch: chain.find((u) => u.typeCode === 'BRANCH')?.code ?? null,
    };
  }

  /** Validates placing `unitId` (of type `typeId`) under `parentId`. */
  assertValidParent(unitId: number | null, typeId: number, parentId: number | null, allowedParents: Map<number, Set<number>>): void {
    if (parentId === null) {
      if ((this.children.get(null) ?? []).some((id) => id !== unitId)) {
        throw badRequest('INVALID_HIERARCHY', 'Only the company root can be without a parent');
      }
      return;
    }
    const parent = this.unit(parentId);
    if (!parent.canHaveChildren) throw badRequest('INVALID_HIERARCHY', `${parent.typeName} units cannot have children`);
    if (unitId !== null && this.subtree(unitId).has(parentId)) {
      throw badRequest('INVALID_HIERARCHY', 'A unit cannot be moved under itself or its own descendant');
    }
    const allowed = allowedParents.get(typeId);
    if (allowed && allowed.size > 0 && !allowed.has(parent.typeId)) {
      throw badRequest('INVALID_HIERARCHY', `This unit type is not allowed under ${parent.typeName}`);
    }
  }
}

export function allowedParentsMap(companyId: number): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const r of all<{ type_id: number; parent_type_id: number }>(
    'SELECT p.type_id, p.parent_type_id FROM org_unit_type_parents p JOIN org_unit_types t ON t.id = p.type_id WHERE t.company_id = ?', companyId,
  )) {
    const s = m.get(r.type_id) ?? new Set<number>();
    s.add(r.parent_type_id);
    m.set(r.type_id, s);
  }
  return m;
}
