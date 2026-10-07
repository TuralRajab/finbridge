import { Router } from 'express';
import { z } from 'zod';
import type { AuditLogDto, ImportJobDto } from '@finbridge/shared';
import { all } from '../db/database';
import { companyIdOf, requirePermission } from '../auth/middleware';
import { parseJson } from '../lib/json';

export const auditRouter = Router();

auditRouter.get('/logs', requirePermission('audit.view'), (req, res) => {
  const q = z.object({ entityType: z.string().optional(), entityId: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
  const rows = all<{ id: number; user_name: string | null; entity_type: string; entity_id: number | null; action: string; changes: string | null; created_at: string }>(
    `SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ?
       ${q.entityType ? 'AND a.entity_type = ?' : ''}${q.entityId ? ' AND a.entity_id = ?' : ''} ORDER BY a.id DESC LIMIT ?`,
    companyIdOf(req), ...(q.entityType ? [q.entityType] : []), ...(q.entityId ? [q.entityId] : []), q.limit,
  );
  res.json(rows.map((r): AuditLogDto => ({ id: r.id, userName: r.user_name, entityType: r.entity_type, entityId: r.entity_id, action: r.action, changes: parseJson(r.changes, null), createdAt: r.created_at })));
});

auditRouter.get('/workflow-actions', requirePermission('audit.view'), (req, res) => {
  res.json(all<{ id: number; instance_id: number; workflow_type: string; definition_name: string; entity_type: string; entity_id: number; action: string; user_name: string | null; from_status: string | null; to_status: string | null; comment: string | null; created_at: string }>(
    `SELECT a.id, a.instance_id, i.workflow_type, i.definition_name, i.entity_type, i.entity_id, a.action, u.full_name AS user_name, a.from_status, a.to_status, a.comment, a.created_at
       FROM workflow_actions a JOIN workflow_instances i ON i.id = a.instance_id LEFT JOIN users u ON u.id = a.user_id
      WHERE i.company_id = ? ORDER BY a.id DESC LIMIT 500`, companyIdOf(req),
  ));
});

auditRouter.get('/imports', requirePermission('excel.import'), (req, res) => {
  res.json(all<{ id: number; kind: ImportJobDto['kind']; file_name: string; status: ImportJobDto['status']; rows_read: number; rows_valid: number; total: number; created_count: number; updated_count: number; unchanged_count: number; errors: string | null; user_name: string | null; created_at: string }>(
    'SELECT j.*, u.full_name AS user_name FROM import_jobs j LEFT JOIN users u ON u.id = j.user_id WHERE j.company_id = ? ORDER BY j.id DESC LIMIT 200', companyIdOf(req),
  ).map((j): ImportJobDto => ({
    id: j.id, kind: j.kind, fileName: j.file_name, status: j.status, rowsRead: j.rows_read, rowsValid: j.rows_valid, total: j.total,
    createdCount: j.created_count, updatedCount: j.updated_count, unchangedCount: j.unchanged_count,
    errorCount: parseJson<{ level?: string }[]>(j.errors, []).filter((e) => e.level !== 'warning').length, userName: j.user_name, createdAt: j.created_at,
  })));
});
