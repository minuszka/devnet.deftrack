# Weboldaljavítás – végrehajtási napló

Terv: [20 napos ütemterv](WEBSITE_IMPLEMENTATION_ROADMAP_HU.md).
Kezdeti állapot: **tervezett, implementáció még nem indult**. Ezt a fájlt az implementáló naponta frissítse.

Státuszok: TERVEZETT; FOLYAMATBAN; KÓD KÉSZ / ELLENŐRZÉS FÜGGŐ; ELLENŐRZÖTT; BLOKKOLT. A deploy külön mező, nem következik az ELLENŐRZÖTT státuszból.

| Nap | Rövid feladat | Státusz | Commit / bizonyíték |
|---|---|---|---|
| 01 | Baseline és UI-tesztek | ELLENŐRZÖTT | `web/audit-2026-09-11`; K1 zöld (820+80 unit), K2 zöld (8 böngészőteszt), két negatív kontroll pirosra vitte a suite-ot |
| 02 | Router | TERVEZETT | — |
| 03 | Adatfrissesség | TERVEZETT | — |
| 04 | Presetek és módok | TERVEZETT | — |
| 05 | Admin kliensszerződés | TERVEZETT | — |
| 06 | Vezérlés visszatöltése | TERVEZETT | — |
| 07 | Futamállapot szinkron | TERVEZETT | — |
| 08 | Kísérletlapozás | TERVEZETT | — |
| 09 | Fairness | TERVEZETT | — |
| 10 | URL-állapot alap | TERVEZETT | — |
| 11 | URL-állapot további oldalak | TERVEZETT | — |
| 12 | Szemantika és kontraszt | TERVEZETT | — |
| 13 | Függőségek | TERVEZETT | — |
| 14 | nginx fejlécek | TERVEZETT | — |
| 15 | Egyszerű scenario-űrlapok | TERVEZETT | — |
| 16 | Összetett scenario-űrlapok | TERVEZETT | — |
| 17 | Publikus szimulációs eredmény | TERVEZETT | — |
| 18 | Navigáció és mobil | TERVEZETT | — |
| 19 | Keresés és súgó | TERVEZETT | — |
| 20 | Regresszió és review-csomag | TERVEZETT | — |

## Napi bejegyzés sablon – másold minden naphoz

```text
Nap / dátum / implementáló:
Kiinduló branch és SHA:
Napi feladat és előfeltételei:
Auditpontok:
Reprodukált kiinduló hiba:
Változtatás röviden:
Érintett fájlok:
Terven kívüli szükséges módosítás és indoka:
Szerződésváltozás / kompatibilitás:
Parancsok, exit-kódok és teszteredmények:
UI-fixture tesztek:
Valós HTTP/Mongo tesztek:
Valódi laborfutam: NEM FUTOTT / futamazonosító és bizonyíték:
Screenshot/trace/log elérési utak (titokmentes):
Kihagyott ellenőrzés és oka:
Nyitott probléma / következő lépés:
Commit(ok), végső SHA:
Végső git státusz és más munkából megőrzött változtatások:
Napi státusz:
Éles deploy: NEM TÖRTÉNT / külön engedélyezett telepítés bizonyítéka:
```

## Auditpontok lezárási mátrixa

| Pont | Javító nap | Kód / commit | Ellenőrzés | Éles bizonyíték / korlát |
|---|---|---|---|---|
| F01 | 05–06 | Nyitott | — | — |
| F02 | 05–07 | Nyitott | — | — |
| F03 | 03 | Nyitott | — | — |
| F04 | 08 | Nyitott | — | — |
| F05 | 09 | Nyitott | — | — |
| F06 | 09 | Nyitott | — | — |
| F07 | 02 | Nyitott | — | — |
| F08 | 02 | Nyitott | — | — |
| F09 | 04 | Nyitott | — | — |
| F10 | 14 | Nyitott | — | — |
| F11 | 10–11 | Nyitott | — | — |
| F12 | 12 | Nyitott | — | — |
| F13 | 13 | Nyitott | — | — |
| F14 | 12 | Nyitott | — | — |

## Review checkpointok

- 07. nap: még nem készült el.
- 14. nap: még nem készült el.
- 20. nap: még nem készült el.
- Független végső review: még nem történt meg.

A blokkot, kihagyott tesztet és fennmaradó sérülékenységet ne töröld ki egy későbbi bejegyzéssel: lezáráskor hivatkozz a bizonyítékra, hogy az előzmény követhető maradjon.
