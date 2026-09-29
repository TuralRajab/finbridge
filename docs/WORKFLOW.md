# Büdcə təsdiq axını

Mənbə: [`shared/src/workflow.ts`](../shared/src/workflow.ts), [`server/src/services/workflow.ts`](../server/src/services/workflow.ts).

## Büdcə statusları

```
DRAFT ──open──▶ COLLECTING ──submit_to_cfo──▶ CFO_REVIEW ──approve──▶ APPROVED ──lock──▶ LOCKED
Qaralama        Departamentlərdə              CFO təsdiqində          Təsdiqlənib         Kilidlənib
                     ▲                              │
                     └──────── reject (şərh məcburi) ┘
```

| Əməliyyat | Kim edir | Şərt |
|-----------|----------|------|
| `open`: Departamentlərə göndər | Maliyyə, Admin | Status `DRAFT` olmalıdır. Bütün aktiv departamentlər üçün alt-axın yaradılır (`NOT_STARTED`). |
| `submit_to_cfo`: CFO-ya göndər | Maliyyə, Admin | Bütün departamentlər `REVIEWED` olmalıdır. |
| `approve`: Təsdiqlə | CFO | Status `CFO_REVIEW` olmalıdır. |
| `reject`: Geri qaytar | CFO | Şərh məcburidir. Büdcə `COLLECTING` statusuna qayıdır. |
| `lock`: Kilidlə | Maliyyə, Admin | Status `APPROVED` olmalıdır. Kilidlənmiş büdcə Plan / Fakt üçün əsasdır. |

## Departament alt-axını (büdcə `COLLECTING` olarkən)

```
NOT_STARTED ─(ilk redaktə)─▶ IN_PROGRESS ─submit─▶ SUBMITTED ─review─▶ REVIEWED
                                  ▲                     │                 │
                                  └── CHANGES_REQUESTED ◀── request_changes ┘
```

| Əməliyyat | Kim edir | Qeyd |
|-----------|----------|------|
| `submit`: Təqdim et | Departament meneceri (öz departamenti), Maliyyə | Təqdimdən sonra departament redaktə edə bilmir. |
| `review`: Qəbul et | Maliyyə | |
| `request_changes`: Düzəliş tələb et | Maliyyə | Şərh məcburidir; departament yenidən redaktə edə bilir. |

## Redaktə qaydası

| Büdcə statusu | Maliyyə, Admin | Departament meneceri, XM məsulu |
|---------------|----------------|---------------------------------|
| `DRAFT` | ✓ | — |
| `COLLECTING` | ✓ (istənilən departament) | ✓ yalnız departament statusu `NOT_STARTED`, `IN_PROGRESS` və ya `CHANGES_REQUESTED` olarkən və öz scope-u daxilində |
| `CFO_REVIEW`, `APPROVED`, `LOCKED` | — | — |

Hər addım `budget_events` cədvəlinə yazılır (kim, nə vaxt, hansı statusdan hansına keçid, şərh) və büdcənin
**Tarixçə** tabında göstərilir.

## Plan / Fakt hesablamaları

Mənbə: [`shared/src/calc.ts`](../shared/src/calc.ts)

- **Dövr**: Yanvardan seçilmiş aya qədər (standart olaraq faktı olan son aya qədər).
- **Fərq = Fakt − Büdcə.** Müsbət fərq büdcədən artıq deməkdir (qırmızı ▲), mənfi fərq qənaətdir (yaşıl ▼).
- **Fərq % = Fərq / Büdcə × 100** (büdcə 0 olarsa göstərilmir).
- **İllik proqnoz**: `budget` metodu fakt + qalan ayların büdcəsidir; `run_rate` metodu orta aylıq fakt × 12-dir.

## Excel idxal qaydaları

- İlk vərəq oxunur; başlıq sətri avtomatik tapılır (ilk 15 sətirdən tanınan ən azı 2 sütun olan sətir).
- Tanınan başlıqlar (böyük-kiçik hərf, boşluq və durğu işarələri nəzərə alınmır): `Dept` / `Departament`,
  `CC code` / `Xərc mərkəzi kodu`, `GL account` / `Hesab kodu`, `Type` / `Növ`, `Description` / `Təsvir`,
  ay adları (`Jan` … `Dec`, `Yan` … `Dek`, `Yanvar` … `Dekabr`, `M01` … `M12`).
- Əvvəlcə **yoxlama** (dry-run) aparılır: nə qədər sətir oxunub, nə yaradılacaq, hansı sətirlərdə xəta var.
  Xəta olduqda heç nə yazılmır.
- "Olmayanları yarat" seçilərsə, yeni departament, xərc mərkəzi və hesablar idxal zamanı yaradılır.
- Faktiki xərclər üçün iki format qəbul olunur: aylar sütunlarda (`Yan` … `Dek`) və ya `Ay` + `Məbləğ`.
