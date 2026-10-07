import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { BULK_IMPORT_KINDS, can, type BulkImportKind, type BulkImportKindDto, type Lang } from '@finbridge/shared';
import { companyIdOf, currentUser } from '../auth/middleware';
import { config } from '../config';
import { forbidden } from '../lib/errors';
import { assertUploadedFile, sendWorkbook } from '../services/excel';
import { buildTemplate, columnDtos, runImport } from '../services/bulkImport/engine';
import { ENTITIES } from '../services/bulkImport/entities';

export const bulkImportRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

const langOf = (req: Request): Lang => (req.query.lang === 'en' || req.query.lang === 'az' ? req.query.lang : currentUser(req).language);
const kindParam = z.enum(BULK_IMPORT_KINDS);

/** Template download needs the entity's manage permission; importing additionally needs excel.import. */
function entityFor(req: Request, importing: boolean) {
  const def = ENTITIES[kindParam.parse(String(req.params.kind).toUpperCase()) as BulkImportKind];
  const user = currentUser(req);
  if (!can(user.role, def.permission) || (importing && !can(user.role, 'excel.import'))) throw forbidden();
  return def;
}

bulkImportRouter.get('/kinds', (req, res) => {
  const user = currentUser(req);
  const companyId = companyIdOf(req);
  const lang = langOf(req);
  const L = (az: string, en: string) => (lang === 'en' ? en : az);
  res.json(BULK_IMPORT_KINDS.map((k) => ENTITIES[k]).filter((d) => can(user.role, d.permission)).map((d): BulkImportKindDto => ({
    kind: d.kind, title: L(d.titleAz, d.titleEn), description: L(d.descriptionAz, d.descriptionEn), matchBy: L(d.matchByAz, d.matchByEn),
    columns: columnDtos(d, companyId, lang), existing: d.count(companyId), canImport: can(user.role, 'excel.import'), needsPassword: !!d.needsPassword,
  })));
});

bulkImportRouter.get('/:kind/template', async (req, res) => {
  const def = entityFor(req, false);
  const lang = langOf(req);
  const prefill = req.query.prefill === '1' || req.query.prefill === 'true';
  const name = `finbridge-${def.kind.toLowerCase().replace(/_/g, '-')}-${prefill ? (lang === 'en' ? 'current' : 'movcud') : (lang === 'en' ? 'template' : 'sablon')}.xlsx`;
  sendWorkbook(res, name, await buildTemplate(def, companyIdOf(req), lang, prefill));
});

bulkImportRouter.post('/:kind', upload.single('file'), async (req, res) => {
  const def = entityFor(req, true);
  const b = z.object({
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    mode: z.enum(['upsert', 'create']).default('upsert'),
    initialPassword: z.string().min(8).max(200).optional().or(z.literal('').transform(() => undefined)),
  }).parse(req.body ?? {});
  const buffer = assertUploadedFile(req.file);
  res.json(await runImport(def, currentUser(req), buffer, { dryRun: b.dryRun, mode: b.mode, initialPassword: b.initialPassword ?? null, fileName: req.file!.originalname, lang: langOf(req) }));
});
