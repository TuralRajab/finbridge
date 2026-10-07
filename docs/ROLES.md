# Rollar, səlahiyyətlər və görünürlük

Mənbə: [`shared/src/roles.ts`](../shared/src/roles.ts), [`server/src/services/roles.ts`](../server/src/services/roles.ts),
[`server/src/lib/scope.ts`](../server/src/lib/scope.ts). Tətbiqdə: **İdarəetmə → Rollar və səlahiyyətlər** (`/admin/roles`).

## Rol nədir

Hər şirkətin öz rolları var. Rol üç şeydən ibarətdir:

1. **Səlahiyyətlər** — hansı səhifələri görür, harada redaktə edir, hansı əlavə əməliyyatları edir (səhifə × Görür / Redaktə edir / Əlavə).
2. **Məlumat görünürlüyü** — `COMPANY` (bütün şirkət), `UNIT` (rəhbəri olduğu vahidlər bütün alt vahidləri ilə + sahibi olduğu xərc
   mərkəzləri), `COST_CENTERS` (yalnız sahibi / məsulu olduğu xərc mərkəzləri), `OWN` (yalnız öz sorğuları).
3. **Əsas götürülən standart rol** — istifadəçi təsdiq axınlarında `CEO`, `CFO`, `Maliyyə meneceri` mərhələləri üçün bu rol kimi sayılır.

- **Standart rollar** (Administrator, CEO, CFO, Maliyyə meneceri, Departament rəhbəri, XM sahibi, Əməkdaş, Baxış) hər şirkətdə
  redaktə oluna bilən sətir kimi yaradılır; "Standarta qaytar" ilə FinBridge-in standart dəyərlərinə qayıdır.
- **Administrator** rolu kilidlidir: həmişə bütün səlahiyyətlərə malikdir — şirkət öz idarəetməsindən kənarda qala bilməz.
- **Yeni rollar** (məs. `SUPERVISOR` — Nəzarətçi, `REGIONAL_DIRECTOR`) yaradıla, kopyalana, deaktiv edilə və istifadəçisi yoxdursa silinə bilər.
- Dəyişiklik dərhal qüvvəyə minir (yenidən daxil olmaq lazım deyil). Hər dəyişiklik audit jurnalına yazılır (əlavə / çıxarılan səlahiyyətlər).
- Qorunma: öz rolunuzu dəyişə bilməzsiniz; öz rolunuzdan "İstifadəçilər və rollar — redaktə" səlahiyyətini çıxara bilməzsiniz;
  platforma səlahiyyəti heç bir şirkət roluna verilə bilməz; istifadəçisi olan rol silinə və deaktiv edilə bilməz.

## Server tərəfində yoxlama

Menyu və düymələr yalnız rahatlıq üçündür: hər API sorğusu istifadəçinin effektiv səlahiyyətini (`userCan`) və məlumat görünürlüyünü
(`getScope`) serverdə yoxlayır. Başqa şirkətin obyektinə müraciət `404` qaytarır. `masterdata.view` (seçim siyahıları üçün struktur,
hesablar, xərc mərkəzləri) hər şirkət istifadəçisinə avtomatik verilir.

## Təsdiq hüququ rol deyil

Heç bir rolda "təsdiqləmək" səlahiyyəti yoxdur. Qərar vermək hüququ axın mühərrikinin təyinatından gəlir: istifadəçi yalnız ona
(və ya səlahiyyət ötürmə / eskalasiya ilə) təyin olunmuş açıq mərhələdə təsdiqləyə, rədd edə və ya qaytara bilər. Rolu axında
istifadə etmək üçün: **Təsdiq axınları → mərhələ → "Rol üzrə"** (standart və ya şirkətin rolu).

## Səlahiyyətlər kataloqu

| Səhifə / modul | Görür | Redaktə edir | Əlavə |
|----------------|-------|--------------|-------|
| İdarəetmə paneli | `dashboard.view` | | |
| Büdcələr | `budget.view` | `budget.edit` | `budget.create`, `budget.submit`, `budget.manage` |
| Büdcə dəyişiklikləri | `budget.view` | `change.create` | |
| Satınalma və xərc sorğuları | `requests.view` | `request.create` | |
| Faktiki xərclər | `actuals.view` | `actuals.manage` | |
| Hesabatlar | `reports.view` | | |
| Təşkilati struktur və xərc mərkəzləri | `org.view` | `org.manage` | |
| Hesablar planı və valyutalar | `coa.view` | `coa.manage` | |
| Quraşdırma və şablonlar | | `templates.apply` | |
| Təsdiq axınları | `workflow.view` | `workflow.manage` | |
| İstifadəçilər, rollar | `users.view` | `users.manage` | |
| Şirkət və lisenziya | `company.view` | `company.manage` | |
| Audit jurnalı | `audit.view` | | |
| Excel | | | `excel.export`, `excel.import` |

Redaktə səlahiyyəti görmə səlahiyyətini də verir (`PERMISSION_IMPLIES`).

## Standart rolların başlanğıc dəyərləri

| Rol | Görünürlük | Əsas səlahiyyətlər |
|-----|-----------|--------------------|
| Administrator | Bütün şirkət | Hamısı (kilidli) |
| Maliyyə meneceri | Bütün şirkət | Struktur, hesablar, şablonlar, axınlar, büdcə (hamısı), sorğular, fakt, hesabatlar, audit, Excel |
| CEO, CFO | Bütün şirkət | Bütün səhifələrə baxış, axınlara baxış, sorğu və dəyişiklik yaratmaq, audit, ixrac |
| Departament rəhbəri | Rəhbəri olduğu vahidlər | Baxış + büdcə sətirlərini redaktə və bölməni təqdim etmək, sorğu, dəyişiklik |
| XM sahibi | Öz xərc mərkəzləri | Baxış + büdcə sətirlərini redaktə, sorğu, dəyişiklik |
| Əməkdaş | Öz sorğuları | Sorğular, şirkət səhifəsi |
| Baxış | Bütün şirkət | Yalnız baxış və ixrac |

**Platforma administratoru** (`SUPER_ADMIN`) heç bir şirkətə aid deyil və yalnız şirkətləri və lisenziyaları idarə edir.
