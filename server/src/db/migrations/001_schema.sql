-- FinBridge schema v2.
-- Multi-tenant: every business table carries company_id. Timestamps are ISO-8601 UTC strings
-- written by the application clock (server/src/lib/clock.ts) so that SLA logic is testable.

/* ===================================================================== reference */

CREATE TABLE currencies (
  code     TEXT PRIMARY KEY CHECK (length(code) = 3),
  name_az  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  symbol   TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2
);

/* ===================================================================== tenancy */

CREATE TABLE companies (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  tax_id                  TEXT,
  industry_code           TEXT,
  base_currency           TEXT    NOT NULL DEFAULT 'AZN' REFERENCES currencies (code),
  default_language        TEXT    NOT NULL DEFAULT 'az' CHECK (default_language IN ('az', 'en')),
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  setup_completed_at      TEXT,
  license_plan            TEXT    NOT NULL DEFAULT 'PILOT' CHECK (license_plan IN ('PILOT', 'BUSINESS', 'ENTERPRISE')),
  license_max_users       INTEGER NOT NULL DEFAULT 10 CHECK (license_max_users > 0),
  license_valid_until     TEXT    NOT NULL,
  status                  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at              TEXT    NOT NULL
);

CREATE TABLE company_settings (
  company_id                   INTEGER PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
  near_limit_pct               REAL    NOT NULL DEFAULT 90 CHECK (near_limit_pct BETWEEN 1 AND 100),
  availability_basis           TEXT    NOT NULL DEFAULT 'ANNUAL' CHECK (availability_basis IN ('ANNUAL', 'YTD')),
  include_pending_in_available INTEGER NOT NULL DEFAULT 1,
  block_over_budget            INTEGER NOT NULL DEFAULT 0,
  auto_lock_on_approval        INTEGER NOT NULL DEFAULT 0,
  updated_at                   TEXT    NOT NULL
);

CREATE TABLE exchange_rates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  currency   TEXT    NOT NULL REFERENCES currencies (code),
  rate       REAL    NOT NULL CHECK (rate > 0), -- base-currency units per 1 unit of `currency`
  valid_from TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  UNIQUE (company_id, currency, valid_from)
);

/* ===================================================================== organisation */

CREATE TABLE org_unit_types (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code                 TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  name_en              TEXT,
  can_have_children    INTEGER NOT NULL DEFAULT 1,
  requires_cost_center INTEGER NOT NULL DEFAULT 0,
  in_budgeting         INTEGER NOT NULL DEFAULT 0, -- units of this type are budget sections
  in_workflow          INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL,
  UNIQUE (company_id, code)
);

CREATE TABLE org_unit_type_parents (
  type_id        INTEGER NOT NULL REFERENCES org_unit_types (id) ON DELETE CASCADE,
  parent_type_id INTEGER NOT NULL REFERENCES org_unit_types (id) ON DELETE CASCADE,
  PRIMARY KEY (type_id, parent_type_id)
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES companies (id) ON DELETE CASCADE, -- NULL only for SUPER_ADMIN
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'CEO', 'CFO', 'FINANCE_MANAGER', 'DEPARTMENT_MANAGER', 'COST_CENTER_OWNER', 'EMPLOYEE', 'VIEWER')),
  org_unit_id   INTEGER REFERENCES org_units (id) ON DELETE SET NULL,
  manager_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  job_family_id INTEGER REFERENCES job_families (id) ON DELETE SET NULL,
  job_title     TEXT,
  language      TEXT    NOT NULL DEFAULT 'az' CHECK (language IN ('az', 'en')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  CHECK ((role = 'SUPER_ADMIN') = (company_id IS NULL))
);
CREATE INDEX idx_users_company ON users (company_id);

