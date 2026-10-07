-- Configurable roles per company.
-- Every company gets the built-in (system) roles as editable rows, and may add its own roles
-- (e.g. "Supervisor", "Regional director"). A role is a set of permissions plus a data scope.
-- users.role keeps the system role the user's role is based on (identity for CEO / CFO / Finance
-- approver steps); users.role_id points at the company role that defines the effective permissions.
CREATE TABLE company_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  name_en     TEXT,
  description TEXT,
  base_role   TEXT    NOT NULL CHECK (base_role IN ('ADMIN', 'CEO', 'CFO', 'FINANCE_MANAGER', 'DEPARTMENT_MANAGER', 'COST_CENTER_OWNER', 'EMPLOYEE', 'VIEWER')),
  permissions TEXT    NOT NULL DEFAULT '[]', -- JSON array of permission codes
  data_scope  TEXT    NOT NULL CHECK (data_scope IN ('COMPANY', 'UNIT', 'COST_CENTERS', 'OWN')),
  is_system   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE (company_id, code)
);

ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES company_roles (id) ON DELETE SET NULL;
CREATE INDEX idx_users_role ON users (role_id);
