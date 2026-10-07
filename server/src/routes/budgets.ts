import { userCan } from '../lib/permissions';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AuditLogDto } from '@finbridge/shared';
import { all } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { config } from '../config';
import { badRequest } from '../lib/errors';
import { parseJson } from '../lib/json';
import { monthsSchema, toId } from '../lib/params';
import { getScope } from '../lib/scope';
import {
  addLine, budgetDetail, compareVersions, createBudget, deleteLine, listLines, loadBudget, lockVersion, reopenSection,
  submitSection, submitVersion, toBudgetDto, updateLines, type BudgetRow,
} from '../services/budgets';
import { assertUploadedFile, importBudget } from '../services/excel';
import { planningComparison, planningMonthly, type PlanningQuery } from '../services/planning';
import { forbidden } from '../lib/errors';

export const budgetsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

budgetsRouter.get('/', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const scope = getScope(user);
  res.json(all<BudgetRow>('SELECT * FROM budgets WHERE company_id = ? ORDER BY fiscal_year DESC', companyIdOf(req)).map((b) => toBudgetDto(b, scope)));
});

const createSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  name: z.string().trim().min(2).max(120),
  copyFromBudgetId: z.number().int().positive().nullable().optional(),
  upliftPct: z.number().min(-100).max(1000).default(0),
});

budgetsRouter.post('/', requirePermission('budget.create'), (req, res) => {
  const user = currentUser(req);
  const b = createBudget(user, createSchema.parse(req.body));
  res.status(201).json(budgetDetail(user, b));
});

budgetsRouter.get('/:id', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const versionId = req.query.versionId ? toId(req.query.versionId) : undefined;
  res.json(budgetDetail(user, loadBudget(companyIdOf(req), toId(req.params.id)), versionId));
});

