# Arxitektura

```
┌──────────────────────────┐      /api (JSON, JWT)      ┌──────────────────────────────┐
│  web  (React 18 + Vite)  │ ─────────────────────────▶ │  server  (Express 5, Node 22) │
│  i18n: az (əsas), en     │ ◀───── .xlsx fayllar ────── │  ExcelJS · zod · bcrypt · JWT │
└────────────┬─────────────┘                            └──────────────┬───────────────┘
             │  import                                                  │ node:sqlite
             ▼                                                          ▼
      ┌──────────────┐                                        ┌───────────────────┐
      │   shared     │  rollar, icazələr, təsdiq axını,       │  SQLite (WAL)     │
      │ (TypeScript) │  hesablamalar, DTO-lar, Excel başlıqları│  server/data/*.db │
      └──────────────┘                                        └───────────────────┘
```

## Prinsiplər

- **Bir həqiqət mənbəyi.** Rollar, icazələr, status keçidləri və Plan / Fakt riyaziyyatı `shared` paketindədir;
  həm server (yoxlama üçün), həm veb (düymələri göstərmək üçün) eyni kodu istifadə edir.
- **Server hər şeyi yoxlayır.** Veb interfeys yalnız rahatlıq üçündür: icazə, scope, lisenziya və status qaydaları API-də tətbiq olunur.
- **Multi-tenant.** Hər biznes cədvəlində `company_id` var; bütün sorğular istifadəçinin şirkəti ilə filtrlənir.
- **Minimal asılılıqlar.** Verilənlər bazası üçün Node-un daxili `node:sqlite` modulu istifadə olunur: native kompilyasiya və ayrıca server lazım deyil.

## Verilənlər modeli

Mənbə: [`server/src/db/migrations/001_init.sql`](../server/src/db/migrations/001_init.sql)

| Cədvəl | Məzmun |
|--------|--------|
| `companies` | Şirkət (tenant) və lisenziya: paket, maksimum istifadəçi, bitmə tarixi, status |
| `users` | İstifadəçilər; `SUPER_ADMIN` istisna olmaqla hər biri bir şirkətə aiddir |
| `departments` | Departamentlər və menecerləri |
| `cost_centers` | Xərc mərkəzləri (departamentə bağlı) və məsul şəxsləri |
| `accounts` | Xərc hesabları, OPEX / CAPEX |
| `budgets` | İllik büdcə (şirkət + il üzrə unikal) və statusu |
| `budget_departments` | Hər departamentin həmin büdcədəki alt-axın statusu |
| `budget_lines` | Büdcə sətri: xərc mərkəzi × hesab × 12 ay (`m1` … `m12`) |
| `actuals` | Faktiki məbləğ: il × ay × xərc mərkəzi × hesab (unikal, upsert) |
| `budget_events` | Audit: hər təsdiq addımı, idxal və şərh |

Miqrasiyalar `server/src/db/migrations/*.sql` qovluğundadır və server işə düşəndə ardıcıllıqla tətbiq olunur (`schema_migrations`).

## Təhlükəsizlik

- Şifrələr `bcrypt` ilə saxlanılır; tokenlər 12 saatlıq JWT-dir. `NODE_ENV=production` rejimində `JWT_SECRET` məcburidir.
- Hər sorğuda istifadəçi bazadan yenidən oxunur: deaktiv istifadəçi və ya bitmiş lisenziya dərhal bloklanır.
- Bütün giriş məlumatları `zod` ilə yoxlanılır; SQL sorğularında yalnız parametrlər istifadə olunur.
- Yüklənən fayllar yaddaşda emal olunur (10 MB limit), yalnız `.xlsx` qəbul edilir.

## Növbəti addımlar (MVP-dən sonra)

- **PostgreSQL**: `server/src/db/database.ts` sinxron `all / get / run / tx` interfeysi təqdim edir. Böyük həcm və çox şirkət üçün
  bu qat PostgreSQL-ə (məs. `pg` + row-level security) köçürülə bilər; SQL sorğuları standart SQL-dir.
- Büdcə versiyaları (revizlər) və il ərzində yenidən proqnoz (re-forecast) versiyaları.
- E-poçt bildirişləri (göndərildi, düzəliş tələb olundu, təsdiqləndi).
- 1C və digər mühasibat sistemlərindən faktın avtomatik inteqrasiyası.
- SSO (Microsoft Entra ID / Google Workspace).
