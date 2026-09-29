import { createApp } from './app';
import { config } from './config';
import { get, getDb } from './db/database';

getDb();
const users = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;

createApp().listen(config.port, () => {
  console.log(`FinBridge API listening on http://localhost:${config.port}`);
  if (users === 0) console.log('Database is empty — run "npm run db:seed" to load the demo company.');
});
