import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

/** Uses Node's built-in SQLite (node:sqlite) — no native add-ons to compile. */
export type Param = null | number | bigint | string | Uint8Array;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, 'migrations');

let current: DatabaseSync | null = null;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!current) current = openDatabase(config.dbFile);
  return current;
}

/** Replaces the active connection (used by tests with an in-memory database). */
export function useDatabase(db: DatabaseSync): void {
  current = db;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

let txDepth = 0;
/** Runs `fn` inside a transaction (nested calls join the outer transaction). */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version),
  );
  if (applied.has('001_init.sql')) {
    throw new Error('This database was created by FinBridge v0.1 and is not compatible with the v2 schema. Run "npm run db:reset".');
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
