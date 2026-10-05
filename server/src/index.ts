import { createApp } from './app';
import { config } from './config';
import { get, getDb } from './db/database';
import { processEscalations } from './services/workflowEngine';
import { syncTemplates } from './services/templates';

getDb();
syncTemplates();
const users = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;

createApp().listen(config.port, () => {
  console.log(`FinBridge API listening on http://localhost:${config.port}`);
  if (users === 0) console.log('Database is empty — run "npm run db:seed" to load the demo companies.');
});

// SLA escalation sweep (in-process; replace with a scheduler when running several instances)
setInterval(() => {
  try { processEscalations(); } catch (err) { console.error('escalation sweep failed', err); }
}, 15 * 60 * 1000).unref();
