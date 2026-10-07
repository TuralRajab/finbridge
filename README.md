# FinBridge

**Azərbaycan şirkətləri üçün büdcə planlaması, təsdiq axınları və büdcə nəzarəti platforması.**
Büdcə platformada yaradılır, struktur vahidləri üzrə toplanır, konfiqurasiya olunan çoxmərhələli axınlarla
təsdiqlənir və kilidlənir. İl ərzində hər satınalma və xərc sorğusu büdcə qalığı ilə yoxlanılır,
öhdəliklər və faktiki xərclər büdcə istifadəsinə avtomatik yazılır. Excel yalnız köhnə məlumatı
gətirmək (idxal) və hesabatları çıxarmaq (ixrac) üçün qalır.

> 🇬🇧 *FinBridge is a multi-tenant FP&A and budget-control platform: configurable organisation hierarchy →
> cost centers → hierarchical chart of accounts (industry templates) → versioned budgets with locking →
> configurable approval workflow engine → purchase/expense requests with funds check → commitments and
> actuals → consumption, variance and drill-down reporting. UI in Azerbaijani (default) and English.*

---

## Modullar

| Sahə | Nə edir | Harada |
|------|---------|--------|
| **Quraşdırma ustası** | Şirkət məlumatı → sənaye → tövsiyə olunan şablon → hesabların nəzərdən keçirilməsi → seçimlər → tətbiq | İdarəetmə → Quraşdırma ustası |
| **Sənaye şablonları** | 7 şablon (Satış və distribusiya, İstehsal, Sənaye, Kənd təsərrüfatı, Bank, Xidmətlər, Digər), hər birində ~40 real hesab (MUS / AMB hesablar planı əsasında), struktur, xərc mərkəzləri, axınlar, KPI-lar | İdarəetmə → Sənaye şablonları |
| **Təşkilati struktur** | Konfiqurasiya olunan vahid növləri (icazəli yuxarı növlər), ağac: yaratmaq, redaktə, köçürmək, deaktiv etmək, dövr qadağası; peşə ailələri, vəzifələr | İdarəetmə → Təşkilati struktur |
| **Xərc mərkəzləri** | Sahib, məsul şəxs, valyuta, qüvvədə olma tarixləri, icazəli hesablar | İdarəetmə → Xərc mərkəzləri |
| **Hesablar planı** | İyerarxik; qrup / alt hesab, OPEX / CAPEX (irsi), büdcələşdirməyə və sorğulara icazə | İdarəetmə → Hesablar planı |
| **Büdcələr** | Versiyalar (İlkin / Düzəlişli / Proqnoz), bölmələr (departament və ya filial), 12 aylıq sətirlər, bölmə təqdimatı, versiyanın təsdiqi, kilid, versiyaların müqayisəsi, tarixçə, sütun uyğunlaşdırmalı Excel idxalı | Planlama → Büdcələr |
| **Büdcə dəyişiklikləri** | Kilidli büdcəyə dəyişiklik sorğusu → təsdiq → yeni versiya; ilkin versiya dəyişməz qalır | Planlama → Büdcə dəyişiklikləri |
| **Satınalma və xərc sorğuları** | Canlı büdcə yoxlaması (daxilində / limitə yaxın / aşır), valyuta və məzənnə, qoşmalar, təsdiq, faktın (hesab-fakturanın) qeydi | Xərc nəzarəti |
| **Təsdiq axınları** | Vizual konstruktor: növ, şərtlər (məbləğ, hesab, xərc mərkəzi, departament, OPEX/CAPEX…), mərhələlər, dinamik təsdiqləyənlər, mərhələ şərtləri (hədd), SLA, eskalasiya, prioritet, qüvvədə olma tarixləri, kopyalama, aktiv/deaktiv, marşrut önizləməsi | İdarəetmə → Təsdiq axınları |
| **Təsdiqlərim** | Mənə təyin olunmuş və mənə ötürülmüş mərhələlər, gecikmələr | İcmal → Təsdiqlərim |
| **Səlahiyyət ötürmə** | Məzuniyyət dövrü üçün təsdiq hüququnun başqasına verilməsi | İdarəetmə → Səlahiyyət ötürmə |
| **Hesabatlar** | İdarəetmə paneli; büdcə istifadəsi (Şirkət → Vahid → XM → Hesab → Əməliyyat drill-down); təsdiq axınları hesabatı; dəyişikliklər hesabatı | Hesabatlar |
| **Təhlükəsizlik və audit** | Rollar + obyekt səviyyəli görünürlük (serverdə), dəyişməz audit jurnalı, idxal tarixçəsi | İdarəetmə → İstifadəçilər və rollar, Audit jurnalı |

