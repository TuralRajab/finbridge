import { Router } from 'express';
import { z } from 'zod';
import type { JobFamilyDto, OrgUnitDto, OrgUnitTypeDto, PositionDto } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { audit, diff } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, conflict, notFound } from '../lib/errors';
import { toId } from '../lib/params';
import { allowedParentsMap, OrgIndex } from '../services/org';

export const orgRouter = Router();

const code = z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N}_\-.]+$/u, 'Letters, digits, - _ . only');
const name = z.string().trim().min(1).max(160);
const optUser = z.number().int().positive().nullable().optional();

function assertUser(companyId: number, id: number | null | undefined): void {
  if (id && !get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', id, companyId)) throw notFound('User');
}

/* ------------------------------------------------------------------ unit types */

export function listTypes(companyId: number): OrgUnitTypeDto[] {
  const parents = allowedParentsMap(companyId);
  return all<{ id: number; code: string; name: string; name_en: string | null; can_have_children: number; requires_cost_center: number; in_budgeting: number; in_workflow: number; is_active: number; sort_order: number; n: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM org_units u WHERE u.type_id = t.id) AS n FROM org_unit_types t WHERE t.company_id = ? ORDER BY t.sort_order, t.code`, companyId,
  ).map((t) => ({
    id: t.id, code: t.code, name: t.name, nameEn: t.name_en, canHaveChildren: t.can_have_children === 1, requiresCostCenter: t.requires_cost_center === 1,
    inBudgeting: t.in_budgeting === 1, inWorkflow: t.in_workflow === 1, isActive: t.is_active === 1, sortOrder: t.sort_order,
    allowedParentTypeIds: [...(parents.get(t.id) ?? [])], unitCount: t.n,
  }));
}

orgRouter.get('/types', requirePermission('masterdata.view'), (req, res) => { res.json(listTypes(companyIdOf(req))); });

const typeSchema = z.object({
  code, name, nameEn: z.string().trim().max(160).nullable().optional(),
  canHaveChildren: z.boolean().default(true), requiresCostCenter: z.boolean().default(false), inBudgeting: z.boolean().default(false),
  inWorkflow: z.boolean().default(true), isActive: z.boolean().default(true), sortOrder: z.number().int().default(50),
  allowedParentTypeIds: z.array(z.number().int().positive()).default([]),
});

function saveParents(companyId: number, typeId: number, parentIds: number[]): void {
  for (const p of parentIds) if (!get('SELECT 1 FROM org_unit_types WHERE id = ? AND company_id = ?', p, companyId)) throw notFound('Parent type');
  run('DELETE FROM org_unit_type_parents WHERE type_id = ?', typeId);
  for (const p of new Set(parentIds)) run('INSERT INTO org_unit_type_parents (type_id, parent_type_id) VALUES (?, ?)', typeId, p);
}

orgRouter.post('/types', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = typeSchema.parse(req.body);
  const id = tx(() => {
    const tid = run(`INSERT INTO org_unit_types (company_id, code, name, name_en, can_have_children, requires_cost_center, in_budgeting, in_workflow, is_active, sort_order, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      companyId, b.code.toUpperCase(), b.name, b.nameEn ?? null, +b.canHaveChildren, +b.requiresCostCenter, +b.inBudgeting, +b.inWorkflow, +b.isActive, b.sortOrder, nowIso()).lastInsertRowid;
    saveParents(companyId, tid, b.allowedParentTypeIds);
    audit(companyId, currentUser(req).id, 'ORG_UNIT_TYPE', tid, 'CREATED', b);
    return tid;
  });
  res.status(201).json(listTypes(companyId).find((t) => t.id === id));
});

orgRouter.patch('/types/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = typeSchema.partial().parse(req.body);
  const t = listTypes(companyId).find((x) => x.id === id);
  if (!t) throw notFound('Org unit type');
  if (t.code === 'COMPANY' && b.isActive === false) throw badRequest('VALIDATION_ERROR', 'The company type cannot be deactivated');
  tx(() => {
    run(`UPDATE org_unit_types SET name = ?, name_en = ?, can_have_children = ?, requires_cost_center = ?, in_budgeting = ?, in_workflow = ?, is_active = ?, sort_order = ? WHERE id = ?`,
      b.name ?? t.name, b.nameEn !== undefined ? b.nameEn : t.nameEn, +(b.canHaveChildren ?? t.canHaveChildren), +(b.requiresCostCenter ?? t.requiresCostCenter),
      +(b.inBudgeting ?? t.inBudgeting), +(b.inWorkflow ?? t.inWorkflow), +(b.isActive ?? t.isActive), b.sortOrder ?? t.sortOrder, id);
    if (b.allowedParentTypeIds) saveParents(companyId, id, b.allowedParentTypeIds);
    audit(companyId, currentUser(req).id, 'ORG_UNIT_TYPE', id, 'UPDATED', diff(t as unknown as Record<string, unknown>, b));
  });
  res.json(listTypes(companyId).find((x) => x.id === id));
});

