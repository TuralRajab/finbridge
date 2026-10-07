-- Bulk import of master data: the import history accepts the new import kinds and keeps
-- created / updated / unchanged counters. SQLite cannot alter a CHECK constraint, so the table is rebuilt.
CREATE TABLE import_jobs_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('BUDGET', 'ACTUALS', 'ORG_UNITS', 'JOB_FAMILIES', 'POSITIONS', 'USERS', 'ACCOUNTS', 'COST_CENTERS', 'EXCHANGE_RATES')),
  target_id  INTEGER,
  file_name  TEXT    NOT NULL,
  mode       TEXT,
  status     TEXT    NOT NULL CHECK (status IN ('VALIDATED', 'APPLIED', 'FAILED')),
  rows_read  INTEGER NOT NULL DEFAULT 0,
  rows_valid INTEGER NOT NULL DEFAULT 0,
  total      REAL    NOT NULL DEFAULT 0,
  created_count   INTEGER NOT NULL DEFAULT 0,
  updated_count   INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  errors     TEXT, -- JSON
  mapping    TEXT, -- JSON
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL
);

INSERT INTO import_jobs_new (id, company_id, kind, target_id, file_name, mode, status, rows_read, rows_valid, total, errors, mapping, user_id, created_at)
SELECT id, company_id, kind, target_id, file_name, mode, status, rows_read, rows_valid, total, errors, mapping, user_id, created_at FROM import_jobs;

DROP TABLE import_jobs;
ALTER TABLE import_jobs_new RENAME TO import_jobs;
CREATE INDEX idx_import_jobs_company ON import_jobs (company_id, id);