CREATE TABLE org_units (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  type_id      INTEGER NOT NULL REFERENCES org_unit_types (id),
  parent_id    INTEGER REFERENCES org_units (id),
  code         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  name_en      TEXT,
  description  TEXT,
  head_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  UNIQUE (company_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_org_units_parent ON org_units (parent_id);

CREATE TABLE job_families (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  owner_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);

CREATE TABLE positions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code           TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  org_unit_id    INTEGER REFERENCES org_units (id) ON DELETE SET NULL,
  holder_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);

/* ===================================================================== chart of accounts */

CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES accounts (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  name_en         TEXT,
  description     TEXT,
  account_type    TEXT    NOT NULL CHECK (account_type IN ('REVENUE', 'EXPENSE', 'CAPEX', 'OTHER')),
  category        TEXT,
  expense_class   TEXT    CHECK (expense_class IN ('OPEX', 'CAPEX')),
  is_group        INTEGER NOT NULL DEFAULT 0, -- header accounts aggregate children and are not posted to
  allow_budgeting INTEGER NOT NULL DEFAULT 1,
  allow_requests  INTEGER NOT NULL DEFAULT 1,
  currency        TEXT    REFERENCES currencies (code),
  is_active       INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (company_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_accounts_parent ON accounts (parent_id);

CREATE TABLE cost_centers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  org_unit_id         INTEGER NOT NULL REFERENCES org_units (id),
  code                TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  description         TEXT,
  owner_user_id       INTEGER REFERENCES users (id) ON DELETE SET NULL, -- budget owner
  responsible_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  currency            TEXT    NOT NULL DEFAULT 'AZN' REFERENCES currencies (code),
  valid_from          TEXT,
  valid_to            TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE (company_id, code),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_cost_centers_unit ON cost_centers (org_unit_id);

-- Optional restriction: if a cost center has rows here, only these accounts may be budgeted / requested on it.
CREATE TABLE cost_center_accounts (
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers (id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  PRIMARY KEY (cost_center_id, account_id)
);

/* ===================================================================== templates (global) */

CREATE TABLE industry_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  name_az        TEXT    NOT NULL,
  name_en        TEXT    NOT NULL,
  description_az TEXT    NOT NULL,
  description_en TEXT    NOT NULL,
  content        TEXT    NOT NULL, -- JSON: units, cost centers, workflows, KPIs, assumptions
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE template_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL REFERENCES industry_templates (id) ON DELETE CASCADE,
  code          TEXT    NOT NULL,
  parent_code   TEXT,
  name_az       TEXT    NOT NULL,
  name_en       TEXT    NOT NULL,
  account_type  TEXT    NOT NULL,
  category      TEXT,
  expense_class TEXT,
  is_group      INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, code)
);

/* ===================================================================== budgets */

CREATE TABLE budget_scenarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE (company_id, code)
);

CREATE TABLE budgets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year         INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  name                TEXT    NOT NULL,
  currency            TEXT    NOT NULL REFERENCES currencies (code),
  current_version_id  INTEGER REFERENCES budget_versions (id),
  approved_version_id INTEGER REFERENCES budget_versions (id), -- first locked (original) version
  created_by          INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL,
  UNIQUE (company_id, fiscal_year)
);

CREATE TABLE budget_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id            INTEGER NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  version_no           INTEGER NOT NULL,
  name                 TEXT    NOT NULL,
  kind                 TEXT    NOT NULL DEFAULT 'INITIAL' CHECK (kind IN ('INITIAL', 'REVISED', 'FORECAST', 'MANAGEMENT')),
  scenario_id          INTEGER NOT NULL REFERENCES budget_scenarios (id),
  status               TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'LOCKED', 'SUPERSEDED')),
  based_on_version_id  INTEGER REFERENCES budget_versions (id),
  change_request_id    INTEGER REFERENCES budget_change_requests (id),
  workflow_instance_id INTEGER REFERENCES workflow_instances (id),
  notes                TEXT,
  created_by           INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL,
  submitted_at         TEXT,
  approved_at          TEXT,
  locked_at            TEXT,
  superseded_at        TEXT,
  UNIQUE (budget_id, version_no)
);

