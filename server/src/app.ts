import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { requireAuth } from './auth/middleware';
import { errorHandler, notFound } from './lib/errors';
// services register their workflow handlers on import
import './services/budgets';
import './services/purchaseRequests';
import './services/changeRequests';
import { actualsRouter } from './routes/actuals';
import { attachmentsRouter } from './routes/attachments';
import { auditRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { budgetsRouter } from './routes/budgets';
import { changesRouter } from './routes/changes';
import { companyRouter } from './routes/company';
import { exportsRouter } from './routes/exports';
import { accountsRouter, costCentersRouter } from './routes/masterdata';
import { orgRouter } from './routes/org';
import { platformRouter } from './routes/platform';
import { reportsRouter } from './routes/reports';
import { requestsRouter } from './routes/requests';
import { templatesRouter } from './routes/templates';
import { usersRouter } from './routes/users';
import { workflowsRouter } from './routes/workflows';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/platform', platformRouter);
  api.use('/company', companyRouter);
  api.use('/users', usersRouter);
  api.use('/org', orgRouter);
  api.use('/cost-centers', costCentersRouter);
  api.use('/accounts', accountsRouter);
  api.use('/templates', templatesRouter);
  api.use('/workflows', workflowsRouter);
  api.use('/budgets', budgetsRouter);
  api.use('/changes', changesRouter);
  api.use('/requests', requestsRouter);
  api.use('/actuals', actualsRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit', auditRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/export', exportsRouter);
  app.use('/api', api);
  app.use('/api', () => { throw notFound('Endpoint'); });

  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(path.join(config.webDist, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}
