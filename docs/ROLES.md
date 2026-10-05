# Rollar, icazələr və görünürlük

Mənbə: [`shared/src/roles.ts`](../shared/src/roles.ts), [`server/src/lib/scope.ts`](../server/src/lib/scope.ts).
Server hər sorğuda həm rol icazəsini, həm də obyekt səviyyəli görünürlüyü yoxlayır. Matris tətbiqdə
İdarəetmə → İstifadəçilər və rollar → İcazə matrisi bölməsində də göstərilir (`GET /api/users/roles`).

## Təsdiq hüququ rol deyil

Heç bir rolda "təsdiqləmək" icazəsi yoxdur. Qərar vermək hüququ **axın mühərrikinin təyinatından** gəlir:
istifadəçi yalnız ona (və ya səlahiyyət ötürmə / eskalasiya ilə) təyin olunmuş açıq mərhələdə təsdiqləyə, rədd edə və ya
qaytara bilər. Beləliklə vəzifələrin ayrılığı konfiqurasiya ilə idarə olunur.

## Görünürlük (scope)

| Rol | Nəyi görür |
|-----|------------|
| Administrator, CEO, CFO, Maliyyə meneceri, Baxış | Bütün şirkəti |
| Departament rəhbəri | Rəhbər olduğu vahidlərin bütün alt ağacını və sahibi / məsulu olduğu xərc mərkəzlərini |
| XM sahibi | Sahibi və ya məsulu olduğu xərc mərkəzlərini |
| Əməkdaş | Yalnız öz sorğularını; sorğunu öz vahidinin alt ağacındakı xərc mərkəzlərinə yarada bilər |

Scope büdcə bölmələrinə və sətirlərinə, sorğulara, dəyişikliklərə, fakta, hesabatlara, panelə və Excel ixracına eyni qaydada
tətbiq olunur. Başqa şirkətin obyektinə müraciət `404` qaytarır.

## İcazə matrisi

| İcazə | Admin | CEO | CFO | Maliyyə | Dept. rəhbəri | XM sahibi | Əməkdaş | Baxış |
|-------|:-----:|:---:|:---:|:-------:|:-------------:|:---------:|:-------:|:-----:|
| Şirkət profili və ayarlar (`company.manage`) | ✓ | | | | | | | |
| İstifadəçilər (`users.manage`) | ✓ | | | | | | | |
| Struktur, xərc mərkəzləri (`org.manage`) | ✓ | | | ✓ | | | | |
| Hesablar planı, məzənnələr (`coa.manage`) | ✓ | | | ✓ | | | | |
| Şablonun tətbiqi (`templates.apply`) | ✓ | | | ✓ | | | | |
| Axın konfiqurasiyası (`workflow.manage`) | ✓ | | | ✓ | | | | |
| Məlumat bazasına baxış (`masterdata.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Büdcəyə baxış (`budget.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Büdcə yaratmaq (`budget.create`) | ✓ | | | ✓ | | | | |
| Versiya təqdimatı, kilid, bölməni açmaq (`budget.manage`) | ✓ | | | ✓ | | | | |
| Sətirləri redaktə (`budget.edit`) | ✓ | | | ✓ | ✓ scope | ✓ scope | | |
| Bölməni təqdim etmək (`budget.submit`) | ✓ | | | ✓ | ✓ scope | | | |
| Sorğu yaratmaq (`request.create`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Dəyişiklik sorğusu (`change.create`) | ✓ | ✓ | ✓ | ✓ | ✓ scope | ✓ scope | | |
| Fakta baxış / daxil etmək (`actuals.view` / `actuals.manage`) | ✓ / ✓ | ✓ / | ✓ / | ✓ / ✓ | ✓ / | ✓ / | | ✓ / |
| Hesabatlar (`reports.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Audit jurnalı (`audit.view`) | ✓ | ✓ | ✓ | ✓ | | | | |
| Excel idxal / ixrac | ✓ / ✓ | / ✓ | / ✓ | ✓ / ✓ | / ✓ | / ✓ | | / ✓ |

**Platforma administratoru** (`SUPER_ADMIN`) heç bir şirkətə aid deyil və yalnız şirkətləri və lisenziyaları idarə edir.