budgetsRouter.get('/:id/lines', requirePermission('budget.view'), (req, res) => {
  const q = z.object({
    versionId: z.coerce.number().int().positive().optional(),
    sectionUnitId: z.coerce.number().int().positive().optional(),
    costCenterId: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  res.json(listLines(currentUser(req), loadBudget(companyIdOf(req), toId(req.params.id)), q.versionId ?? null, q));
});

budgetsRouter.post('/:id/lines', requirePermission('budget.edit'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  const b = z.object({
    costCenterId: z.number().int().positive(), accountId: z.number().int().positive(),
    description: z.string().trim().max(300).default(''), months: monthsSchema.default(Array(12).fill(0)),
  }).parse(req.body);
  const id = addLine(user, budget, b);
  res.status(201).json(listLines(user, budget, null).find((l) => l.id === id));
});

budgetsRouter.patch('/:id/lines', requirePermission('budget.edit'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  const { lines } = z.object({
    lines: z.array(z.object({ id: z.number().int().positive(), description: z.string().trim().max(300).optional(), months: monthsSchema.optional() })).min(1).max(5000),
  }).parse(req.body);
  updateLines(user, budget, lines);
  res.json(listLines(user, budget, null));
});

budgetsRouter.delete('/:id/lines/:lineId', requirePermission('budget.edit'), (req, res) => {
  deleteLine(currentUser(req), loadBudget(companyIdOf(req), toId(req.params.id)), toId(req.params.lineId));
  res.status(204).end();
});

/* ------------------------------------------------------------------ workflow */

const comment = z.object({ comment: z.string().max(2000).nullable().optional() });

budgetsRouter.post('/:id/sections/:unitId/submit', requirePermission('budget.submit'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  submitSection(user, budget, toId(req.params.unitId));
  res.json(budgetDetail(user, loadBudget(budget.company_id, budget.id)));
});

budgetsRouter.post('/:id/sections/:unitId/reopen', requirePermission('budget.manage'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  reopenSection(user, budget, toId(req.params.unitId), comment.parse(req.body ?? {}).comment ?? null);
  res.json(budgetDetail(user, budget));
});

budgetsRouter.post('/:id/submit', requirePermission('budget.manage'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  submitVersion(user, budget);
  res.json(budgetDetail(user, loadBudget(budget.company_id, budget.id)));
});

budgetsRouter.post('/:id/lock', requirePermission('budget.manage'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  lockVersion(user.id, budget);
  res.json(budgetDetail(user, loadBudget(budget.company_id, budget.id)));
});

budgetsRouter.get('/:id/compare', requirePermission('budget.view'), (req, res) => {
  const q = z.object({ a: z.coerce.number().int().positive(), b: z.coerce.number().int().positive() }).parse(req.query);
  const user = currentUser(req);
  if (!getScope(user).all) throw forbidden('Version comparison is available to company-wide roles');
  res.json(compareVersions(loadBudget(companyIdOf(req), toId(req.params.id)), q.a, q.b));
});

/** Budget-level audit trail (versions, sections, lines, imports). */
budgetsRouter.get('/:id/history', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  if (!userCan(user, 'audit.view') && !userCan(user, 'budget.manage')) { res.json([]); return; }
  const rows = all<{ id: number; user_name: string | null; entity_type: string; entity_id: number | null; action: string; changes: string | null; created_at: string }>(
    `SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.company_id = ? AND ((a.entity_type = 'BUDGET' AND a.entity_id = ?)
         OR (a.entity_type = 'BUDGET_VERSION' AND a.entity_id IN (SELECT id FROM budget_versions WHERE budget_id = ?))
         OR (a.entity_type = 'BUDGET_SECTION' AND a.entity_id IN (SELECT s.id FROM budget_sections s JOIN budget_versions v ON v.id = s.version_id WHERE v.budget_id = ?))
         OR (a.entity_type = 'BUDGET_LINE' AND a.entity_id IN (SELECT l.id FROM budget_lines l JOIN budget_versions v ON v.id = l.version_id WHERE v.budget_id = ?)))
      ORDER BY a.id DESC LIMIT 500`,
    budget.company_id, budget.id, budget.id, budget.id, budget.id,
  );
  res.json(rows.map((r): AuditLogDto => ({ id: r.id, userName: r.user_name, entityType: r.entity_type, entityId: r.entity_id, action: r.action, changes: parseJson(r.changes, null), createdAt: r.created_at })));
});

budgetsRouter.post('/:id/import', requirePermission('excel.import', 'budget.manage'), upload.single('file'), async (req, res) => {
  const user = currentUser(req);
  const budget = loadBudget(companyIdOf(req), toId(req.params.id));
  const o = z.object({
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    mode: z.enum(['replace', 'append']).default('replace'),
    createMissing: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    mapping: z.string().optional(),
  }).parse(req.body ?? {});
  const buffer = assertUploadedFile(req.file);
  const report = await importBudget(user, budget, buffer, { ...o, mapping: o.mapping ? parseJson(o.mapping, undefined) : undefined, fileName: req.file!.originalname });
  if (!report.dryRun && report.errors.length) throw badRequest('IMPORT_FAILED', 'The file has errors', report);
  res.json(report);
});

/* ------------------------------------------------------------------ planning comparison (prior years vs plan) */

const planningSchema = z.object({
  versionId: z.coerce.number().int().positive().optional(),
  groupBy: z.enum(['section', 'costCenter', 'account', 'line']).default('section'),
  unitId: z.coerce.number().int().positive().optional(),
  costCenterId: z.coerce.number().int().positive().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  years: z.coerce.number().int().min(1).max(3).default(2),
  forecast: z.enum(['budget', 'run_rate']).default('budget'),
});

/** Prior years' original / final budget and actuals next to the plan of the selected version, grouped and drillable. */
budgetsRouter.get('/:id/planning', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const q: PlanningQuery = planningSchema.parse(req.query);
  res.json(planningComparison(user, loadBudget(companyIdOf(req), toId(req.params.id)), q));
});

/** 12-month series per prior year (budget, actual) and the plan, for the slice selected by the filters. */
budgetsRouter.get('/:id/planning/monthly', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const q: PlanningQuery = planningSchema.parse(req.query);
  res.json(planningMonthly(user, loadBudget(companyIdOf(req), toId(req.params.id)), q));
});