CREATE TABLE budget_sections (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id           INTEGER NOT NULL REFERENCES budget_versions (id) ON DELETE CASCADE,
  org_unit_id          INTEGER NOT NULL REFERENCES org_units (id),
  status               TEXT    NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'IN_APPROVAL', 'RETURNED', 'APPROVED')),
  workflow_instance_id INTEGER REFERENCES workflow_instances (id),
  submitted_by         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  submitted_at         TEXT,
  approved_at          TEXT,
  UNIQUE (version_id, org_unit_id)
);

CREATE TABLE budget_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id     INTEGER NOT NULL REFERENCES budget_versions (id) ON DELETE CASCADE,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers (id),
  account_id     INTEGER NOT NULL REFERENCES accounts (id),
  description    TEXT    NOT NULL DEFAULT '',
  m1  REAL NOT NULL DEFAULT 0, m2  REAL NOT NULL DEFAULT 0, m3  REAL NOT NULL DEFAULT 0,
  m4  REAL NOT NULL DEFAULT 0, m5  REAL NOT NULL DEFAULT 0, m6  REAL NOT NULL DEFAULT 0,
  m7  REAL NOT NULL DEFAULT 0, m8  REAL NOT NULL DEFAULT 0, m9  REAL NOT NULL DEFAULT 0,
  m10 REAL NOT NULL DEFAULT 0, m11 REAL NOT NULL DEFAULT 0, m12 REAL NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX idx_budget_lines_version ON budget_lines (version_id, cost_center_id, account_id);

-- Approved / locked data can never be changed in place (also protects against bugs and direct SQL).
CREATE TRIGGER trg_lines_insert_draft_only BEFORE INSERT ON budget_lines
WHEN (SELECT status FROM budget_versions WHERE id = NEW.version_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'VERSION_LOCKED'); END;

CREATE TRIGGER trg_lines_update_draft_only BEFORE UPDATE ON budget_lines
WHEN (SELECT status FROM budget_versions WHERE id = OLD.version_id) <> 'DRAFT'
  OR (SELECT status FROM budget_versions WHERE id = NEW.version_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'VERSION_LOCKED'); END;

CREATE TRIGGER trg_lines_delete_draft_only BEFORE DELETE ON budget_lines
WHEN (SELECT status FROM budget_versions WHERE id = OLD.version_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'VERSION_LOCKED'); END;

CREATE TRIGGER trg_versions_no_reopen BEFORE UPDATE OF status ON budget_versions
WHEN OLD.status IN ('LOCKED', 'SUPERSEDED') AND NEW.status <> OLD.status AND NOT (OLD.status = 'LOCKED' AND NEW.status = 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'VERSION_LOCKED'); END;

CREATE TRIGGER trg_versions_delete_draft_only BEFORE DELETE ON budget_versions
WHEN OLD.status <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'VERSION_LOCKED'); END;

/* ===================================================================== change requests */

CREATE TABLE budget_change_requests (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  number               TEXT    NOT NULL,
  budget_id            INTEGER NOT NULL REFERENCES budgets (id),
  base_version_id      INTEGER NOT NULL REFERENCES budget_versions (id),
  result_version_id    INTEGER REFERENCES budget_versions (id),
  cost_center_id       INTEGER NOT NULL REFERENCES cost_centers (id),
  title                TEXT    NOT NULL,
  reason               TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'CLOSED')),
  workflow_instance_id INTEGER REFERENCES workflow_instances (id),
  requested_by         INTEGER NOT NULL REFERENCES users (id),
  created_at           TEXT    NOT NULL,
  submitted_at         TEXT,
  decided_at           TEXT,
  UNIQUE (company_id, number)
);

CREATE TABLE budget_change_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id INTEGER NOT NULL REFERENCES budget_change_requests (id) ON DELETE CASCADE,
  account_id        INTEGER NOT NULL REFERENCES accounts (id),
  month             INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  current_amount    REAL    NOT NULL,
  requested_amount  REAL    NOT NULL,
  UNIQUE (change_request_id, account_id, month)
);

/* ===================================================================== spending */

