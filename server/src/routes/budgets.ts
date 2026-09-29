import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { applyUplift, BUDGET_ACTIONS, DEPT_ACTIONS, type BudgetEventDto } from '@finbridge/shared';
import { all, get, run, tx } from '../db/database';
import { companyIdOf, currentUser, requirePermission } from '../auth/middleware';
import { config } from '../config';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors';
import { monthsSchema, toId } from '../lib/params';
import { getScope } from '../lib/scope';
import {
  budgetDetail, canEditDepartment, departmentOfCostCenter, listLines, loadBudget, logEvent,
  markDepartmentInProgress, MONTH_COLS, toBudgetDto, type BudgetRow,
} from '../services/budgets';
import { assertUploadedFile, importBudget } from '../services/excel';
import { runBudgetAction, runDeptAction } from '../services/workflow';

export const budgetsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

budgetsRouter.get('/', requirePermission('budget.view'), (req, res) => {
  const companyId = companyIdOf(req);
  const scope = getScope(currentUser(req));
  const rows = all<BudgetRow>('SELECT * FROM budgets WHERE company_id = ? ORDER BY year DESC', companyId);
  res.json(rows.map((b) => toBudgetDto(b, scope)));
});

const createSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  name: z.string().trim().min(2).max(120),
  copyFromBudgetId: z.number().int().positive().nullable().optional(),
  upliftPct: z.number().min(-100).max(1000).default(0),
});

budgetsRouter.post('/', requirePermission('budget.create'), (req, res) => {
  const companyId = companyIdOf(req);
  const user = currentUser(req);
  const body = createSchema.parse(req.body);
  if (get('SELECT id FROM budgets WHERE company_id = ? AND year = ?', companyId, body.year)) {
    throw conflict('BUDGET_EXISTS', `A budget for ${body.year} already exists`);
  }
  const source = body.copyFromBudgetId ? loadBudget(companyId, body.copyFromBudgetId) : null;
  const id = tx(() => {
    const newId = run('INSERT INTO budgets (company_id, year, name, created_by) VALUES (?, ?, ?, ?)', companyId, body.year, body.name, user.id).lastInsertRowid;
    if (source) {
      const lines = all<Record<string, number | string>>('SELECT * FROM budget_lines WHERE budget_id = ?', source.id);
      const sql = `INSERT INTO budget_lines (budget_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, updated_by)
                   VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?)`;
      for (const l of lines) {
        const months = applyUplift(MONTH_COLS.map((m) => Number(l[m])), body.upliftPct);
        run(sql, newId, Number(l.cost_center_id), Number(l.account_id), String(l.description), ...months, user.id);
      }
    }
    logEvent({
      budgetId: newId, userId: user.id, action: 'created', toStatus: 'DRAFT',
      comment: source ? `Copied from ${source.year} (${body.upliftPct >= 0 ? '+' : ''}${body.upliftPct}%)` : null,
    });
    return newId;
  });
  res.status(201).json(budgetDetail(user, loadBudget(companyId, id)));
});

budgetsRouter.get('/:id', requirePermission('budget.view'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  res.json(budgetDetail(currentUser(req), b));
});

budgetsRouter.patch('/:id', requirePermission('budget.create'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
  run('UPDATE budgets SET name = ? WHERE id = ?', name, b.id);
  res.json(budgetDetail(currentUser(req), loadBudget(b.company_id, b.id)));
});

budgetsRouter.delete('/:id', requirePermission('budget.create'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  if (b.status !== 'DRAFT') throw conflict('INVALID_TRANSITION', 'Only draft budgets can be deleted');
  run('DELETE FROM budgets WHERE id = ?', b.id);
  res.status(204).end();
});

/* ------------------------------------------------------------------ workflow */

const commentSchema = z.object({ comment: z.string().max(2000).optional().nullable() });

budgetsRouter.post('/:id/actions/:action', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const action = z.enum(BUDGET_ACTIONS).parse(req.params.action);
  runBudgetAction(user, b, action, commentSchema.parse(req.body ?? {}).comment);
  res.json(budgetDetail(user, loadBudget(b.company_id, b.id)));
});

budgetsRouter.post('/:id/departments/:departmentId/actions/:action', requirePermission('budget.view'), (req, res) => {
  const user = currentUser(req);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const action = z.enum(DEPT_ACTIONS).parse(req.params.action);
  runDeptAction(user, b, toId(req.params.departmentId), action, commentSchema.parse(req.body ?? {}).comment);
  res.json(budgetDetail(user, loadBudget(b.company_id, b.id)));
});

budgetsRouter.get('/:id/events', requirePermission('budget.view'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const scope = getScope(currentUser(req));
  const rows = all<{
    id: number; action: string; from_status: string | null; to_status: string | null; comment: string | null;
    department_id: number | null; department_name: string | null; user_name: string | null; created_at: string;
  }>(
    `SELECT e.*, d.name AS department_name, u.full_name AS user_name
       FROM budget_events e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.budget_id = ? ORDER BY e.id DESC LIMIT 500`,
    b.id,
  );
  const events: BudgetEventDto[] = rows
    .filter((r) => scope.all || r.department_id === null || scope.departmentIds.has(r.department_id))
    .map((r) => ({
      id: r.id, action: r.action, fromStatus: r.from_status, toStatus: r.to_status, comment: r.comment,
      departmentName: r.department_name, userName: r.user_name ?? '—', createdAt: r.created_at,
    }));
  res.json(events);
});

