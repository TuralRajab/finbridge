# Rollar və icazələr

Mənbə: [`shared/src/roles.ts`](../shared/src/roles.ts). Server hər sorğuda icazəni yoxlayır; veb interfeys yalnız uyğun düymələri göstərir.

## Görünürlük (scope)

| Rol | Nəyi görür |
|-----|------------|
| Administrator, CFO, Maliyyə meneceri, Baxış | Bütün şirkəti |
| Departament meneceri | Menecer olduğu departament(lər)i, öz departamentini və onların xərc mərkəzlərini |
| Xərc mərkəzi məsulu | Yalnız məsul olduğu xərc mərkəzlərini |

Scope büdcə sətirlərinə, Plan / Fakt-a, faktiki xərclərə, idarəetmə panelinə, tarixçəyə və Excel ixracına eyni qaydada tətbiq olunur
([`server/src/lib/scope.ts`](../server/src/lib/scope.ts)).

## İcazə matrisi

| İcazə | Admin | CFO | Maliyyə | Dept. meneceri | XM məsulu | Baxış |
|-------|:-----:|:---:|:-------:|:--------------:|:---------:|:-----:|
| Şirkət məlumatları (`company.manage`) | ✓ | | | | | |
| İstifadəçilər və rollar (`users.manage`) | ✓ | | | | | |
| Departament, xərc mərkəzi, hesab yaratmaq (`masterdata.manage`) | ✓ | | ✓ | | | |
| Büdcə yaratmaq (`budget.create`) | ✓ | | ✓ | | | |
| Göndərmək, yoxlamaq, düzəliş tələb etmək, CFO-ya göndərmək, kilidləmək (`budget.manage`) | ✓ | | ✓ | | | |
| Büdcə sətirlərini redaktə etmək (`budget.edit`) | ✓ | | ✓ | ✓ öz dept. | ✓ öz XM | |
| Departament büdcəsini təqdim etmək (`budget.submit`) | ✓ | | ✓ | ✓ öz dept. | | |
| **Təsdiqləmək və ya geri qaytarmaq** (`budget.approve`) | | ✓ | | | | |
| Faktiki xərcləri daxil etmək (`actuals.manage`) | ✓ | | ✓ | | | |
| Excel idxal (`excel.import`) | ✓ | | ✓ | | | |
| Excel ixrac (`excel.export`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hesabatlar və panel (`reports.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Platforma administratoru** (`SUPER_ADMIN`) heç bir şirkətə aid deyil və yalnız şirkətləri və lisenziyaları idarə edir.

Qeyd: Maliyyə meneceri büdcəni təsdiqləyə bilməz, CFO isə büdcəni redaktə etmir. Bu, vəzifələrin ayrılığını (segregation of duties) təmin edir.
