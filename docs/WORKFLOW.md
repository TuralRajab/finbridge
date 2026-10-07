# Təsdiq axınları və büdcə həyat dövrü

Mənbə: [`server/src/services/workflowEngine.ts`](../server/src/services/workflowEngine.ts),
[`server/src/services/workflowDefinitions.ts`](../server/src/services/workflowDefinitions.ts),
[`shared/src/rules.ts`](../shared/src/rules.ts), [`shared/src/workflow.ts`](../shared/src/workflow.ts).

## Konfiqurasiya olunan axın mühərriki

Təsdiq zəncirləri kodda deyil, şirkətin **axın qaydalarında** (workflow definitions) saxlanılır və
İdarəetmə → Təsdiq axınları bölməsindəki vizual konstruktorla dəyişdirilir.

| Element | Məzmun |
|---------|--------|
| **Növ** | `BUDGET_SUBMISSION` (bölmə), `BUDGET_APPROVAL` (versiya), `BUDGET_CHANGE`, `PURCHASE_REQUEST`, `EXPENSE_REQUEST`, `FORECAST_*` |
| **Şərtlər** | `{ all: [...] }`, `{ any: [...] }`, `{ not: ... }`, qayda `{ field, op, value }`. Sahələr: `amount`, `orgUnit`, `department`, `branch`, `costCenter`, `account`, `expenseClass`, `requestType`, `budgetKind`, `industry`. Operatorlar: `eq`, `neq`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte` (kodlar böyük-kiçik hərfə həssas deyil) |
| **Seçim** | Aktiv, qüvvədə olma tarixlərinə düşən və şərtləri uyğun gələn qaydalar arasından **ən kiçik prioritet nömrəsi**, bərabərlikdə **ən spesifik şərt** seçilir. Uyğun qayda yoxdursa təqdimat `NO_WORKFLOW` ilə dayanır |
| **Mərhələlər** | Ardıcıl; hər mərhələnin öz şərti ola bilər (məs. `amount ≥ 10 000` → CFO). Şərti uyğun gəlməyən mərhələ bu sənəd üçün tətbiq olunmur |
| **Təsdiqləyən növləri** | Konkret istifadəçi, rol, CEO, CFO, Maliyyə meneceri, Departament rəhbəri (vahid növü konfiqurasiya olunur), Struktur vahidinin rəhbəri, Kurator direktor (kökdən sonrakı ilk vahidin rəhbəri), XM sahibi, XM məsulu (yoxdursa sahib), Peşə ailəsinin sahibi, Vəzifə sahibi, Sorğu edənin rəhbəri |
| **SLA və eskalasiya** | `slaHours` son tarixi təyin edir; vaxt keçəndə (15 dəqiqədən bir və ya əl ilə) eskalasiya təsdiqləyəni mərhələyə **bir dəfə** əlavə olunur |
| **Səlahiyyət ötürmə** | Tarix aralığı və istəyə görə axın növü üzrə; ötürülən şəxs həm yeni, həm mövcud mərhələlərdə qərar verə bilər, tarixçədə "kimin adından" qeyd olunur |
| **Öz-özünü təsdiq** | Sorğu edən mərhələnin yeganə təsdiqləyənidirsə mərhələ `SKIPPED` olur (`AUTO_SKIP`) |
| **Təsdiqləyən tapılmadıqda** | Birinci mərhələdə təqdimat `NO_APPROVER` ilə dayanır (struktur düzəldilməlidir); sonrakı mərhələdə struktur dəyişibsə Maliyyəyə (ehtiyat) yönəldilir |
| **Surət** | Hər instansiya təqdim anındakı qaydanın surətini saxlayır: sonradan qaydanı dəyişmək açıq sənədlərə təsir etmir; qaydanın hər saxlanması reviziyanı artırır |
| **Tarixçə** | `workflow_actions` yalnız əlavə olunur (trigger): göndərmə, mərhələ, təsdiq, rədd, qaytarma, ötürmə, eskalasiya, geri çəkmə |

Qərarlar: **Təsdiq** (şərh istəyə bağlı), **Rədd** və **Düzəlişə qaytarma** (şərh məcburi), sorğu edən üçün **Geri çəkmə**.

### Şablonlardan gələn standart axınlar

| Qayda | Növ | Mərhələlər |
|-------|-----|------------|
| Departament büdcəsinin təqdimatı | BUDGET_SUBMISSION | Departament rəhbəri → Maliyyə meneceri |
| HR illik büdcə təsdiqi (`department ∈ HR`, prioritet 10) | BUDGET_SUBMISSION | HR XM məsulu → HR peşə ailəsi sahibi → Maliyyə → CFO → CEO |
| İllik büdcənin təsdiqi | BUDGET_APPROVAL | CFO → CEO |
| Büdcə dəyişikliyi | BUDGET_CHANGE | XM sahibi → Maliyyə → CFO (≥ 10 000) → CEO (≥ 100 000) |
| Satınalma sorğusu (OPEX) | PURCHASE_REQUEST | XM sahibi → Maliyyə (≥ 10 000) → CFO (≥ 100 000) → CEO (≥ 500 000) |
| CAPEX satınalma (`expenseClass = CAPEX`, prioritet 50) | PURCHASE_REQUEST | XM sahibi → Kurator direktor → Maliyyə → CFO → CEO (≥ 100 000) |
| Xərc sorğusu | EXPENSE_REQUEST | Sorğu edənin rəhbəri → XM sahibi → Maliyyə (≥ 5 000) |

## Büdcə həyat dövrü

```
Büdcə (il) ──▶ Versiya v1 INITIAL: DRAFT ─submit─▶ IN_APPROVAL ─▶ APPROVED ─lock─▶ LOCKED ─(dəyişiklik təsdiqi)─▶ SUPERSEDED
                    │                                                               │
                    └─ Bölmələr (in_budgeting növlü vahidlər, məs. Departament / Filial)  └─▶ v2 REVISED: LOCKED (yeni cari versiya)
                       NOT_STARTED → IN_PROGRESS → IN_APPROVAL → APPROVED / RETURNED
