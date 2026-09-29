# API

Bütün endpoint-lər `/api` altındadır. `POST /api/auth/login` və `GET /api/health` istisna olmaqla hər sorğuya
`Authorization: Bearer <token>` başlığı lazımdır. Xətalar vahid formatda qaytarılır:

```json
{ "error": { "code": "BUDGET_NOT_EDITABLE", "message": "…", "details": {} } }
```

Xəta kodları: [`shared/src/errors.ts`](../shared/src/errors.ts). Veb interfeys onları seçilmiş dilə tərcümə edir.

## Autentifikasiya

| Metod | Yol | Təsvir |
|-------|-----|--------|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }`. Lisenziya və aktivlik yoxlanılır. |
| GET | `/auth/me` | Cari istifadəçi, icazələr, şirkət və lisenziya |
| PATCH | `/auth/me` | `{ language?, fullName?, currentPassword?, newPassword? }` |

## Platforma (yalnız `SUPER_ADMIN`)

| Metod | Yol | Təsvir |
|-------|-----|--------|
| GET | `/platform/companies` | Şirkətlər və lisenziyalar |
| POST | `/platform/companies` | Şirkət + lisenziya + ilk administrator |
| PATCH | `/platform/companies/:id` | Paket, istifadəçi limiti, bitmə tarixi, status |

## Şirkət, istifadəçilər, məlumat bazası

| Metod | Yol | İcazə |
|-------|-----|-------|
| GET / PATCH | `/company` | baxış / `company.manage` |
| GET / POST / PATCH | `/users`, `/users/:id` | `masterdata.view` / `users.manage` (lisenziya limiti yoxlanılır) |
| GET / POST / PATCH / DELETE | `/departments`, `/departments/:id` | `masterdata.view` / `masterdata.manage` |
| GET / POST / PATCH / DELETE | `/cost-centers`, `/cost-centers/:id` | eyni |
| GET / POST / PATCH / DELETE | `/accounts`, `/accounts/:id` | eyni |

## Büdcə

| Metod | Yol | Təsvir |
|-------|-----|--------|
| GET | `/budgets` | Büdcələr (cəmlər istifadəçinin scope-u ilə) |
| POST | `/budgets` | `{ year, name, copyFromBudgetId?, upliftPct? }` |
| GET | `/budgets/:id` | Detallar, departament statusları, icazə verilən əməliyyatlar |
| PATCH / DELETE | `/budgets/:id` | Ad dəyişmək / qaralamanı silmək |
| POST | `/budgets/:id/actions/:action` | `open`, `submit_to_cfo`, `approve`, `reject`, `lock` · body `{ comment? }` |
| POST | `/budgets/:id/departments/:deptId/actions/:action` | `submit`, `review`, `request_changes` · body `{ comment? }` |
| GET | `/budgets/:id/events` | Tarixçə |
| GET | `/budgets/:id/lines?departmentId=&costCenterId=` | Sətirlər (`canEdit` sahəsi ilə) |
| POST | `/budgets/:id/lines` | `{ costCenterId, accountId, description, months[12] }` |
| PATCH | `/budgets/:id/lines` | Toplu yeniləmə: `{ lines: [{ id, months?, description? }] }` |
| DELETE | `/budgets/:id/lines/:lineId` | |
| POST | `/budgets/:id/import` | multipart: `file`, `dryRun`, `mode` (`replace` / `append`), `createMissing` |

## Fakt və hesabatlar

| Metod | Yol | Təsvir |
|-------|-----|--------|
| GET | `/actuals?year=&month=` | Ay üzrə cədvəl (büdcə + fakt) |
| GET | `/actuals/months?year=` | Faktı olan aylar |
| PUT | `/actuals` | `{ year, month, entries: [{ costCenterId, accountId, amount }] }` |
| POST | `/actuals/import` | multipart: `file`, `year`, `dryRun` |
| GET | `/reports/plan-vs-actual` | `year`, `through`, `groupBy` (`department` / `costCenter` / `account`), `departmentId`, `method` |
| GET | `/reports/monthly?year=` | Aylıq büdcə və fakt |
| GET | `/reports/dashboard?year=` | KPI-lar, departamentlər, ən çox keçənlər, aylıq qrafik, təsdiq vəziyyəti |

## Excel ixrac

Hamısı `.xlsx` qaytarır; `lang=az|en` başlıqların dilini seçir.

`/export/budget/:id` · `/export/plan-vs-actual?…` · `/export/actuals?year=` · `/export/departments` ·
`/export/cost-centers` · `/export/accounts` · `/export/users` · `/export/templates/budget` · `/export/templates/actuals`