Ətraflı: [docs/WORKFLOW.md](docs/WORKFLOW.md) · Rollar: [docs/ROLES.md](docs/ROLES.md) ·
Arxitektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md) ·
Məhsul tədqiqatı: [docs/PRODUCT_RESEARCH.md](docs/PRODUCT_RESEARCH.md) · İcra planı: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

## Kompüterə heç nə quraşdırmadan (GitHub Codespaces)

Node.js quraşdırmaq mümkün deyilsə (məs. şirkət kompüteri), layihəni brauzerdə işə salmaq olar:

1. GitHub-da reponu açın və `claude/exciting-rubin-8pu7lu` budağını seçin.
2. **Code → Codespaces → Create codespace on …** basın.
3. Bir neçə dəqiqə gözləyin: paketlər quraşdırılır, demo məlumat yüklənir və tətbiq avtomatik başlayır.
4. Aşağıdakı **Ports** tabında `4000 (FinBridge)` sətrindəki 🌐 işarəsinə basın — tətbiq yeni tabda açılır.

**Codespace hər dəfə açılanda özünü yeniləyir** ([`scripts/codespace-start.sh`](scripts/codespace-start.sh)):
budağın son kodunu çəkir, paketləri quraşdırır, veb tətbiqi yenidən build edir, köhnə versiyanın bazasını
demo məlumatla yenidən yaradır və serveri işə salır. Jurnal: `/tmp/finbridge.log`.

Codespace artıq açıqdırsa və köhnə versiyanı göstərirsə, **Terminal**-da bu əmri işlədin:

```bash
bash scripts/codespace-start.sh
```

(Bu fayl hələ yoxdursa, əvvəlcə `git pull` edin.) Sonra brauzer tabını yeniləyin (Ctrl+Shift+R).

---

## Tez başlanğıc

Tələb: **Node.js 22.13+**. Verilənlər bazası Node-un daxili SQLite modulu ilə işləyir.

```bash
npm install          # bütün paketlər (shared, server, web)
npm run db:reset     # bazanı yaradır və 3 demo şirkəti yükləyir
npm run dev          # API: http://localhost:4000  ·  Veb: http://localhost:5173
```

### Demo şirkətlər və hesablar

Bütün demo hesabların şifrəsi: `Demo1234!`

**1. Xəzər Distribusiya MMC** — tam ssenari (Satış və distribusiya şablonu).
Cari ilin büdcəsi bölmələr üzrə təqdim olunub, təsdiqlənib və kilidlənib; təsdiqlənmiş dəyişiklik sorğusu
v2 versiyasını yaradıb (v1 əvəzlənib, dəyişməz saxlanılır); ilin keçmiş ayları üçün fakt Excel-dən gəlib;
müxtəlif statuslarda satınalma / xərc sorğuları var (təsdiqlənib və bağlanıb, öhdəlik, Maliyyədə, CFO-da
gözləyən CAPEX, rədd edilib, qaralama, USD ilə qismən fakturalanmış); növbəti ilin büdcəsi toplanır
(HR təsdiqlənib, IT təsdiqdə, Satış düzəlişə qaytarılıb, Logistika doldurulur).

