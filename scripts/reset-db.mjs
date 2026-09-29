// Deletes the local SQLite database so it can be re-created and re-seeded.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('server', process.env.DATABASE_FILE ?? 'data/finbridge.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    console.log(`removed ${path.relative(process.cwd(), f)}`);
  }
}
