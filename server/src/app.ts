import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { requireAuth } from './auth/middleware';
import { errorHandler, notFound } from './lib/errors';
import { actualsRouter } from './routes/actuals';
import { authRouter } from './routes/auth';
import { budgetsRouter } from './routes/budgets';
import { companyRouter } from './routes/company';
import { exportsRouter } from './routes/exports';
import { accountsRouter, costCentersRouter, departmentsRouter } from './routes/masterdata';
import { platformRouter } from './routes/platform';
import { reportsRouter } from './routes/reports';
import { usersRouter } from './routes/users';

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
  api.use('/departments', departmentsRouter);
  api.use('/cost-centers', costCentersRouter);
  api.use('/accounts', accountsRouter);
  api.use('/budgets', budgetsRouter);
  api.use('/actuals', actualsRouter);
  api.use('/reports', reportsRouter);
  api.use('/export', exportsRouter);
  app.use('/api', api);
  app.use('/api', () => { throw notFound('Endpoint'); });

  // In production the API also serves the built web app.
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(path.join(config.webDist, 'index.html')); });
  }

  app.use(errorHandler);
  return app;
}
