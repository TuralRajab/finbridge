# Arxitektura (v2)

```
┌──────────────────────────┐      /api (JSON, JWT)      ┌───────────────────────────────┐
│  web  (React 18 + Vite)  │ ─────────────────────────▶ │  server  (Express 5, Node 22)  │
│  i18n: az (əsas), en     │ ◀───── .xlsx fayllar ────── │  ExcelJS · zod · bcrypt · JWT  │
└────────────┬─────────────┘                            └──────────────┬────────────────┘
             │  import                                                  │ node:sqlite
             ▼                                                          ▼
      ┌──────────────┐  rollar, icazələr, statuslar,          ┌───────────────────┐
      │   shared     │  qaydalar mühərriki (rules.ts),        │  SQLite (WAL)     │
      │ (TypeScript) │  büdcə yoxlaması, DTO-lar               │  FK + CHECK +     │
      └──────────────┘                                        │  triggerlər       │
                                                              └───────────────────┘
```

## Prinsiplər

- **Server hər şeyi yoxlayır.** İcazə, obyekt scope-u, lisenziya, status keçidləri, iyerarxiya qaydaları və kilid API-də və
  verilənlər bazasında tətbiq olunur. Veb interfeys yalnız uyğun düymələri göstərir.
- **Kilid bazada qorunur.** Triggerlər qaralama olmayan versiyanın sətirlərini dəyişməyə, kilidli / əvəzlənmiş versiyanı geri
  açmağa və audit / axın tarixçəsini dəyişməyə icazə vermir (`VERSION_LOCKED`, `APPEND_ONLY`).
- **Konfiqurasiya koddan ayrıdır.** Struktur növləri, hesablar planı, təsdiq axınları və büdcə nəzarəti ayarları şirkət üzrə
  məlumatdır; şablonlar yalnız başlanğıc nöqtəsidir və tətbiqdən sonra dəyişdirilə bilər.
- **Multi-tenant.** Hər biznes cədvəlində `company_id` var; bütün sorğular istifadəçinin şirkəti ilə filtrlənir.
- **Tətbiq saatı** (`lib/clock.ts`): bütün tarixlər bir mənbədən gəlir, seed və testlər SLA / eskalasiyanı real vaxt gözləmədən yoxlayır.

## Domen modeli

Mənbə: [`server/src/db/migrations/001_schema.sql`](../server/src/db/migrations/001_schema.sql)

| Sahə | Cədvəllər | Qeyd |
|------|-----------|------|
| Tenant | `companies`, `company_settings`, `users` | Lisenziya, baza valyutası, maliyyə ilinin başlanğıcı, quraşdırma statusu; limitə yaxınlıq %, ANNUAL / YTD əsas, təsdiqdə olanların qalıqdan çıxılması, aşımın bloklanması, avtomatik kilid |
| Valyuta | `currencies`, `exchange_rates` | AZN, USD, EUR, GBP, TRY, RUB, GEL; tarixə görə məzənnə, sorğuda baza valyutasına çevrilmə |
| Struktur | `org_unit_types`, `org_unit_type_parents`, `org_units`, `job_families`, `positions` | Növlər üzrə icazəli yuxarı vahidlər, `in_budgeting` (büdcə bölməsi yaradan növ), rəhbər, dövr qadağası |
| Xərc mərkəzləri | `cost_centers`, `cost_center_accounts` | Vahidə bağlı; sahib, məsul, valyuta, tarixlər, icazəli hesablar |
| Hesablar | `accounts` | Ağac; qrup / alt hesab, OPEX / CAPEX irsi, büdcəyə və sorğuya icazə |
| Şablonlar | `industry_templates`, `template_accounts` | `server/src/templates/data.ts` faylından başlanğıcda sinxronlaşdırılır |
| Büdcə | `budgets`, `budget_versions`, `budget_sections`, `budget_lines`, `budget_scenarios` | `current_version_id`, `approved_version_id`; versiya DRAFT → IN_APPROVAL → APPROVED → LOCKED → SUPERSEDED |
| Dəyişikliklər | `budget_change_requests`, `budget_change_items` | Bir xərc mərkəzi, hesab × ay; təsdiq → `createRevisedVersion` |
| Xərclər | `purchase_requests`, `actuals`, `attachments` | Sorğu: məbləğ, valyuta, məzənnə, baza məbləği, büdcə vəziyyəti; fakt mənbəyi MANUAL / EXCEL / REQUEST / INTEGRATION |
| Axın mühərriki | `workflow_definitions`, `workflow_steps`, `workflow_instances`, `workflow_tasks`, `workflow_task_assignees`, `workflow_actions`, `user_delegations` | Instansiya təsdiq anındakı qaydanın surətini (`definition_snapshot`) saxlayır |
| Audit | `audit_logs`, `import_jobs` | Köhnə / yeni dəyərlər; yalnız əlavə |

### Büdcə istifadəsi (consumption)

[`server/src/services/consumption.ts`](../server/src/services/consumption.ts) hər xərc mərkəzi × hesab × ay xanası üçün hesablayır:

| Ölçü | Mənbə |
|------|-------|
| Büdcə | cari versiyanın sətirləri |
| İlkin büdcə | təsdiqlənmiş ilk versiya (`approved_version_id`) |
| Təsdiqdə (pending) | IN_APPROVAL statuslu sorğular |
| Öhdəlik (committed) | APPROVED sorğuların baza məbləği − onlara bağlı fakt (≥ 0); bağlanmış sorğu → 0 |
| Fakt | `actuals` |
| Qalıq | büdcə − fakt − öhdəlik (− təsdiqdə, ayara görə); dövr: illik və ya YTD |
| Fərq, Fərq %, İstifadə %, Proqnoz | `shared/src/calc.ts` |

Sorğunun büdcə yoxlaması (`budgetCheck`) eyni ölçülərlə **WITHIN / NEAR / OVER** qaytarır (NEAR = istifadə ≥ `near_limit_pct`).

## Təhlükəsizlik

- Şifrələr `bcrypt`, 12 saatlıq JWT; `NODE_ENV=production` rejimində `JWT_SECRET` məcburidir.
- Hər sorğuda istifadəçi bazadan yenidən oxunur: deaktiv istifadəçi və ya bitmiş lisenziya dərhal bloklanır.
- Rol icazələri (`shared/src/roles.ts`) + obyekt scope-u (`server/src/lib/scope.ts`): departament rəhbəri öz alt ağacını,
  XM sahibi öz xərc mərkəzlərini, əməkdaş yalnız öz sorğularını görür. Başqa şirkətin obyekti həmişə 404 qaytarır.
- **Təsdiq hüququ rol deyil**: istifadəçi yalnız ona (və ya ötürmə ilə) təyin olunmuş mərhələdə qərar verə bilər (`NOT_ASSIGNEE`);
  öz sorğusunu təsdiqləmək avtomatik ötürülür.
- Giriş məlumatları `zod` ilə yoxlanılır; SQL yalnız parametrlərlədir; yüklənən fayllar 10 MB ilə məhduddur.

## Növbəti addımlar

- PostgreSQL (`server/src/db/database.ts` sinxron `all / get / run / tx` interfeysi təqdim edir) və row-level security.
- 1C inteqrasiyası (fakt və hesab-fakturalar), e-poçt / Teams bildirişləri, SSO.
- Rolling forecast, ssenarilər, driver-based planlama (Faza 5).
