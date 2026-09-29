# FinBridge

**Azərbaycan şirkətləri üçün büdcə planlaması, təsdiq və Plan / Fakt platforması.**
Excel-də aparılan illik büdcə prosesini tamamilə platformaya köçürür: büdcə burada yaradılır,
departamentlərdən burada toplanır, burada yoxlanılır, CFO tərəfindən burada təsdiqlənir və il ərzində
faktiki xərclərlə burada müqayisə olunur. Excel yalnız köhnə məlumatı gətirmək (idxal) və hesabatları
çıxarmaq (ixrac) üçün qalır.

> 🇬🇧 *FinBridge is a multi-tenant budgeting module: companies (licences) → users with roles →
> departments → cost centers → annual budget → Submit / Review / CFO approval → actuals → Plan vs Actual,
> variance, forecast and a management dashboard. The UI is in Azerbaijani (default) and English.*

---

## Nə edir (MVP)

| # | Modul | Harada |
|---|-------|--------|
| 1 | **Şirkət** və lisenziya (paket, istifadəçi sayı, bitmə tarixi) | Platforma → Şirkətlər; Şirkət və lisenziya |
| 2 | **Departamentlər** (menecer təyinatı ilə) | Məlumat bazası → Departamentlər |
| 3 | **Xərc mərkəzləri** (məsul şəxs ilə) | Məlumat bazası → Xərc mərkəzləri |
| 4 | **Büdcə**: illik, keçən ildən kopyalama və % artım | Büdcələr |
| 5 | **Excel idxal**: sütunlar avtomatik tanınır, əvvəlcə yoxlanılır (dry-run) | Büdcə → Excel-dən idxal; Faktiki xərclər |
| 6 | **Büdcənin platformada redaktəsi**: 12 aylıq cədvəl, sətir əlavə etmək və silmək | Büdcə → Büdcə sətirləri |
| 7 | **Təsdiq**: Təqdim → Yoxlama → Düzəliş tələbi → CFO təsdiqi → Kilid | Büdcə → Departamentlər, Tarixçə |
| 8 | **Plan / Fakt**: departamentdən xərc mərkəzinə keçid (drill-down), hesab üzrə qruplaşdırma | Plan / Fakt |
| 9 | **Fərq və Fərq %**: rəng və ▲▼ işarəsi ilə | Hər yerdə |
| 10 | **İdarəetmə paneli**: KPI, aylıq qrafik, təsdiq vəziyyəti, büdcəni ən çox keçənlər | İdarəetmə paneli |
| 11 | **Excel ixrac**: bütün cədvəllər (büdcə, Plan / Fakt, fakt, departament, xərc mərkəzi, hesab, istifadəçi) | Hər səhifədə "Excel-ə ixrac" |
| 12 | **Rollar**: Admin / CFO / Maliyyə / Departament meneceri / Xərc mərkəzi məsulu / Baxış | İstifadəçilər |

Əlavə olaraq: **giriş səhifəsi**, **iki dil** (Azərbaycan dili əsasdır, ingilis dili ikincidir), proqnoz (fakt + qalan büdcə və ya orta aylıq temp),
hər addımın audit tarixçəsi, lisenziya limitlərinin serverdə yoxlanması.

## Əsas istifadəçi ssenarisi

1. Maliyyə meneceri **2027 büdcəsini yaradır** (boş və ya 2026-dan +5% kopya kimi).
2. **Departamentləri** əlavə edir.
3. **Xərc mərkəzlərini** müəyyən edir (və ya Excel idxalı zamanı avtomatik yaradılır).
4. Keçən ilin **Excel faylını idxal edir**.
5. **"Departamentlərə göndər"**: hər departament menecerinə büdcə açılır.
6. Departamentlər **öz büdcələrini doldurur** (hər kəs yalnız öz departamentini və ya xərc mərkəzini görür).
7. Maliyyə **yoxlayır**.
8. Lazım olsa **düzəliş tələb edir** (şərh məcburidir).
9. Departament **yenidən təqdim edir**.
10. Bütün departamentlər yoxlanıldıqdan sonra **CFO təsdiqləyir**.
11. Büdcə **kilidlənir**.
12. İl ərzində **faktiki xərclər** daxil edilir (əl ilə və ya Excel ilə).
13. Sistem **Plan / Fakt** göstərir.
14. **Fərqləri** müəyyən edir.
15. **Proqnoz** yenilənir.
16. Rəhbərlik nəticələri **idarəetmə panelində** izləyir.

Ətraflı: [docs/WORKFLOW.md](docs/WORKFLOW.md) · Rollar: [docs/ROLES.md](docs/ROLES.md) ·
Arxitektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md) ·
Fərziyyə (RAT): [docs/RAT.md](docs/RAT.md)

---

## Tez başlanğıc

Tələb: **Node.js 22.13+**. Verilənlər bazası Node-un daxili SQLite modulu ilə işləyir, ona görə Docker,
ayrıca verilənlər bazası serveri və ya kompilyasiya lazım deyil.

```bash
npm install          # bütün paketlər (shared, server, web)
npm run db:seed      # demo şirkət, istifadəçilər, cari və növbəti il büdcələri
npm run dev          # API: http://localhost:4000  ·  Veb: http://localhost:5173
```