/* ------------------------------------------------------------------ units */

export function listUnits(companyId: number): OrgUnitDto[] {
  const idx = OrgIndex.load(companyId);
  const heads = new Map(all<{ id: number; full_name: string }>('SELECT id, full_name FROM users WHERE company_id = ?', companyId).map((u) => [u.id, u.full_name]));
  return [...idx.units.values()].map((u) => ({
    id: u.id, typeId: u.typeId, typeCode: u.typeCode, typeName: u.typeName, parentId: u.parentId, code: u.code, name: u.name, nameEn: u.nameEn,
    description: u.description, headUserId: u.headUserId, headName: u.headUserId ? heads.get(u.headUserId) ?? null : null, isActive: u.isActive,
    sortOrder: u.sortOrder, costCenterCount: idx.ccByUnit.get(u.id)?.length ?? 0, childCount: idx.children.get(u.id)?.length ?? 0, path: idx.path(u.id),
  }));
}

orgRouter.get('/units', requirePermission('masterdata.view'), (req, res) => { res.json(listUnits(companyIdOf(req))); });

const unitSchema = z.object({
  typeId: z.number().int().positive(), parentId: z.number().int().positive(), code, name, nameEn: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(), headUserId: optUser, isActive: z.boolean().default(true), sortOrder: z.number().int().default(0),
});

function assertType(companyId: number, typeId: number): void {
  const t = get<{ is_active: number; code: string }>('SELECT is_active, code FROM org_unit_types WHERE id = ? AND company_id = ?', typeId, companyId);
  if (!t) throw notFound('Org unit type');
  if (t.is_active !== 1) throw badRequest('INVALID_HIERARCHY', 'This unit type is inactive');
  if (t.code === 'COMPANY') throw badRequest('INVALID_HIERARCHY', 'There is only one company root');
}

orgRouter.post('/units', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = unitSchema.parse(req.body);
  assertType(companyId, b.typeId);
  assertUser(companyId, b.headUserId);
  OrgIndex.load(companyId).assertValidParent(null, b.typeId, b.parentId, allowedParentsMap(companyId));
  const ts = nowIso();
  const id = run(`INSERT INTO org_units (company_id, type_id, parent_id, code, name, name_en, description, head_user_id, is_active, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, b.typeId, b.parentId, b.code, b.name, b.nameEn ?? null, b.description ?? null, b.headUserId ?? null, +b.isActive, b.sortOrder, ts, ts).lastInsertRowid;
  audit(companyId, currentUser(req).id, 'ORG_UNIT', id, 'CREATED', b);
  res.status(201).json(listUnits(companyId).find((u) => u.id === id));
});

orgRouter.patch('/units/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = unitSchema.partial().parse(req.body);
  const idx = OrgIndex.load(companyId);
  const u = idx.unit(id);
  if (b.typeId && b.typeId !== u.typeId) assertType(companyId, b.typeId);
  assertUser(companyId, b.headUserId);
  const isRoot = u.parentId === null;
  if (isRoot && b.parentId) throw badRequest('INVALID_HIERARCHY', 'The company root cannot be moved');
  if (isRoot && b.isActive === false) throw badRequest('INVALID_HIERARCHY', 'The company root cannot be deactivated');
  const parentId = b.parentId ?? u.parentId;
  const typeId = b.typeId ?? u.typeId;
  if (!isRoot && (b.parentId !== undefined || b.typeId !== undefined)) idx.assertValidParent(id, typeId, parentId, allowedParentsMap(companyId));
  if (b.isActive === false) {
    const activeCcs = idx.ccsInSubtree(id).filter((c) => c.isActive);
    if (activeCcs.length) throw conflict('IN_USE', `Deactivate or move its cost centers first (${activeCcs.map((c) => c.code).join(', ')})`);
  }
  run(`UPDATE org_units SET type_id = ?, parent_id = ?, code = ?, name = ?, name_en = ?, description = ?, head_user_id = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    typeId, parentId, b.code ?? u.code, b.name ?? u.name, b.nameEn !== undefined ? b.nameEn : u.nameEn, b.description !== undefined ? b.description : u.description,
    b.headUserId !== undefined ? b.headUserId : u.headUserId, b.isActive === undefined ? +u.isActive : +b.isActive, b.sortOrder ?? u.sortOrder, nowIso(), id);
  audit(companyId, currentUser(req).id, 'ORG_UNIT', id, b.parentId && b.parentId !== u.parentId ? 'MOVED' : 'UPDATED', diff(u as unknown as Record<string, unknown>, b));
  res.json(listUnits(companyId).find((x) => x.id === id));
});

