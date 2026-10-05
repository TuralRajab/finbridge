# FinBridge v2 — analysis and implementation plan

## 1. What exists today (v0.1 MVP)

| Area | Implementation | Assessment |
|------|----------------|------------|
| Frontend | React 18 + Vite SPA, react-router, custom CSS, i18n (az default / en) | Keep. Components (Card, Modal, Field, CrudPage, ImportDialog, MonthlyChart) are reusable |
| Backend | Express 5, zod validation, JWT + bcrypt, `node:sqlite` with SQL migrations | Keep the stack; replace the schema |
| Shared | `@finbridge/shared`: roles, workflow state machine, calc, DTOs | Keep the package, rewrite roles/workflow for the new model |
| Tenancy | `companies` with licence (plan, seats, expiry), every table has `company_id` | Keep |
| Structure | Flat `departments` → `cost_centers` | **Conflict**: hierarchy is hard-coded to two levels |
| Accounts | Flat list, OPEX/CAPEX | **Conflict**: no hierarchy, no budgeting / request flags |
| Budget | One budget per year, lines `m1…m12`, overwritten in place | **Conflict**: no versions, approved data is mutable in principle |
| Workflow | Hard-coded state machine: departments submit → finance review → CFO approve → lock | **Conflict**: approval chain is code, not configuration |
| Spending | — | Missing: purchase / expense requests, commitments, funds check |
| Actuals | One row per cost center × account × month | Extend: transactions linked to requests |
| Reports | Plan vs Actual by department / cost center / account, dashboard | Extend with committed / available / drill-down |
| Audit | `budget_events` for the workflow only | Extend: generic append-only audit log |

Technical debt: roles were a fixed enum with `budget.approve` tied to the CFO; department-only scope; no clock
abstraction (timestamps from SQL defaults, which makes SLA logic untestable).

**Decision.** The data model changes at the root (hierarchy, versions, workflow engine). There is no production data yet
(pilot has not started), so the schema is replaced by a clean v2 schema instead of stacking compatibility migrations.
Databases created by v0.1 are detected at startup and the server asks for `npm run db:reset`.

## 2. Target domain model

```
companies ─┬─ company_settings, exchange_rates (→ currencies)
           ├─ users (role, org_unit, manager, job_family)
           ├─ org_unit_types ── org_unit_type_parents          (configurable hierarchy rules)
           ├─ org_units (tree, head user)                     (any structure: division/branch/team…)
           ├─ job_families, positions                         (dynamic approvers)
           ├─ cost_centers (→ org_unit, owner, responsible) ── cost_center_accounts (restrictions)
           ├─ accounts (tree, type, OPEX/CAPEX, flags)        (from industry_templates / template_accounts)
           ├─ budgets (fiscal year) ── budget_versions (INITIAL/REVISED/…, status) ─┬─ budget_sections (per budgeting unit)
           │                                                                        └─ budget_lines (cc × account × 12 months)
           ├─ budget_change_requests ── budget_change_items   (on locked versions → new version)
           ├─ purchase_requests (PURCHASE / EXPENSE)          (funds check, commitment)
           ├─ actuals (transactions; optional link to request)
           ├─ workflow_definitions ── workflow_steps          (type, conditions, approver type, SLA, escalation)
           ├─ workflow_instances ── workflow_tasks ── workflow_task_assignees, workflow_actions (append-only)
           ├─ user_delegations
           ├─ attachments, import_jobs
           └─ audit_logs (append-only)
```

Key rules
- **One shared model.** Reports, dashboard and funds checks all read `budget_lines` of the budget's current version,
  `purchase_requests` and `actuals`. No reporting copies.
- **Immutability in the database.** SQLite triggers reject inserts/updates/deletes on lines of non-draft versions,
  reject reopening locked versions, and make `workflow_actions` and `audit_logs` append-only.
- **Configuration over code.** Approval chains are rows in `workflow_definitions/steps`. Conditions are JSON rules
  evaluated by one shared rules engine (`shared/src/rules.ts`). Approvers are resolved from the org structure at run time.
- **Versioning.** Approved versions are never edited: a change request creates `REVISED` version *n+1* and marks *n* `SUPERSEDED`.
  `budgets.approved_version_id` keeps the original approved version for comparison.
- **Budget sections.** Each cost center belongs to the nearest ancestor unit whose type participates in budgeting
  (e.g. Department). Sections are submitted through the `BUDGET_SUBMISSION` workflow; the whole version then goes through `BUDGET_APPROVAL`.
- **Funds check.** Available = Budget − Actual − Committed (approved requests not yet actualised) − Pending (requests in approval, configurable).
  Period basis (annual / YTD) and the "near limit" threshold are company settings.
- **Currency.** Every company has a base currency (AZN default); requests carry transaction currency, rate and base amount.
- **Authorization.** Role permissions (shared matrix) + object scope from the org tree (unit heads see their subtree,
  cost-center owners their cost centers, employees their own requests, approvers the items assigned to them) — enforced in every query.

## 3. Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 Foundation | Org unit types, org tree, cost centers, chart of accounts tree, currencies, 7 industry templates, setup wizard | Implemented |
| 2 Budget | Budgets, versions, sections, lines, locking, Excel import (mapping, preview, duplicates, history) / export | Implemented |
| 3 Workflow | Engine, visual builder, conditional steps, dynamic approvers, SLA/escalation, delegation, change requests, purchase/expense requests | Implemented |
| 4 Monitoring | Consumption (budget / pending / committed / actual / available), Plan vs Actual, variance, dashboards with drill-down, workflow and change reports | Implemented |
| 5 Advanced | Forecast & scenarios (data model ready: version kinds, scenarios, forecast workflow types), consolidation, ERP connectors, AI | Not started (by design) |