```

- Hər xərc mərkəzi ən yaxın `in_budgeting` növlü yuxarı vahidin **bölməsinə** düşür (yoxdursa şirkət kökünə).
- Bölmə yalnız `NOT_STARTED`, `IN_PROGRESS`, `RETURNED` olarkən redaktə olunur; təqdimat `BUDGET_SUBMISSION` axınını işə salır.
- Versiyanı təsdiqə göndərmək üçün sətri olan bütün bölmələr `APPROVED` olmalıdır (`SECTIONS_NOT_APPROVED`).
- Təsdiqlənmiş versiya kilidlənir (və ya `auto_lock_on_approval` ayarı ilə avtomatik). Kilidli versiya **heç vaxt** üzərinə yazılmır.
- **Büdcə dəyişikliyi sorğusu** kilidli cari versiyaya qarşı açılır (bir XM, hesab × ay: cari → tələb olunan). Təsdiq olunanda
  dəyişikliklər tətbiq olunmuş yeni `REVISED` versiya yaradılır və kilidlənir, köhnə versiya `SUPERSEDED` olur, ilkin büdcə
  (`approved_version_id`) hesabatlarda müqayisə üçün qalır.

## Satınalma və xərc sorğuları

```
DRAFT ─submit─▶ IN_APPROVAL ─▶ APPROVED ─(fakt / hesab-faktura)─▶ CLOSED
   ▲                 │  └──▶ REJECTED
   └── RETURNED ◀────┘  (sorğu edən → CANCELLED)
```

- Göndərmədə **büdcə yoxlaması**: qalıq = büdcə − fakt − öhdəlik (− təsdiqdə olanlar, ayara görə), dövr illik və ya YTD.
  `WITHIN` / `NEAR` (istifadə ≥ limitə yaxınlıq %) / `OVER`. `block_over_budget` aktivdirsə `OVER` sorğu qəbul edilmir.
- Xarici valyutalı sorğu tarixə uyğun məzənnə ilə baza valyutasına çevrilir; büdcə yoxlaması baza məbləği ilə aparılır.
- Təsdiqlənmiş sorğu **öhdəlik** yaradır; fakt qeyd olunduqca öhdəlik azalır, sorğu bağlananda sıfırlanır.

## Excel idxalı

- Sütunlar avtomatik tanınır (AZ / EN başlıqlar), istifadəçi uyğunlaşdırmanı dəyişə bilər.
- Əvvəlcə yoxlama (dry-run): sətir üzrə xəta və xəbərdarlıqlar (dublikat, qrup hesabı, XM üçün icazəsiz hesab, naməlum kod).
  Xəta varsa heç nə yazılmır. Rejimlər: `replace` / `append`; "olmayanları yarat" seçimi.
- Hər idxal `import_jobs` cədvəlində saxlanılır (Audit jurnalı → İdxal tarixçəsi).

## Toplu idxal (master data)

Mənbə: [`server/src/services/bulkImport/`](../server/src/services/bulkImport/). İdarəetmə → **Toplu idxal** səhifəsində və hər
bölmənin öz səhifəsində ("Excel-dən toplu idxal" düyməsi).

| Bölmə | Uyğunlaşdırma | Qeyd |
|-------|---------------|------|
| Struktur vahidləri | kod | Yuxarı vahid eyni faylda ola bilər; icazəli yuxarı növlər və dövr qadağası yoxlanılır |
| Peşə ailələri | kod | Sahib e-poçtla |
| İstifadəçilər | e-poçt | Şifrə faylda yoxdur — yeni istifadəçilərə idxal pəncərəsində verilən ilkin şifrə; rəhbər eyni faylda ola bilər; lisenziya limiti yoxlanılır |
| Vəzifələr | kod | Vəzifə sahibi e-poçtla |
| Hesablar planı | hesab kodu | Alt hesab yazılan hesab qrupa çevrilir (əməliyyatı yoxdursa); öz alt hesabının altına köçürmə qadağandır |
| Xərc mərkəzləri | kod | İcazəli hesablar vergüllə; qrup hesabı qəbul edilmir |
| Valyuta məzənnələri | valyuta + tarix | Baza valyutası qəbul edilmir |

- **Şablon**: məlumat vərəqi (mütləq sütunlar `*` ilə, başlıqda izah), açılan siyahılar, "Təlimat" və "Kodlar" vərəqləri.
  "Mövcud məlumatla" şablonu cari qeydləri ehtiva edir: dəyişdirib geri yükləmək olar (dəyişməyən sətirlər "Dəyişməz" olur).
- **Qaydalar**: başlıqlar AZ və ya EN; boş xana cari dəyəri saxlayır; `-` istəyə bağlı dəyəri silir; Bəli/Xeyr, 1/0; tarix İİİİ-AA-GG və ya GG.AA.İİİİ.
- **Yoxlama** real yaratma / yeniləmə məntiqini bir tranzaksiyada icra edib geri qaytarır — nəticə idxalla eynidir. Hər hansı sətirdə
  xəta varsa heç bir sətir yazılmır. Rejim: "Yenilə" (upsert) və ya "Toxunma" (yalnız yenilər).
- Hər yoxlama və idxal `import_jobs` cədvəlinə (yaradılan / yenilənən / dəyişməz sayları ilə), hər dəyişiklik audit jurnalına yazılır.