CREATE TABLE purchase_requests (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  number               TEXT    NOT NULL,
  request_type         TEXT    NOT NULL DEFAULT 'PURCHASE' CHECK (request_type IN ('PURCHASE', 'EXPENSE')),
  title                TEXT    NOT NULL,
  description          TEXT,
  vendor               TEXT,
  cost_center_id       INTEGER NOT NULL REFERENCES cost_centers (id),
  account_id           INTEGER NOT NULL REFERENCES accounts (id),
  budget_id            INTEGER REFERENCES budgets (id),
  fiscal_year          INTEGER NOT NULL,
  month                INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount               REAL    NOT NULL CHECK (amount > 0),
  currency             TEXT    NOT NULL REFERENCES currencies (code),
  exchange_rate        REAL    NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount_base          REAL    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'CLOSED')),
  budget_state         TEXT    CHECK (budget_state IN ('WITHIN', 'NEAR', 'OVER')),
  available_at_submit  REAL,
  workflow_instance_id INTEGER REFERENCES workflow_instances (id),
  requested_by         INTEGER NOT NULL REFERENCES users (id),
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  submitted_at         TEXT,
  decided_at           TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX idx_pr_slice ON purchase_requests (company_id, fiscal_year, cost_center_id, account_id, status);

CREATE TABLE actuals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year         INTEGER NOT NULL,
  month               INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  cost_center_id      INTEGER NOT NULL REFERENCES cost_centers (id),
  account_id          INTEGER NOT NULL REFERENCES accounts (id),
  amount              REAL    NOT NULL, -- base currency
  source              TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'EXCEL', 'REQUEST', 'INTEGRATION')),
  purchase_request_id INTEGER REFERENCES purchase_requests (id),
  description         TEXT,
  created_by          INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);
CREATE INDEX idx_actuals_period ON actuals (company_id, fiscal_year, month, cost_center_id, account_id);
-- One booked figure per cell for manual / Excel entry; request-linked actuals are separate transactions.
CREATE UNIQUE INDEX ux_actuals_cell ON actuals (company_id, fiscal_year, month, cost_center_id, account_id) WHERE purchase_request_id IS NULL;

CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  file_name   TEXT    NOT NULL,
  mime_type   TEXT    NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        BLOB    NOT NULL,
  uploaded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_attachments_entity ON attachments (company_id, entity_type, entity_id);

/* ===================================================================== workflow engine */

CREATE TABLE workflow_definitions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name               TEXT    NOT NULL,
  workflow_type      TEXT    NOT NULL CHECK (workflow_type IN ('BUDGET_SUBMISSION', 'BUDGET_APPROVAL', 'BUDGET_CHANGE', 'PURCHASE_REQUEST', 'EXPENSE_REQUEST', 'FORECAST_SUBMISSION', 'FORECAST_APPROVAL')),
  description        TEXT,
  priority           INTEGER NOT NULL DEFAULT 100, -- lower wins when several definitions match
  conditions         TEXT, -- JSON condition (rules engine)
  skip_self_approval INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1,
  effective_from     TEXT,
  effective_to       TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  created_by         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE TABLE workflow_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id   INTEGER NOT NULL REFERENCES workflow_definitions (id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  approver_type   TEXT    NOT NULL,
  approver_config TEXT    NOT NULL DEFAULT '{}', -- JSON
  condition       TEXT, -- JSON; step is skipped when false
  sla_hours       INTEGER,
  escalation      TEXT, -- JSON { approverType, config }
  UNIQUE (definition_id, seq)
);

