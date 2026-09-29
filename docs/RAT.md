# FinBridge-in əsas RAT-ı (Riskiest Assumption Test)

## Ən vacib fərziyyə

> Azərbaycan şirkətləri illik büdcə prosesində Excel-in yaratdığı problemləri kifayət qədər ciddi hesab edir
> və bu prosesi mərkəzləşdirilmiş büdcə platformasına keçirmək üçün **pul ödəməyə hazırdır**.

Bu fərziyyə test edilmədən böyük məhsul qurmaq olmaz. Bu repozitoriyadakı MVP məhz bu testi aparmaq üçündür:
real şirkət öz büdcə prosesini bir büdcə dövrü ərzində platformada keçirə bilməlidir.

## Fərziyyəni hissələrə bölmək

| # | Alt-fərziyyə | Necə yoxlanılır | MVP-də nə dəstəkləyir |
|---|--------------|-----------------|------------------------|
| 1 | Problem kifayət qədər ağrılıdır (konsolidasiya, qırılan düsturlar, versiya qarışıqlığı) | Maliyyə menecerləri ilə müsahibələr: son büdcə dövründə neçə gün itirildi, neçə fayl versiyası oldu | — |
| 2 | Şirkət mövcud Excel məlumatını platformaya gətirə bilir | Pilot şirkətin öz faylının idxalı; idxal xətalarının sayı | Excel idxal, avtomatik sütun tanıma, dry-run |
| 3 | Departamentlər platformada doldurmağa razıdır (Excel-ə qayıtmır) | Neçə departament büdcəsini platformada təqdim etdi | Departament axını, scope, redaktə cədvəli |
| 4 | CFO təsdiqi platformada keçir | Təsdiqin platformada tamamlanması | Təqdim → Yoxlama → CFO təsdiqi, audit tarixçəsi |
| 5 | Plan / Fakt dəyəri il ərzində davamlı istifadəyə səbəb olur | Aylıq aktiv istifadəçilər, fakt yükləmələri | Fakt daxiletmə və idxal, Plan / Fakt, panel |
| 6 | **Pul ödəməyə hazırlıq** | Ödənişli pilot təklifinə cavab | Lisenziya modeli (paket, istifadəçi sayı, müddət) |

## Test planı

1. **Müsahibələr.** Hədəf seqmentdəki (məs. 100–500 işçili distribusiya, pərakəndə, istehsal) maliyyə menecerləri və CFO-larla problem müsahibələri.
2. **Demo.** Bu MVP-nin demo şirkəti ilə canlı nümayiş: büdcənin yaradılması, departament axını, CFO təsdiqi, Plan / Fakt.
3. **Ödənişli pilot təklifi.** Növbəti il büdcəsini FinBridge-də keçirmək üçün məhdud müddətli ödənişli pilot
   (məs. 3 ay, `PILOT` paketi). Lisenziya platforma administratoru tərəfindən yaradılır.
4. **Pilotun icrası.** Şirkətin öz faylının idxalı → departamentlərə göndərmə → təsdiq → kilid → aylıq fakt.

## Uğur meyarları

Rəqəmlər test başlamazdan **əvvəl** komanda tərəfindən müəyyən edilməli və burada qeyd olunmalıdır
(sonradan nəticəyə uyğunlaşdırılmamalıdır):

| Metrik | Hədəf (komanda doldurur) | Nəticə |
|--------|--------------------------|--------|
| Ödənişli pilotu qəbul edən şirkətlər / təklif verilən şirkətlər | … / … | |
| Büdcəsini platformada təqdim edən departamentlərin payı | … % | |
| CFO təsdiqi platformada tamamlanan pilotlar | … | |
| Pilotdan sonra illik lisenziyaya keçən şirkətlər | … | |

## Platformada ölçmə

- `budget_events` cədvəli hər təqdimi, yoxlamanı, düzəliş tələbini, təsdiqi və idxalı vaxtı ilə saxlayır:
  prosesin nə qədər çəkdiyini və neçə düzəliş dövrü olduğunu bu cədvəldən hesablamaq olar.
- `users.last_login_at` aktiv istifadəni göstərir.
- `actuals.source` (`manual` / `excel`) faktın necə daxil edildiyini göstərir.
