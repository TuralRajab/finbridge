import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AttachmentDto } from '@finbridge/shared';
import { all, get, run } from '../db/database';
import { companyIdOf, currentUser } from '../auth/middleware';
import { config } from '../config';
import { audit } from '../lib/audit';
import { nowIso } from '../lib/clock';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toId } from '../lib/params';
import { getScope } from '../lib/scope';
import type { UserRow } from '../lib/mappers';
import { canViewCr, loadCr } from '../services/changeRequests';
import { canViewPr, loadPr } from '../services/purchaseRequests';

export const attachmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });
const entity = z.enum(['PURCHASE_REQUEST', 'CHANGE_REQUEST']);

function assertAccess(user: UserRow, type: z.infer<typeof entity>, id: number): void {
  const companyId = user.company_id!;
  const ok = type === 'PURCHASE_REQUEST' ? canViewPr(user, loadPr(companyId, id), getScope(user)) : canViewCr(user, loadCr(companyId, id));
  if (!ok) throw forbidden();
}

attachmentsRouter.get('/', (req, res) => {
  const q = z.object({ entityType: entity, entityId: z.coerce.number().int().positive() }).parse(req.query);
  assertAccess(currentUser(req), q.entityType, q.entityId);
  res.json(all<{ id: number; file_name: string; mime_type: string; size_bytes: number; uploader: string | null; created_at: string }>(
    `SELECT a.id, a.file_name, a.mime_type, a.size_bytes, u.full_name AS uploader, a.created_at FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.company_id = ? AND a.entity_type = ? AND a.entity_id = ? ORDER BY a.id`, companyIdOf(req), q.entityType, q.entityId,
  ).map((a): AttachmentDto => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes, uploadedBy: a.uploader ?? '—', createdAt: a.created_at })));
});

attachmentsRouter.post('/', upload.single('file'), (req, res) => {
  const user = currentUser(req);
  const b = z.object({ entityType: entity, entityId: z.coerce.number().int().positive() }).parse(req.body ?? {});
  assertAccess(user, b.entityType, b.entityId);
  if (!req.file) throw badRequest('VALIDATION_ERROR', 'No file');
  const id = run('INSERT INTO attachments (company_id, entity_type, entity_id, file_name, mime_type, size_bytes, data, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    user.company_id!, b.entityType, b.entityId, req.file.originalname, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, user.id, nowIso()).lastInsertRowid;
  audit(user.company_id, user.id, b.entityType, b.entityId, 'ATTACHMENT_ADDED', { file: req.file.originalname, size: req.file.size });
  res.status(201).json({ id });
});

attachmentsRouter.get('/:id/download', (req, res) => {
  const user = currentUser(req);
  const a = get<{ entity_type: 'PURCHASE_REQUEST' | 'CHANGE_REQUEST'; entity_id: number; file_name: string; mime_type: string; data: Uint8Array }>(
    'SELECT * FROM attachments WHERE id = ? AND company_id = ?', toId(req.params.id), companyIdOf(req),
  );
  if (!a) throw notFound('Attachment');
  assertAccess(user, a.entity_type, a.entity_id);
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.file_name)}"`);
  res.send(Buffer.from(a.data));
});