/* ------------------------------------------------------------------ lines */

budgetsRouter.get('/:id/lines', requirePermission('budget.view'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const q = z.object({
    departmentId: z.coerce.number().int().positive().optional(),
    costCenterId: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  res.json(listLines(currentUser(req), b, q));
});

function assertEditable(req: Parameters<typeof currentUser>[0], b: BudgetRow, costCenterId: number): number {
  const user = currentUser(req);
  const departmentId = departmentOfCostCenter(b.company_id, costCenterId);
  const scope = getScope(user);
  if (!canEditDepartment(user, scope, b, departmentId)) {
    throw new HttpError(409, 'BUDGET_NOT_EDITABLE', 'These budget lines cannot be edited in the current status');
  }
  if (!scope.all && !scope.costCenterIds.has(costCenterId)) throw forbidden();
  return departmentId;
}

const lineCreateSchema = z.object({
  costCenterId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  description: z.string().trim().max(300).default(''),
  months: monthsSchema.optional(),
});

budgetsRouter.post('/:id/lines', requirePermission('budget.edit'), (req, res) => {
  const user = currentUser(req);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const body = lineCreateSchema.parse(req.body);
  const departmentId = assertEditable(req, b, body.costCenterId);
  if (!get('SELECT id FROM accounts WHERE id = ? AND company_id = ?', body.accountId, b.company_id)) throw notFound('Account');
  const months = body.months ?? Array.from({ length: 12 }, () => 0);
  const id = run(
    `INSERT INTO budget_lines (budget_id, cost_center_id, account_id, description, ${MONTH_COLS.join(', ')}, updated_by)
     VALUES (?, ?, ?, ?, ${MONTH_COLS.map(() => '?').join(', ')}, ?)`,
    b.id, body.costCenterId, body.accountId, body.description, ...months, user.id,
  ).lastInsertRowid;
  markDepartmentInProgress(b.id, departmentId);
  res.status(201).json(listLines(user, b).find((l) => l.id === id));
});

const bulkSchema = z.object({
  lines: z.array(z.object({
    id: z.number().int().positive(),
    description: z.string().trim().max(300).optional(),
    months: monthsSchema.optional(),
  })).min(1).max(2000),
});

budgetsRouter.patch('/:id/lines', requirePermission('budget.edit'), (req, res) => {
  const user = currentUser(req);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const { lines } = bulkSchema.parse(req.body);
  tx(() => {
    for (const l of lines) {
      const existing = get<{ cost_center_id: number; description: string }>(
        'SELECT cost_center_id, description FROM budget_lines WHERE id = ? AND budget_id = ?', l.id, b.id,
      );
      if (!existing) throw notFound('Budget line');
      const departmentId = assertEditable(req, b, existing.cost_center_id);
      if (l.months) {
        run(`UPDATE budget_lines SET ${MONTH_COLS.map((m) => `${m} = ?`).join(', ')} WHERE id = ?`, ...l.months, l.id);
      }
      run("UPDATE budget_lines SET description = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
        l.description ?? existing.description, user.id, l.id);
      markDepartmentInProgress(b.id, departmentId);
    }
  });
  res.json(listLines(user, b));
});

budgetsRouter.delete('/:id/lines/:lineId', requirePermission('budget.edit'), (req, res) => {
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  const line = get<{ cost_center_id: number }>('SELECT cost_center_id FROM budget_lines WHERE id = ? AND budget_id = ?', toId(req.params.lineId), b.id);
  if (!line) throw notFound('Budget line');
  const departmentId = assertEditable(req, b, line.cost_center_id);
  run('DELETE FROM budget_lines WHERE id = ?', toId(req.params.lineId));
  markDepartmentInProgress(b.id, departmentId);
  res.status(204).end();
});

/* ------------------------------------------------------------------ Excel import */

budgetsRouter.post('/:id/import', requirePermission('excel.import', 'budget.edit'), upload.single('file'), async (req, res) => {
  const user = currentUser(req);
  const b = loadBudget(companyIdOf(req), toId(req.params.id));
  if (b.status !== 'DRAFT' && b.status !== 'COLLECTING') {
    throw new HttpError(409, 'BUDGET_NOT_EDITABLE', 'Only draft or collecting budgets can be imported into');
  }
  const opts = z.object({
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    mode: z.enum(['replace', 'append']).default('replace'),
    createMissing: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  }).parse(req.body ?? {});
  const buffer = assertUploadedFile(req.file);
  const report = await importBudget(user, b, buffer, opts);
  if (!report.dryRun && report.errors.length) throw badRequest('IMPORT_FAILED', 'The file has errors', report);
  res.json(report);
});