/* ------------------------------------------------------------------ job families & positions */

orgRouter.get('/job-families', requirePermission('masterdata.view'), (req, res) => {
  res.json(all<{ id: number; code: string; name: string; owner_user_id: number | null; owner: string | null; is_active: number }>(
    'SELECT j.*, u.full_name AS owner FROM job_families j LEFT JOIN users u ON u.id = j.owner_user_id WHERE j.company_id = ? ORDER BY j.code', companyIdOf(req),
  ).map((j): JobFamilyDto => ({ id: j.id, code: j.code, name: j.name, ownerUserId: j.owner_user_id, ownerName: j.owner, isActive: j.is_active === 1 })));
});

const jfSchema = z.object({ code, name, ownerUserId: optUser, isActive: z.boolean().default(true) });

orgRouter.post('/job-families', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = jfSchema.parse(req.body);
  assertUser(companyId, b.ownerUserId);
  const id = run('INSERT INTO job_families (company_id, code, name, owner_user_id, is_active) VALUES (?, ?, ?, ?, ?)', companyId, b.code, b.name, b.ownerUserId ?? null, +b.isActive).lastInsertRowid;
  audit(companyId, currentUser(req).id, 'JOB_FAMILY', id, 'CREATED', b);
  res.status(201).json({ id });
});

orgRouter.patch('/job-families/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = jfSchema.partial().parse(req.body);
  const j = get<{ code: string; name: string; owner_user_id: number | null; is_active: number }>('SELECT * FROM job_families WHERE id = ? AND company_id = ?', id, companyId);
  if (!j) throw notFound('Job family');
  assertUser(companyId, b.ownerUserId);
  run('UPDATE job_families SET code = ?, name = ?, owner_user_id = ?, is_active = ? WHERE id = ?', b.code ?? j.code, b.name ?? j.name,
    b.ownerUserId !== undefined ? b.ownerUserId : j.owner_user_id, b.isActive === undefined ? j.is_active : +b.isActive, id);
  audit(companyId, currentUser(req).id, 'JOB_FAMILY', id, 'UPDATED', b);
  res.json({ id });
});

orgRouter.get('/positions', requirePermission('masterdata.view'), (req, res) => {
  res.json(all<{ id: number; code: string; title: string; org_unit_id: number | null; unit: string | null; holder_user_id: number | null; holder: string | null; is_active: number }>(
    `SELECT p.*, o.name AS unit, u.full_name AS holder FROM positions p LEFT JOIN org_units o ON o.id = p.org_unit_id LEFT JOIN users u ON u.id = p.holder_user_id
      WHERE p.company_id = ? ORDER BY p.code`, companyIdOf(req),
  ).map((p): PositionDto => ({ id: p.id, code: p.code, title: p.title, orgUnitId: p.org_unit_id, orgUnitName: p.unit, holderUserId: p.holder_user_id, holderName: p.holder, isActive: p.is_active === 1 })));
});

const posSchema = z.object({ code, title: name, orgUnitId: z.number().int().positive().nullable().optional(), holderUserId: optUser, isActive: z.boolean().default(true) });

orgRouter.post('/positions', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const b = posSchema.parse(req.body);
  assertUser(companyId, b.holderUserId);
  if (b.orgUnitId && !get('SELECT 1 FROM org_units WHERE id = ? AND company_id = ?', b.orgUnitId, companyId)) throw notFound('Org unit');
  const id = run('INSERT INTO positions (company_id, code, title, org_unit_id, holder_user_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    companyId, b.code, b.title, b.orgUnitId ?? null, b.holderUserId ?? null, +b.isActive).lastInsertRowid;
  audit(companyId, currentUser(req).id, 'POSITION', id, 'CREATED', b);
  res.status(201).json({ id });
});

orgRouter.patch('/positions/:id', requirePermission('org.manage'), (req, res) => {
  const companyId = companyIdOf(req);
  const id = toId(req.params.id);
  const b = posSchema.partial().parse(req.body);
  const p = get<{ code: string; title: string; org_unit_id: number | null; holder_user_id: number | null; is_active: number }>('SELECT * FROM positions WHERE id = ? AND company_id = ?', id, companyId);
  if (!p) throw notFound('Position');
  assertUser(companyId, b.holderUserId);
  run('UPDATE positions SET code = ?, title = ?, org_unit_id = ?, holder_user_id = ?, is_active = ? WHERE id = ?', b.code ?? p.code, b.title ?? p.title,
    b.orgUnitId !== undefined ? b.orgUnitId : p.org_unit_id, b.holderUserId !== undefined ? b.holderUserId : p.holder_user_id, b.isActive === undefined ? p.is_active : +b.isActive, id);
  audit(companyId, currentUser(req).id, 'POSITION', id, 'UPDATED', b);
  res.json({ id });
});
