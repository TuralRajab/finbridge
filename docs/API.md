# API (v2)

Bütün endpoint-lər `/api` altındadır. `POST /api/auth/login` və `GET /api/health` istisna olmaqla hər sorğuya
`Authorization: Bearer <token>` başlığı lazımdır. Xətalar vahid formatdadır:

```json
{ "error": { "code": "VERSION_LOCKED", "message": "…", "details": {} } }
```

Kodlar: [`shared/src/errors.ts`](../shared/src/errors.ts) (məs. `NO_WORKFLOW`, `NO_APPROVER`, `NOT_ASSIGNEE`, `INVALID_HIERARCHY`,
`OVER_BUDGET`, `ACCOUNT_NOT_ALLOWED`, `SECTIONS_NOT_APPROVED`). DTO-lar: [`shared/src/types.ts`](../shared/src/types.ts).
Payload-ların dəqiq sxemi hər route faylındakı `zod` sxemidir (`server/src/routes/*.ts`).

| Sahə | Metod və yol | İcazə |
|------|--------------|-------|
| **Auth** | `POST /auth/login`, `GET /auth/me`, `PATCH /auth/me` | — |
| **Platforma** | `GET/POST /platform/companies`, `PATCH /platform/companies/:id` | `platform.manage` |
| **Şirkət** | `GET/PATCH /company`, `GET/PATCH /company/settings`, `GET /company/currencies`, `GET/POST/DELETE /company/exchange-rates` | PATCH: `company.manage`; məzənnə: `coa.manage` |
| **İstifadəçilər** | `GET /users`, `GET /users/roles` (icazə matrisi), `POST /users`, `PATCH /users/:id` | yazma: `users.manage` |
| **Struktur** | `GET/POST /org/types`, `PATCH /org/types/:id`; `GET/POST /org/units`, `PATCH /org/units/:id` (köçürmə = `parentId`); `GET/POST/PATCH /org/job-families`; `GET/POST/PATCH /org/positions` | yazma: `org.manage` |
| **Xərc mərkəzləri** | `GET/POST /cost-centers`, `PATCH/DELETE /cost-centers/:id` (`allowedAccountIds`) | yazma: `org.manage` |
| **Hesablar** | `GET/POST /accounts`, `PATCH/DELETE /accounts/:id` | yazma: `coa.manage` |
| **Şablonlar** | `GET /templates`, `GET /templates/:code`, `POST /templates/apply` | apply: `templates.apply` |
| **Büdcələr** | `GET/POST /budgets`, `GET /budgets/:id?versionId=`, `GET/POST/PATCH /budgets/:id/lines`, `DELETE /budgets/:id/lines/:lineId`, `POST /budgets/:id/sections/:unitId/submit` · `/reopen`, `POST /budgets/:id/submit`, `POST /budgets/:id/lock`, `GET /budgets/:id/compare?a=&b=`, `GET /budgets/:id/history`, `POST /budgets/:id/import` (multipart, `mapping`, `dryRun`) | `budget.*`, `excel.import` |
| **Dəyişikliklər** | `GET/POST /changes`, `GET/PUT /changes/:id`, `POST /changes/:id/submit` · `/cancel` | `change.create` + scope |
| **Sorğular** | `GET/POST /requests`, `POST /requests/budget-check`, `GET/PUT /requests/:id`, `POST /requests/:id/submit` · `/cancel` · `/actuals` | `request.create`; fakt: `actuals.manage` |
| **Fakt** | `GET /actuals`, `GET /actuals/months`, `PUT /actuals`, `POST /actuals/import` | `actuals.*`, `excel.import` |
| **Qoşmalar** | `GET/POST /attachments`, `GET /attachments/:id/download` | obyektə baxış hüququ |
| **Axınlar** | `GET /workflows/meta`; `GET/POST /workflows/definitions`, `GET/PUT /workflows/definitions/:id`, `POST …/:id/clone`, `PATCH …/:id/active`; `POST /workflows/preview`; `GET /workflows/inbox`; `GET /workflows/instances/:id`; `POST /workflows/tasks/:id/act` (`APPROVE` / `REJECT` / `RETURN`, rədd və qaytarmada şərh məcburi); `POST /workflows/instances/:id/cancel`; `POST /workflows/escalations/run`; `GET/POST/DELETE /workflows/delegations` | konfiqurasiya: `workflow.manage`; qərar: təyinat |
| **Hesabatlar** | `GET /reports/dashboard?year`, `GET /reports/consumption` (groupBy unit / section / costCenter / account, filtrlər, `through`), `GET /reports/transactions`, `GET /reports/workflows`, `GET /reports/changes?year` | `reports.view` + scope |
| **Audit** | `GET /audit/logs`, `GET /audit/workflow-actions`, `GET /audit/imports` | `audit.view` / `excel.import` |
| **Toplu idxal** | `GET /bulk-import/kinds?lang`, `GET /bulk-import/:kind/template?lang&prefill=1`, `POST /bulk-import/:kind` (multipart `file`, `dryRun`, `mode` = upsert / create, `initialPassword`) — `:kind` = `ORG_UNITS`, `JOB_FAMILIES`, `USERS`, `POSITIONS`, `ACCOUNTS`, `COST_CENTERS`, `EXCHANGE_RATES` | bölmənin icazəsi (`org.manage` / `users.manage` / `coa.manage`) + `excel.import` |
| **Excel ixrac** | `GET /export/budget/:id`, `/export/consumption`, `/export/actuals`, `/export/requests`, `/export/changes`, `/export/org-units`, `/export/cost-centers`, `/export/accounts`, `/export/users`, `/export/templates/budget`, `/export/templates/actuals` (`?lang=az|en`) | `excel.export` + scope |