CREATE TABLE workflow_instances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  definition_id       INTEGER REFERENCES workflow_definitions (id) ON DELETE SET NULL,
  definition_name     TEXT    NOT NULL,
  definition_snapshot TEXT    NOT NULL, -- JSON: steps as they were when the instance started
  workflow_type       TEXT    NOT NULL,
  entity_type         TEXT    NOT NULL CHECK (entity_type IN ('BUDGET_SECTION', 'BUDGET_VERSION', 'CHANGE_REQUEST', 'PURCHASE_REQUEST')),
  entity_id           INTEGER NOT NULL,
  subject             TEXT    NOT NULL, -- JSON { orgUnitId, costCenterIds, requesterId }
  context             TEXT    NOT NULL, -- JSON rule context
  status              TEXT    NOT NULL DEFAULT 'IN_REVIEW' CHECK (status IN ('IN_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED')),
  current_seq         INTEGER,
  started_by          INTEGER NOT NULL REFERENCES users (id),
  started_at          TEXT    NOT NULL,
  completed_at        TEXT
);
CREATE INDEX idx_wf_instances_entity ON workflow_instances (company_id, entity_type, entity_id);

CREATE TABLE workflow_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id   INTEGER NOT NULL REFERENCES workflow_instances (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  step_name     TEXT    NOT NULL,
  approver_type TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED')),
  activated_at  TEXT,
  due_at        TEXT,
  escalated_at  TEXT,
  acted_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  acted_at      TEXT,
  comment       TEXT
);
CREATE INDEX idx_wf_tasks_instance ON workflow_tasks (instance_id, seq);

CREATE TABLE workflow_task_assignees (
  task_id         INTEGER NOT NULL REFERENCES workflow_tasks (id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users (id),
  reason          TEXT    NOT NULL DEFAULT 'RESOLVED' CHECK (reason IN ('RESOLVED', 'DELEGATE', 'ESCALATION', 'FALLBACK')),
  on_behalf_of_id INTEGER REFERENCES users (id),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX idx_wf_assignees_user ON workflow_task_assignees (user_id);

CREATE TABLE workflow_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL REFERENCES workflow_instances (id),
  task_id     INTEGER REFERENCES workflow_tasks (id),
  user_id     INTEGER REFERENCES users (id),
  action      TEXT    NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  comment     TEXT,
  data        TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_wf_actions_instance ON workflow_actions (instance_id, id);
CREATE TRIGGER trg_wf_actions_no_update BEFORE UPDATE ON workflow_actions BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER trg_wf_actions_no_delete BEFORE DELETE ON workflow_actions BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

CREATE TABLE user_delegations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  from_user_id  INTEGER NOT NULL REFERENCES users (id),
  to_user_id    INTEGER NOT NULL REFERENCES users (id),
  workflow_type TEXT,
  valid_from    TEXT    NOT NULL,
  valid_to      TEXT    NOT NULL,
  reason        TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users (id),
  created_at    TEXT    NOT NULL,
  CHECK (from_user_id <> to_user_id),
  CHECK (valid_to >= valid_from)
);

/* ===================================================================== audit & import */

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER REFERENCES companies (id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER,
  action      TEXT    NOT NULL,
  changes     TEXT, -- JSON { field: [old, new] } or payload
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_logs (company_id, entity_type, entity_id);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

CREATE TABLE import_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('BUDGET', 'ACTUALS')),
  target_id  INTEGER,
  file_name  TEXT    NOT NULL,
  mode       TEXT,
  status     TEXT    NOT NULL CHECK (status IN ('VALIDATED', 'APPLIED', 'FAILED')),
  rows_read  INTEGER NOT NULL DEFAULT 0,
  rows_valid INTEGER NOT NULL DEFAULT 0,
  total      REAL    NOT NULL DEFAULT 0,
  errors     TEXT, -- JSON
  mapping    TEXT, -- JSON
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL
);

INSERT INTO currencies (code, name_az, name_en, symbol, decimals) VALUES
  ('AZN', 'Azərbaycan manatı', 'Azerbaijani manat', '₼', 2),
  ('USD', 'ABŞ dolları', 'US dollar', '$', 2),
  ('EUR', 'Avro', 'Euro', '€', 2),
  ('GBP', 'İngilis funt sterlinqi', 'British pound', '£', 2),
  ('TRY', 'Türk lirəsi', 'Turkish lira', '₺', 2),
  ('RUB', 'Rusiya rublu', 'Russian rouble', '₽', 2),
  ('GEL', 'Gürcüstan larisi', 'Georgian lari', '₾', 2);