| Rol | E-poçt | Nəyi yoxlamaq olar |
|-----|--------|--------------------|
| Maliyyə meneceri | `finance@demo.az` | Büdcə, bölmələrin təsdiqi, fakt, idxal, axın konstruktoru |
| CFO | `cfo@demo.az` | Təsdiqlər (CAPEX sorğusu gözləyir), bütün hesabatlar |
| CEO | `ceo@demo.az` | Böyük məbləğli təsdiqlər, panel |
| Departament rəhbəri (Satış) | `sales.manager@demo.az` | Yalnız Satış; qaytarılmış bölməni düzəldib yenidən təqdim etmək |
| Digər rəhbərlər | `marketing.manager@`, `ops.manager@`, `hr.manager@`, `it.manager@demo.az` | Öz vahidi |
| XM sahibi / məsulu | `field.sales@demo.az`, `hr.bp@demo.az`, `people.director@demo.az` | Öz xərc mərkəzləri; HR peşə ailəsi sahibi |
| Əməkdaş | `employee@demo.az` | Yalnız öz sorğuları (xərc / satınalma) |
| Baxış | `viewer@demo.az` | Yalnız baxış və ixrac |
| Administrator | `admin@demo.az` | İstifadəçilər, şirkət, bütün ayarlar |

**2. Qafqaz Qida İstehsalat ASC** — İstehsal şablonu, növbəti ilin büdcəsi qaralamadadır:
`admin@qafqazqida.az`, `ceo@`, `cfo@`, `finance@`, `production@qafqazqida.az`.

**3. Yeni Şirkət MMC** — quraşdırılmayıb; `setup@demo.az` ilə daxil olub quraşdırma ustasını keçin.

**Platforma operatoru:** `owner@finbridge.az` / `Admin1234!` — şirkətlər və lisenziyalar.

## Skriptlər

| Əmr | Nə edir |
|-----|---------|
| `npm run dev` | API-ni (watch rejimində) və Vite dev serverini birlikdə işə salır |
| `npm run db:seed` | Boş bazaya demo məlumat yükləyir |
| `npm run db:reset` | Bazanı silir və demo məlumatı yenidən yükləyir |
| `npm run typecheck` | Bütün paketlər üçün TypeScript yoxlaması |
| `npm test` | Server testləri: qaydalar mühərriki, büdcə yoxlaması, şablonlar, Excel və 24 qəbul ssenarisi (real API üzərindən) |
| `npm run build` | Veb tətbiqin production build-i (`web/dist`) |
| `npm start` | API-ni və build olunmuş veb tətbiqi bir portda işə salır (`http://localhost:4000`) |
| `npm run check` | typecheck + test + build (CI ilə eyni) |

## Production

```bash
cp .env.example .env      # JWT_SECRET-i mütləq dəyişin (ən azı 32 simvol)
npm ci && npm run build
NODE_ENV=production npm start
```

Server `web/dist` qovluğunu özü paylayır. SQLite faylı `server/data/` qovluğundadır, onu ehtiyat nüsxəyə
daxil edin. Böyük həcm üçün PostgreSQL-ə keçid [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) sənədində təsvir olunub.

## Layihənin quruluşu

```
finbridge/
├─ shared/            # ortaq TypeScript: rollar, icazələr, statuslar, qaydalar mühərriki, hesablamalar, DTO-lar
├─ server/            # Express 5 API + node:sqlite
│  ├─ src/
│  │  ├─ db/          # bağlantı, SQL sxemi (triggerlər daxil), demo seed
│  │  ├─ templates/   # sənaye şablonları (hesablar, struktur, axınlar, KPI)
│  │  ├─ services/    # struktur, hesablar, büdcə, axın mühərriki, sorğular, istifadə, hesabatlar, Excel
│  │  ├─ routes/      # REST endpoint-lər
│  │  └─ lib/         # xətalar, scope, audit, saat, lisenziya
│  └─ test/           # node:test testləri
├─ web/               # React 18 + Vite SPA (az / en)
├─ docs/              # tədqiqat, plan, arxitektura, rollar, axınlar, API
├─ scripts/           # dev və reset skriptləri
└─ prototype/         # ilk klikləmə prototipi (tarixçə üçün)
```

## Lisenziya məntiqi

- **Lisenziya şirkətə verilir.** Hər şirkət ayrıca tenant-dır; bütün məlumatlar `company_id` ilə ayrılır və hər sorğuda serverdə yoxlanılır.
- Lisenziyada **paket** (Pilot / Business / Enterprise), **maksimum aktiv istifadəçi sayı** və **bitmə tarixi** var.
- Limit dolduqda yeni istifadəçi yaratmaq bloklanır; lisenziya bitdikdə və ya dayandırıldıqda şirkətin istifadəçiləri daxil ola bilmir.
