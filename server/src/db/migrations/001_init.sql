-- FinBridge schema v1. Multi-tenant: every business table carries company_id.

CREATE TABLE companies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  tax_id              TEXT,                                   -- VÖEN
  base_currency       TEXT    NOT NULL DEFAULT 'AZN',
  license_plan        TEXT    NOT NULL DEFAULT 'PILOT' CHECK (license_plan IN ('PILOT', 'BUSINESS', 'ENTERPRISE')),
  license_max_users   INTEGER NOT NULL DEFAULT 10 CHECK (license_max_users > 0),
  license_valid_until TEXT    NOT NULL,                       -- YYYY-MM-DD, inclusive
  status              TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES companies (id) ON DELETE CASCADE, -- NULL only for SUPER_ADMIN
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'CFO', 'FINANCE_MANAGER', 'DEPARTMENT_MANAGER', 'COST_CENTER_OWNER', 'VIEWER')),
  department_id INTEGER REFERENCES departments (id) ON DELETE SET NULL,
  language      TEXT    NOT NULL DEFAULT 'az' CHECK (language IN ('az', 'en')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((role = 'SUPER_ADMIN') = (company_id IS NULL))
);
CREATE INDEX idx_users_company ON users (company_id);

CREATE TABLE departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  manager_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, code)
);

CREATE TABLE cost_centers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments (id),
  code          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  owner_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, code)
);
CREATE INDEX idx_cost_centers_department ON cost_centers (department_id);

CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'OPEX' CHECK (type IN ('OPEX', 'CAPEX')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, code)
);

-- One budget per company and fiscal year.
CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COLLECTING', 'CFO_REVIEW', 'APPROVED', 'LOCKED')),
  currency    TEXT    NOT NULL DEFAULT 'AZN',
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  approved_at TEXT,
  locked_at   TEXT,
  UNIQUE (company_id, year)
);

-- Per-department approval sub-flow while the budget is COLLECTING.
CREATE TABLE budget_departments (
  budget_id     INTEGER NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  status        TEXT    NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'REVIEWED')),
  submitted_at  TEXT,
  submitted_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  reviewed_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (budget_id, department_id)
);

CREATE TABLE budget_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id      INTEGER NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers (id),
  account_id     INTEGER NOT NULL REFERENCES accounts (id),
  description    TEXT    NOT NULL DEFAULT '',
  m1  REAL NOT NULL DEFAULT 0, m2  REAL NOT NULL DEFAULT 0, m3  REAL NOT NULL DEFAULT 0,
  m4  REAL NOT NULL DEFAULT 0, m5  REAL NOT NULL DEFAULT 0, m6  REAL NOT NULL DEFAULT 0,
  m7  REAL NOT NULL DEFAULT 0, m8  REAL NOT NULL DEFAULT 0, m9  REAL NOT NULL DEFAULT 0,
  m10 REAL NOT NULL DEFAULT 0, m11 REAL NOT NULL DEFAULT 0, m12 REAL NOT NULL DEFAULT 0,
  updated_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_budget_lines_budget ON budget_lines (budget_id, cost_center_id);

CREATE TABLE actuals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers (id),
  account_id     INTEGER NOT NULL REFERENCES accounts (id),
  amount         REAL    NOT NULL DEFAULT 0,
  source         TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'excel')),
  updated_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, year, month, cost_center_id, account_id)
);
CREATE INDEX idx_actuals_period ON actuals (company_id, year, month);

-- Audit trail of every workflow step and comment.
CREATE TABLE budget_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id     INTEGER NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments (id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action        TEXT    NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  comment       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_budget_events_budget ON budget_events (budget_id, created_at);