Brauzerdə **http://localhost:5173** ünvanını açın və giriş səhifəsindəki demo hesablardan birini seçin.

### Demo hesablar

Şirkət: **Xəzər Distribusiya MMC** (Business lisenziyası, 25 istifadəçi). Bütün hesabların şifrəsi: `Demo1234!`

| Rol | E-poçt | Nəyi yoxlamaq olar |
|-----|--------|--------------------|
| Maliyyə meneceri | `finance@demo.az` | Büdcə yaratmaq, göndərmək, yoxlamaq, fakt daxil etmək, idxal |
| CFO | `cfo@demo.az` | Bütün şirkətə baxış, təsdiq və ya geri qaytarma |
| Departament meneceri (Satış) | `sales.manager@demo.az` | Yalnız Satış; düzəliş tələbinə cavab vermək, təqdim etmək |
| Digər departament menecerləri | `hr.manager@`, `it.manager@`, `ops.manager@`, `marketing.manager@demo.az` | Öz departamenti |
| Xərc mərkəzi məsulu | `field.sales@demo.az` | Yalnız SAL-01 xərc mərkəzi |
| Baxış hüququ | `viewer@demo.az` | Yalnız baxış və ixrac |
| Administrator | `admin@demo.az` | İstifadəçilər, rollar, şirkət məlumatları |
| Platforma administratoru | `owner@finbridge.az` / `Admin1234!` | Şirkətlər və lisenziyalar |

Demo məlumatda 5 departament (HR, IT, Satış, Əməliyyatlar, Marketinq), 15 xərc mərkəzi və 14 hesab var.
**Cari ilin** büdcəsi kilidlənib və Yanvar–Avqust faktı daxil edilib (Satış və HR büdcəni keçir, IT qənaət edir).
**Növbəti ilin** büdcəsi departamentlərdədir: hər departament fərqli mərhələdədir, Satışa düzəliş tələbi göndərilib.

## Skriptlər

| Əmr | Nə edir |
|-----|---------|
| `npm run dev` | API-ni (watch rejimində) və Vite dev serverini birlikdə işə salır |
| `npm run db:seed` | Boş bazaya demo məlumat yükləyir |
| `npm run db:reset` | Bazanı silir və demo məlumatı yenidən yükləyir |
| `npm run typecheck` | Bütün paketlər üçün TypeScript yoxlaması |
| `npm test` | Server testləri (hesablamalar, rollar, təsdiq axını, Excel, lisenziya) |
| `npm run build` | Veb tətbiqin production build-i (`web/dist`) |
| `npm start` | API-ni və build olunmuş veb tətbiqi bir portda işə salır (`http://localhost:4000`) |
| `npm run check` | typecheck + test + build (CI ilə eyni) |

## Production

```bash
cp .env.example .env      # JWT_SECRET-i mütləq dəyişin (ən azı 32 simvol)
npm ci && npm run build
NODE_ENV=production npm start
```

Server `web/dist` qovluğunu özü paylayır, ayrıca veb server lazım deyil. SQLite faylı `server/data/`
qovluğundadır, onu ehtiyat nüsxəyə daxil edin. Çox şirkətli real istifadə üçün PostgreSQL-ə keçid
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) sənədində təsvir olunub.

## Layihənin quruluşu

```
finbridge/
├─ shared/            # server və veb üçün ortaq TypeScript: rollar, icazələr, təsdiq axını, hesablamalar, DTO-lar
├─ server/            # Express 5 API + node:sqlite
│  ├─ src/
│  │  ├─ db/          # bağlantı, SQL miqrasiyaları, demo seed
│  │  ├─ auth/        # JWT, şifrə, middleware (lisenziya yoxlaması daxil)
│  │  ├─ lib/         # xətalar, lisenziya, görünürlük (scope)
│  │  ├─ services/    # büdcə, təsdiq axını, hesabatlar, Excel
│  │  └─ routes/      # REST endpoint-lər
│  └─ test/           # node:test testləri
├─ web/               # React 18 + Vite SPA
│  └─ src/
│     ├─ i18n/        # az.ts (əsas) və en.ts
│     ├─ components/  # layout, UI, qrafik, idxal dialoqu, CRUD səhifəsi
│     └─ pages/       # giriş, panel, büdcələr, Plan / Fakt, fakt, məlumat bazası, istifadəçilər, şirkət, platforma
├─ docs/              # arxitektura, rollar, təsdiq axını, API, RAT
├─ scripts/           # dev və reset skriptləri
└─ prototype/         # ilk klikləmə prototipi (tarixçə üçün saxlanılıb)
```

## Lisenziya məntiqi

- **Lisenziya şirkətə verilir.** Hər şirkət ayrıca tenant-dır; bütün məlumatlar `company_id` ilə ayrılır.
- Lisenziyada **paket** (Pilot / Business / Enterprise), **maksimum aktiv istifadəçi sayı** və **bitmə tarixi** var.
- Limit dolduqda yeni istifadəçi yaratmaq və ya deaktiv istifadəçini aktivləşdirmək serverdə bloklanır.
- Lisenziya bitdikdə və ya dayandırıldıqda şirkətin istifadəçiləri daxil ola bilmir, açıq sessiyalar da dayanır.
- Şirkətləri və lisenziyaları **platforma administratoru** idarə edir; şirkətin ilk administratoru şirkətlə birlikdə yaradılır.
