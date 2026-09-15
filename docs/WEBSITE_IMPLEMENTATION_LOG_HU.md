# Weboldaljavítás – végrehajtási napló

Terv: [20 napos ütemterv](WEBSITE_IMPLEMENTATION_ROADMAP_HU.md).
Kezdeti állapot: **tervezett, implementáció még nem indult**. Ezt a fájlt az implementáló naponta frissítse.

Státuszok: TERVEZETT; FOLYAMATBAN; KÓD KÉSZ / ELLENŐRZÉS FÜGGŐ; ELLENŐRZÖTT; BLOKKOLT. A deploy külön mező, nem következik az ELLENŐRZÖTT státuszból.

| Nap | Rövid feladat | Státusz | Commit / bizonyíték |
|---|---|---|---|
| 01 | Baseline és UI-tesztek | ELLENŐRZÖTT | `web/audit-2026-09-11`; K1 zöld (820+80 unit), K2 zöld (8 böngészőteszt), két negatív kontroll pirosra vitte a suite-ot |
| 02 | Router | ELLENŐRZÖTT | `db77551`; K1 zöld (820+83 unit), K2 zöld (16 böngészőteszt); a javítás előtti viselkedés mérve |
| 03 | Adatfrissesség | ELLENŐRZÖTT | `c5c872c`; K1 zöld (820+98 unit), K2 zöld (23 böngészőteszt); negatív kontroll: a néma catch visszatéve 3 teszt pirosra vált |
| 04 | Presetek és módok | ELLENŐRZÖTT | `127e53d`; K1 zöld (836+98 unit), K2 zöld (31 böngészőteszt), **K3 zöld** (11 integrációs fájl, valódi MongoDB); negatív kontroll: üres `dsl-fault` sablon 3 tesztet pirosra vitt |
| 05 | Admin kliensszerződés | ELLENŐRZÖTT | `8735d1d`; K1 zöld (836+111 unit), K2 zöld (31), K3 zöld (12 fájl, 75 teszt); negatív kontroll: a `recovery` visszatétele a projekcióba pirosra viszi a HTTP-tesztet |
| 06 | Vezérlés visszatöltése | ELLENŐRZÖTT | `5fd3307`; K1 zöld (839+121 unit), K2 zöld (40 böngészőteszt), K3 zöld (12 fájl, 77 teszt); negatív kontroll: a draftszerkesztés futamtörlő viselkedését visszatéve 1 teszt pirosra vált |
| 07 | Futamállapot szinkron | ELLENŐRZÖTT | `c1e3605`; K1 zöld (839+121 unit), K2 zöld (48 böngészőteszt), K3 zöld (12 fájl, 77 teszt); negatív kontroll: revision-szabály nélkül az elavult poll felülírja az abortot |
| 08 | Kísérletlapozás | ELLENŐRZÖTT | `6c6fc96`; K1 zöld (839+121 unit), K2 zöld (56 böngészőteszt), K3 zöld (13 fájl, 84 teszt); negatív kontroll: az argumentum nélküli hívást visszatéve 3 teszt pirosra vált |
| 09 | Fairness | ELLENŐRZÖTT | `881df65`; K1 zöld (844+121 unit), K2 zöld (65 böngészőteszt), K3 zöld (14 fájl, 89 teszt); két negatív kontroll: 2 unit + 2 HTTP, illetve 4 böngészőteszt pirosra vált |
| 10 | URL-állapot alap | ELLENŐRZÖTT | `700c420`; K1 zöld (844+139 unit), K2 zöld (75 böngészőteszt), K3 zöld (14 fájl, 89 teszt); negatív kontroll **másodszorra** tüzelt — az első változat nem különböztetett |
| 11 | URL-állapot további oldalak | ELLENŐRZÖTT | `b954e9b`, `1a0d7d3`; részletek a 11. napi bejegyzésben |
| 12 | Szemantika és kontraszt | ELLENŐRZÖTT | `1828831`; részletek a 12. napi bejegyzésben |
| 13 | Függőségek | ELLENŐRZÖTT (F13 részben — elfogadott maradék) | `5b8b5a7`; részletek a 13. napi bejegyzésben |
| 14 | nginx fejlécek | ELLENŐRZÖTT; éles deploy: csak az nginx-fejlécek, tulajdonosi engedéllyel | `5262482`; részletek a 14. napi bejegyzésben |
| 15 | Egyszerű scenario-űrlapok | ELLENŐRZÖTT | `d7469ff`; részletek a 15. napi bejegyzésben |
| 16 | Összetett scenario-űrlapok | ELLENŐRZÖTT | `0d08439`, `e4c16d5`; részletek a 16. napi bejegyzésben |
| 17 | Publikus szimulációs eredmény | ELLENŐRZÖTT | `2a2e791`, `6cc471f`; részletek a 17. napi bejegyzésben |
| 18 | Navigáció és mobil | ELLENŐRZÖTT | `171443d`, `fc4652d`; részletek a 18. napi bejegyzésben |
| 19 | Keresés és súgó | ELLENŐRZÖTT | `6b5385d`; részletek a 19. napi bejegyzésben |
| 20 | Regresszió és review-csomag | ELLENŐRZÖTT | `694d5cc` … `46ac9da` (#174); részletek a 20. napi bejegyzésben |
| J1–J3 | Az 01–10. napi review (R1–R7) javításai | ELLENŐRZÖTT | `4972341`, `4261e06`, `6913d1d`, `e860556` (#164) |
| J4–J6 | A végső review (V1–V7) javításai | ELLENŐRZÖTT — az ismételt review V1, V2, V3, V5, V6, V7-et lezárta, V4-et részben | `web/review-fixes-2026-09-13` (#175) |
| J7 | Az ismételt review (W1–W4) javításai és egy tesztadósság | ELLENŐRZÖTT — a harmadik review W1, W3, W4-et lezárta, W2-t részben (X1) | `web/review-fixes-2026-09-13-2`; lásd a J7 bejegyzést |
| J8 | A harmadik review maradéka: X1 (W2 maradéka) és X2 (tesztlezárás) | ELLENŐRZÖTT — a negyedik független review X1-et és X2-t lezárta, új hibajegy nélkül | `web/review-fixes-2026-09-13-2` (#176); `d0f28fe`, `504b8cd`; lásd a J8 bejegyzést |
| Deploy | Élesre telepítés: a 11–20. nap és a J1–J8 | TELEPÍTVE, élőben mérve — a CSP enforce-ra váltása azóta megtörtént (következő sor) | `5237f80` a VPS-en 2026-09-14 óta; lásd a „Deploy 2026-09-14” bejegyzést |
| CSP | A CSP enforce-ra váltása (átadási csomag 10. pont, 4. lépés) | ÉLESBEN, mérve — 17 útvonalon és a keresésnél 0 sértés, pozitív kontrollal | egy nginx-snippet cseréje 2026-09-14 02:07:57Z; lásd a „CSP enforce 2026-09-14” bejegyzést |

A 11–20. nap sorai 2026-09-13-ig `TERVEZETT`-et mutattak, miközben mindegyik napnak megvolt a lezárt bejegyzése; a végső review jelezte. A táblázat most a napi bejegyzések saját „Commit(ok), végső SHA” és „Napi státusz” sorait idézi.

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

## 01. nap – Kiindulás és valódi UI-teszt alap

```text
Nap / dátum / implementáló: 01 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: main @ 1feca84617b27ebb8048430b3c01022d8b48f19d
Munkabranch: web/audit-2026-09-11
Napi feladat és előfeltételei: K0/K1 baseline rögzítése, böngészős tesztalap (K2). Előfeltétel nincs.
Auditpontok: nincs közvetlen F-pont. Ez a 02–20. nap UI-bizonyítékának a kapuja.
```

**Reprodukált kiinduló hiba:** ez setupnap, nincs javítandó viselkedés. Helyette
a kapu hitelességét bizonyítottam két negatív kontrollal (lásd alább).

**Változtatás röviden:** Playwright-alapú böngészős suite a klienshez. A tesztek
helyi Vite szerver mellett a **tényleges** `dd-shell` és `dd-admin-shell`
komponenseket renderelik, és minden API-hívást szintetikus stub válaszol meg.
Amelyik `/api/**` kérésre nincs stub, azt a harness **elutasítja és rögzíti**, a
rögzített elutasítás pedig teardownnál megbuktatja a tesztet. A Vite `/api`
proxyja emellett zárt portra (`127.0.0.1:1`) mutat, így egy esetleg kicsúszó
kérés sem érhet el valódi szervert.

**Érintett fájlok:**

- új: `client/playwright.config.ts`, `client/e2e/harness.ts`,
  `client/e2e/fixtures/api.ts`, `client/e2e/fixtures/stubs.ts`,
  `client/e2e/overview.spec.ts`, `client/e2e/admin.spec.ts`,
  `client/e2e/harness.spec.ts`
- módosított: `client/package.json` (`test:e2e`, `@playwright/test` **1.62.1**
  pontos pinnel), `client/tsconfig.json`, `.gitignore`,
  `.github/workflows/ci.yml`, `package-lock.json`

**Terven kívüli szükséges módosítás és indoka:**

1. `client/tsconfig.json` `include` bővítése `e2e/**/*.ts`-re. Enélkül a
   fixture-ök nem a valódi shared DTO-kkal ellenőrződnének, és egy `shared/`-ben
   átnevezett mező némán olyan fixture-t hagyna, amilyet a szerver sosem küld.
2. A Playwright `outputDir` neve `test-results`. A Vite alapból ezt az egy
   nevet hagyja figyelmen kívül; bármely más néven a trace kiírása futás közben
   újratölti a tesztelt oldalt (megfigyelve: nyolc `page reload` sor az első
   futáson, a véglegesen nulla).
3. A Vite dev szervert `--host 127.0.0.1`-re kötöttem. Alapból `localhost`-ra
   köt, ami Windowson csak az IPv6 loopback, és a 127.0.0.1-es readiness próba
   sosem válaszol (első futás: 120 s timeout).

**Szerződésváltozás / kompatibilitás:** nincs. Szerver-, route-, DTO- és
shared-változtatás nem történt; a kliens futáskódja változatlan.

**Parancsok, exit-kódok és teszteredmények:**

| Kapu | Parancs | Baseline (`1feca84`) | Végállapot (`1b2823c`) |
|---|---|---|---|
| K1 | `npm run build -w shared` | exit 0 | exit 0 |
| K1 | `npm run typecheck` | exit 0 | exit 0 |
| K1 | `npm test` | exit 0 — 820 szerver (88 fájl) + 80 kliens (10 fájl) | exit 0 — ugyanaz |
| K1 | `npm run build` | exit 0 | exit 0 |
| K1 | `git diff --check` | exit 0 | exit 0 |
| K2 | `npm run test:e2e -w client` | nem létezett | exit 0 — **8 passed (5,3 s)** |

**UI-fixture tesztek (8):** overview egészséges API-val (fejléc `11,500`,
`Overview` cím, a profilnév kiírva, és a `quorum-rounds` kérés tényleg
`llmqName=llmq_defcon`-t visz); overview 500-as válasszal (látható `role=alert`
hibasáv a szerver üzenetével); overview nem-boríték HTML törzzsel (502
státuszként jelenik meg); overview ChainLock-jelentés nélkül (a lap kimondja,
hogy nem állapítható meg a profil, és nem mutat kevert számot); admin 401 →
bejelentkezési kapu; admin 500 → „unavailable” kapu, külön üzenettel és Try
again gombbal; és a két harness-őr saját tesztje.

**Negatív kontrollok (a kapu hitelesítése):**

1. A fixture `TIP_HEIGHT` értékét 11 500 → 12 500-ra írva az overview-teszt
   elbukott (`expect(locator).toBeVisible() failed … getByText('11,500')`),
   3 passed / 1 failed. Tehát az állítás a kiszolgált választ olvassa, nem
   egy befagyasztott pillanatképet.
2. A `masternodes/timeline` stubot kivéve a **lap továbbra is rendben
   renderelt** — a kliens ezt a hibát szándékosan elnyeli —, a teszt mégis
   elbukott: `Error: requests the harness refused … "unstubbed API request: GET
   /api/v1/masternodes/timeline?hours=1"`. Ez a guard nélkül láthatatlan
   kicsúszás lett volna.

Mindkét próba után a fájlok visszaállítva, a suite újra 8/8 zöld.

**Valós HTTP/Mongo tesztek:** NEM FUTOTT — K3 ezen a napon nem alkalmazandó,
mert szerverroute, DTO és adataggregáció nem változott.

**Valódi laborfutam:** NEM FUTOTT.

**Screenshot/trace/log elérési utak:** `client/playwright-report/` és
`client/test-results/` (gitignore-olva; trace és képernyőkép csak bukásnál
keletkezik, kizárólag kitalált adatból). CI-ben `client-browser-tests` néven
töltődik fel, csak sikertelen futásnál, 7 napos megőrzéssel.

**Kihagyott ellenőrzés és oka:**

- `npm run test:integration`: nem futott, mert nem volt szerveroldali változás.
- A CI böngészős lépése **még nem futott le élesben** — a workflow módosítása
  kód, nem bizonyíték. Az első pusholt futás igazolja vagy cáfolja.

**Nyitott probléma / következő lépés:**

- Az oldal futás közben `ResizeObserver loop completed with undelivered
  notifications` kezeletlen hibát dob (valószínűleg a chartkomponensek).
  Meglévő alkalmazásviselkedés, nem e nap hatóköre; rögzítve, hogy a 12. vagy
  18. napon vizsgálni lehessen.
- A telepítéskori `npm audit` most **0 sérülékenységet** jelentett, míg az audit
  3 moderate találatot írt le (F13). Ez nem lezárás: a 13. napon külön,
  `npm audit --json`-nal újra kell mérni. Addig F13 nyitott.
- Az audit által jelzett `tsx` / `@esbuild/win32-x64` környezeti hiba a mai
  fán **nem reprodukálódik**: `node --import tsx -e …` exit 0, és a
  `node_modules/@esbuild` jelen van. Azt, hogy korábban tényleg hiányzott, nem
  ellenőriztem — csak azt állítom, hogy most működik.

```text
Commit(ok), végső SHA: f7d7653 (tervdokumentumok), 1b2823c (nap kódja)
Végső git státusz: tiszta, a napló commitjának kivételével; más munkából
  származó módosítás nem volt a fában (csak a négy új tervdokumentum).
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 02. nap – Router és hibaoldalak

```text
Nap / dátum / implementáló: 02 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ 056d6e0
Napi feladat és előfeltételei: F07 (hibás escape) és F08 (ismeretlen útvonal). Előfeltétel: 01. napi K2 — megvan.
Auditpontok: F07, F08
```

**Reprodukált kiinduló hiba – mindkettő mérve, nem feltételezve:**

1. **F08.** `/audit-nonexistent-20260911` az Overview-t rendereli. A böngészős
   teszt a javítás előtt elbukott: `.page-title` „Page not found” helyett
   „Overview”.
2. **F07.** A dokumentumbetöltés útját végigmérve kiderült, hogy **az audit
   leírása pontos a kódról, de nem teljes a láncról**: a dev szerver 404-et ad
   minden olyan útvonalra, amelynek escape-jét a `decodeURIComponent`
   visszautasítaná (mért: `/round/%`, `/round/%ff`, `/round/%FF`,
   `/tx/%E0%A4%A`, `/round/%c0%af` → 404; a szabályos `/tx/%E0%A4%AF` → 200).
   Így a hibás URL dokumentumbetöltéssel el sem jut a klienshez.
   Ami **valóban elérhető**: az alkalmazáson belüli navigáció. A régi kóddal
   `/round/%`-ra pusholva a konzolon `URIError: URI malformed` jelent meg, és a
   **címsorban `/round/%` állt, miközben az Overview maradt a képernyőn**. Ez a
   mért kiindulóhiba.

**Változtatás röviden:** `matchRoute` mostantól `matched` / `not-found` /
`malformed` státuszt ad, és viszi magával a kapott útvonalat. A dekódolás szűk
`try/catch`-ben van: egy hívás, egy hibamód. A két hibaág olyan route-okra
oldódik fel, amelyek **nincsenek benne a `ROUTES` tömbben** — ezek olyanok,
amikre egy útvonal feloldódik, nem amikből. Ezért nem gyullad ki egyetlen
menüpont sem hibaoldalon, és az `ROUTES[0]` sem szolgál többé hibakezelőként.
Új `dd-page-not-found` komponens mondja ki a két esetet külön; egyik sem írja át
a címsort.

**Érintett fájlok:** `client/src/lib/router.ts`, `client/src/lib/router.test.ts`,
`client/src/components/dd-shell.ts`, új
`client/src/components/dd-page-not-found.ts`, új `client/e2e/router.spec.ts`,
valamint a harness/fixture bővítése (`/*` prefix-stub, `roundDetail`,
`llmqProfile`, `shellStubs`, `roundStubs`).

**Terven kívüli szükséges módosítás és indoka:**

1. A `dd-shell` `_page()` switchje kapott explicit `dd-page-overview` ágat, a
   `default` pedig a hibaoldalra megy. Egy `case` nélküli route-tag olyan
   útvonal, amit valaki bekötetlenül adott hozzá; erre az Overview-t mutatni
   ugyanaz a néma helyettesítés, ami ellen ez a nap szól. Szkripttel
   ellenőrizve: mind a **16** route-tagnek van saját ága.
2. Harness `/*` prefix-stub. A részletoldalak azonosítója az útvonal része és
   százalékkódolt; enélkül a round/tx oldalak nem lettek volna stubolhatók.

**Szerződésváltozás / kompatibilitás:** a `Match` interfész két mezővel bővült
(`status`, `path`). Kizárólag kliensoldali típus, szerver/DTO nem érintett.

**Parancsok, exit-kódok és teszteredmények:**

| Kapu | Parancs | Eredmény |
|---|---|---|
| K1 | `npm run build -w shared` / `typecheck` / `build` / `git diff --check` | mind exit 0 |
| K1 | `npm test` | exit 0 — 820 szerver + **83** kliens (80 → 83: 1 lecserélt, 4 új router-eset) |
| K2 | `npx playwright test` | exit 0 — **16 passed (5,8 s)** (8 → 16) |

**UI-fixture tesztek (8 új):** hibás escape alkalmazáson belüli navigációval
(hibaoldal, változatlan URL, **nulla `pageerror`**); csonka többbájtos escape
ugyanígy; szabályos `%E0%A4%AF` escape továbbra is a tranzakciós oldalra visz;
ismeretlen útvonal → „Page not found”, megőrzött URL, `dd-page-overview` nincs
a lapon; a hibaoldal „Go to the overview” linkje tényleg működik; kódolt
roundKey továbbra is a round oldalra visz és `7%3A7416%3A0`-ként megy az API-ra;
`/rounds` és `/rounds/` nem nyeli el a részletroute; Back/Forward visszaadja a
két oldalt.

**Valós HTTP/Mongo tesztek:** NEM FUTOTT — K3 nem alkalmazandó, szerveroldali
változás nincs. A szerveroldali SPA fallback a terv szerint **nem módosult**.

**Valódi laborfutam:** NEM FUTOTT.

**Kihagyott ellenőrzés és oka:** dokumentumbetöltéses ellenőrzés hibás escape-re
— a dev szerver 404-el megelőzi a klienst (lásd fent). Ezt a 14. napon, az
nginx fejléc- és kiszolgálási munkánál kell tisztázni: a production
belépési pont viselkedése hibás URI-ra nem ellenőrzött.

**Nyitott probléma / következő lépés:**

- **F07 csak részben zárható.** A kliensoldali defektus javítva és mérve; a
  teljes lezáráshoz a production belépési pont (nginx) viselkedése kell hibás
  percent-escape-re. 14. nap.
- Írás közben az egyik szerkesztésem **valódi NUL bájtot** írt a
  `router.ts`-be (`\u0000`-nak, escape-nek szántam). A typecheck és a tesztek
  **átmentek vele**; a `file` parancs buktatta le („data” a „JavaScript source”
  helyett). Sentinelre cserélve (`/__not-found`, `/__broken-link`), a fájl újra
  ASCII. Tanulság a naplóba: a zöld teszt nem bizonyítja, hogy a forrás ép.

```text
Commit(ok), végső SHA: db77551
Végső git státusz: tiszta (a napló commitja után)
Napi státusz: ELLENŐRZÖTT (F07 részben — lásd fent)
Éles deploy: NEM TÖRTÉNT
```

## 03. nap – Adatfrissesség

```text
Nap / dátum / implementáló: 03 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ e4221bd
Napi feladat és előfeltételei: F03. Előfeltétel: K2 — megvan.
Auditpontok: F03
```

**Reprodukált kiinduló hiba:** a `dd-shell._loadHealth` üres `catch`-csel nyelte
el a health-hibát („a chain line is decoration”), így a számlálók változatlanul
maradtak a képernyőn, mellettük a lélegző zöld ponttal, ameddig a végpont
elérhetetlen volt. Az Overview `.refresh` címkéje feltétel nélkül azt írta:
`live · refreshes every 30 s`. Mérve a nap végi negatív kontrollal: a néma
`catch` visszatéve a hét frissességi teszt közül **három** elbukik.

**Változtatás röviden:** új tiszta modul (`client/src/lib/freshness.ts`) mondja
meg, hány másodperces az adat és mi történt a legutóbbi kísérlettel. A szabályok:

- az utolsó jó adat a képernyőn maradhat, de kiírja, mikor volt jó;
- a legutóbbi hiba **azonnal** látszik, üzenettel és Retry gombbal (nem a
  következő rajzoláskor egy másodperccel később: külön `requestUpdate()`);
- két frissítési periódusnál öregebb adat `stale`. Kettő, nem egy: egy lassú
  válasz még nem elavultság;
- a sikert **azért** törli a hibát, mert újabb, nem mert valaki visszaállított
  egy flaget. Egy saját sikerét túlélő flag az, amitől egy lap vörös marad a
  helyreállás után;
- az első kérés hibája `unavailable` + Retry, nem örök skeleton;
- az időbélyeg az utolsó **elfogadott** siker ideje. Abort vagy felülírt futam
  válasza sem siker, sem hiba.

A `-1` hibajelző kikerült a számlálókból (`measuredCount`). A négy körszámláló
összege **teljesen elmarad**, ha bármelyik tagja mérhetetlen — egy hiányzó tag
nem kisebbé, hanem értelmetlenné teszi az összeget. Szándékosan **nem** általános
szabály a negatív számokra: delta, margin és lag jogosan negatív. A `behind: -1`
többé nem rejti el a lag-csipet: az elrejtés azt állította, „nincs lemaradás”,
most azt írja, `unknown`.

**Érintett fájlok:** új `client/src/lib/freshness.ts` + `freshness.test.ts`, új
`client/e2e/freshness.spec.ts`; módosítva `dd-shell.ts`,
`dd-page-overview.ts`, `format.ts`.

**Terven kívüli szükséges módosítás és indoka:** `format.ts` kapott egy
`elapsed(ms)` függvényt, és az `ago(iso)` mostantól ezt hívja. Indok: a
frissesség-olvasás szabályozott órával készül, ezért nem mehet át olyan
függvényen, amelyik maga hívja a `Date.now()`-t. Duplikálás helyett egysoros
átvezetés.

**Szerződésváltozás / kompatibilitás:** nincs. Szerver, route, DTO változatlan.
Az `api.ts` már eddig is a borítékra döntött, nem a `response.ok`-ra — ezt most
teszt védi.

**Parancsok, exit-kódok és teszteredmények:**

| Kapu | Parancs | Eredmény |
|---|---|---|
| K1 | build shared / typecheck / build / `git diff --check` | mind exit 0 |
| K1 | `npm test` | exit 0 — 820 szerver + **98** kliens (83 → 98: 15 új frissességi eset) |
| K2 | `npx playwright test` | exit 0 — **23 passed (7,9 s)** (16 → 23) |

**UI-fixture tesztek (7 új, szabályozott órával):** friss lap kiírja a kort és a
periódust; hibás frissítés azonnal látszik, a számlálók megmaradnak; helyreállás
törli a hibát; **rejtett lap** (valódi `visibilitychange` úton) 90 s után
`stale`, visszatéréskor újra friss; első kérés hibája → `no data — retry`, nincs
skeleton; `503` + `success:true` továbbra is adat (degraded státusz és
`behind: 42` megjelenik); `-1` sehol nem jelenik meg számként, a lag `unknown`.

**Negatív kontroll:** a `dd-shell` hibaágát visszaírva a régi néma `catch`-re a
frissességi tesztekből **3 elbukik** (`refresh failed` sosem jelenik meg).
Visszaállítva a suite újra 23/23 zöld.

**Valós HTTP/Mongo tesztek:** NEM FUTOTT — K3 nem alkalmazandó, szerveroldali
változás nincs.

**Valódi laborfutam:** NEM FUTOTT.

**Kihagyott ellenőrzés és oka:**

- „Elavult válasz nem teheti ismét frissé az újabb hibás állapotot”: a
  szerződést **unit teszt** védi (`FreshnessTracker` — a nem elfogadott válasz
  nyomtalan) és a komponensekben az `isAbortError` / `run.stale` őr. Böngészőben
  determinisztikusan kikényszeríteni két egymást keresztező, késleltetett
  választ kellene; ezt nem építettem meg, és nem is állítom, hogy megvan.
- „Ha az adat DTO-ja közöl forrásidőt, az is maradjon látható”: a
  `HealthSnapshot` **nem közöl megfigyelési időbélyeget**. A legközelebbi
  forrásidő-jelzés a `behind`, amit most `unknown`-ként is kiír. Ha később a DTO
  kap ilyen mezőt, ez a nap újranyitandó.

**Nyitott probléma / következő lépés:**

- A frissesség-kijelzés egyelőre csak a fejlécen és az Overview-n van. A többi
  tizenkét oldal saját pollere továbbra sem mond adatkort — nem e nap
  hatóköre (a terv a fejlécet és az Overview-t nevezi meg), de a 18. napi
  navigációs munkánál érdemes lehet kiterjeszteni.

```text
Commit(ok), végső SHA: c5c872c
Végső git státusz: tiszta (a napló commitja után)
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 04. nap – Scenario-alapértékek és futtatási módok

```text
Nap / dátum / implementáló: 04 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ f38e5c7
Napi feladat és előfeltételei: F09. Előfeltétel: K2 — megvan. Ez az első nap, ahol szerverroute is változik, tehát K3 alkalmazandó.
Auditpontok: F09
```

**Reprodukált kiinduló hiba:** a `dd-simulation-control.ts` saját
`parameterDefaults` táblájában **nem volt `dsl-fault` bejegyzés**, így a
`?? {}` ág futott, és `{}` került a JSON-mezőbe — a séma szerint három
kötelező mező hiányzik (`faultKind`, `count`, `epochs`). A többi bejegyzés
sémahelyes volt, de `target-id` placeholderrel. A `live` mód a `devnet`
hálózat mellett is választható volt, amit a szerver a létrehozásnál
elutasít (`createSchema.refine`). Negatív kontrollal mérve: a sablont `{}`-ra
visszaírva **2 unit és 1 HTTP teszt** bukik el.

**Változtatás röviden — a sablon oda került, ahol a séma is van.**
A szerver `SCENARIO_PARAMETER_TEMPLATES` táblája a scenario-id unióval van
kulcsolva, tehát egy új scenario sablon nélkül **nem fordul le**. A
`/admin/simulations/scenarios` végpont ezt a sablont és egy `capabilities`
blokkot is visszaad. A kliensből eltűnt a párhuzamos tábla.

A `live + devnet` megszűnt: a live választása most **beállítja** a hálózatot,
és a `devnet` opció tiltott live mellett. A „van-e executor” kérdésre az a
`labExecutorConfigured()` válaszol, ami szó szerint a `buildLabExecutor()`
feltétele — nem hostname, nem környezeti tipp. A `LIVE_NETWORKS` konstansot a
create-route elutasítása és a felület is ugyanonnan olvassa.

**Érintett fájlok:**

- szerver: `simulator/scenarioRegistry.ts` (+ teszt), `simulator/scenarioTypes.ts`,
  új `simulator/simulationCapabilities.ts` (+ teszt),
  `routes/v1/simulationAdmin.v1.routes.ts`, új
  `integration/simulationScenarios.integration.test.ts`
- kliens: `lib/admin-api.ts`, `components/dd-admin-shell.ts`,
  `components/dd-simulation-control.ts`, új `e2e/fixtures/admin.ts`, új
  `e2e/simulation-control.spec.ts`, `e2e/harness.ts` (kérés-törzs rögzítés)

**Terven kívüli szükséges módosítás és indoka:** a harness mostantól rögzíti a
kérések metódusát és JSON-törzsét (`requestsTo`). Enélkül nem lett volna
bizonyítható, hogy a POST tényleg a kiválasztott módot viszi — márpedig
pontosan ez volt a gomb feliratának hazugsága.

**Szerződésváltozás / kompatibilitás:** a `/admin/simulations/scenarios` válasza
**additívan** bővült (`parameterTemplate`, `templateNeedsTargetId`,
`capabilities`). Régi szerver + új kliens: a kliens `capabilities` hiányában
**bezár** — live opció letiltva —, és sablon hiányában üres mezőt ad
magyarázattal, nem `{}`-t. Telepítési sorrend: szerver előbb.

**Parancsok, exit-kódok és teszteredmények:**

| Kapu | Parancs | Eredmény |
|---|---|---|
| K1 | build shared / typecheck / build / `git diff --check` | mind exit 0 |
| K1 | `npm test` | exit 0 — **836** szerver (820 → 836) + 98 kliens |
| K2 | `npx playwright test` | exit 0 — **31 passed** (23 → 31) |
| K3 | `MONGODB_TEST_URI=… npm run test:integration` | exit 0 — **11 fájl, 70 teszt** (8 skipped), valódi MongoDB 27018 |

**Valós HTTP/Mongo tesztek:** `simulationScenarios.integration.test.ts`, 4 eset:
hitelesítés nélkül 401 (különben a többi állítás semmit nem érne); mind a
**9** scenario kap nem üres sablont és `templateNeedsTargetId` mezőt;
executor nélküli deployment **nem hirdet** live hálózatot; és a `live+devnet`
POST továbbra is 400-zal, a helyes üzenettel.

**UI-fixture tesztek (8 új):** sablon a szerverről (`dsl-fault` → valódi
paraméterek, nem `{}`); sablon nélküli scenario → üres mező + magyarázat;
placeholder célpont kimondva; live választásakor a hálózat regtestre áll és a
devnet opció tiltott; executor nélkül a live opció tiltott; `capabilities`
hiányában szintén tiltott; a POST törzse a kiválasztott módot viszi; és minden
kínált scenario érvényes, nem üres JSON-t renderel.

**Negatív kontroll:** `SCENARIO_PARAMETER_TEMPLATES['dsl-fault']` értékét
`{}`-ra írva **2 registry unit teszt és 1 HTTP teszt** bukott el. Visszaállítva
minden kapu zöld.

Két saját hiba, amit a kapuk fogtak meg, nem én:

1. Az első HTTP-futás `400`-at adott — de **rossz okból**: a tesztalkalmazás
   nem mountolta a JSON body parsert, így `body: Required` jött a
   `live run is only possible on regtest` helyett. Egy csak státuszkódot
   vizsgáló állítás ezt átengedte volna.
2. A Playwright futtató **nem típusellenőriz**. A saját kézzel írt strukturális
   típusom a spec helperében nem illett az `AppHarness`-hez; a 8 böngészőteszt
   zölden futott, a `tsc` kapu bukott el. A `npm test` és a `test:e2e` nem
   helyettesíti egymást.

**Valódi laborfutam:** NEM FUTOTT. A `live` mód felületi kezelése nem bizonyít
semmit arról, hogy egy valódi laborfutam végigmenne.

**Kihagyott ellenőrzés és oka:** nincs. A napi három kapu mind lefutott.

**Nyitott probléma / következő lépés:**

- A célpontmezők továbbra is placeholderek; a valódi registry-alapú
  célpontválasztó a **16. nap** feladata, ahogy a terv előírja.
- A teszt-MongoDB indítása két buktatót hozott, mindkettő ismert: a WSL-ben
  `--fork`-olt daemon meghal, amint a `wsl.exe` kilép, és a Git Bash átírja a
  `/home/...` utat, ha nincs `MSYS_NO_PATHCONV=1`. A működő forma: háttérben
  futó, előtérben indított `MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- /home/stejn/...`.

```text
Commit(ok), végső SHA: 127e53d
Végső git státusz: tiszta (a napló commitja után)
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 05. nap – Futamlekérések és típusos kliensállapot

```text
Nap / dátum / implementáló: 05 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ 4de5582
Napi feladat és előfeltételei: az F01/F02 alapja. Nem önálló auditpont.
Auditpontok: F01, F02 (előkészítés)
```

**Reprodukált kiinduló hiba — két hiány, mindkettő a szerződésben:**

1. A `SimulationControlRun` **`recovery?` mezőt deklarált**, amit egyetlen
   control végpont sem küld. A `MongoSimulationPersistenceRepository.findRun`
   `runKey metadataFingerprint metadata state` mezőket választ, és a
   `projectionFromLean` mezőnként építi újra az objektumot — a tárolt
   recovery-eredmény külön mező a dokumentumon. A panel
   „Recovery proof: all targets clear” sora ezért **soha nem renderelődött**:
   megírt, átnézett, kiszállított, elérhetetlen kód.
2. Hiányzott a `state.revision` — a szerver saját rendezési kulcsa. Enélkül két
   egyszerre repülő válasz **érkezési sorrendben** dőlt el, tehát a lassabb
   nyert: egy vezérlőfelületen ez azt jelenti, hogy egy már megszakított futam
   újra futóként rajzolódik ki.

**Változtatás röviden:** az `admin-api.ts` típusai a **tényleges projekcióból**
származnak. Új tiszta modul (`simulationRunState.ts`) dönt arról, mit szabad
elhinni: `revision` szerinti rendezés, másik futam válaszának eldobása, és
háromértékű recovery (`yes` / `no` / **`unknown`**). A lease lejárata **nem**
bizonyíték — épp az a pillanat, amikor a hiba a legvalószínűbben még ott van,
és már senki nem figyeli.

A panel recovery-sora helyére az került, amit a szerver tényleg mond
(`faultMayBeActive`), plusz a kimondott korlát, hogy a célpontonkénti bizonyíték
ezen az API-n nem érhető el. A néma törlés azt olvasta volna, hogy „nincs mitől
tartani”.

**Amit még a projekcióból olvastam vissza:** a `lastTransition` `eventId`-t és
`eventType`-ot is visz, és a `from` **nem nullable**; az `arm` idempotens
ismétlése **preflight nélkül** válaszol (ezért a meglévőt megtartjuk — különben
egy hálózati időtúllépés utáni retry egy sikeres preflightot „nem futott”-tá
írna); és minden mutáció visz `idempotentReplay` mezőt, amit a panel figyelmen
kívül hagyott.

**Új GET-ek:** `run(runKey)`, `dryRun(runKey)` (a **mentett** terv), `liveLock()`.
Az olvasások `AbortSignal`-t fogadnak; a **mutációk szándékosan nem** — egy
megszakított fetch semmit nem mond arról, hogy a szerver alkalmazta-e.

**Érintett fájlok:** `client/src/lib/admin-api.ts`, új
`client/src/lib/simulationRunState.ts` (+ teszt),
`client/src/components/dd-simulation-control.ts`, új
`server/src/integration/simulationRunProjection.integration.test.ts`.

**Szerződésváltozás / kompatibilitás:** kizárólag kliensoldali típusok.
Szerverkód **nem változott** ma.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 836 szerver + **111** kliens (98 → 111) |
| K2 | exit 0 — 31 böngészőteszt |
| K3 | exit 0 — **12** integrációs fájl, 75 teszt (8 skipped) |

**Valós HTTP/Mongo tesztek (5 új):** hitelesítés nélkül 401; a projekció visz
`state.revision`-t, `status`-t, `faultMayBeActive`-ot és a metaadatot; **nem
visz recovery-t**, pedig a dokumentumon ott van `allClear: true`-val; nem
létező futamra 404; a lock külön állapotként válaszol.

**Két dolog, amit ez a nap mért, nem feltételezett:**

1. Az **audit-folyam a forrás**. Az első változatban kézzel szúrtam be egy
   teljes futamdokumentumot — `GET` 404-et adott, mert a `loadRun` az audit
   eseményeket játssza vissza, és audit nélkül a futam nem létezik. A fixture
   most a valódi `SimulationPersistenceService.createRun`-t használja.
2. **Az első negatív kontrollom hibás volt.** A `recovery`-t a `.select(...)`-be
   visszatéve a teszt **továbbra is zölden futott** — mert a `projectionFromLean`
   mezőnként építi újra az objektumot, és a `select` nem az egyetlen szűrő.
   A `projectionFromLean`-re célozva a teszt pirosra vált
   (`expected { required: true, …(4) } to be undefined`). Ha az első kontrollnál
   megállok, olyan bizonyítékot jelentettem volna, ami nincs.

**Valódi laborfutam:** NEM FUTOTT.

**Kihagyott ellenőrzés és oka:** a `/runs/:key/dry-run` **tartalmi**
ellenőrzése kimaradt: a mentett tervet artefaktumból olvassa, amit a
fixture nem ír meg, a HTTP create út pedig chain-identitás pineket és élő
node-RPC-t igényel (`simulator chain identity pins are not configured`).
A végpont létezését és típusát a kliens oldalon fedtem le; a tényleges
terv-visszatöltés a **06. nap** bizonyítéka lesz.

**Nyitott probléma / következő lépés:**

- **A recovery-bizonyíték sehol nem elérhető az API-n.** Ma ez `unknown`, és ki
  is van írva. A 06–07. napon el kell dönteni, hogy a projekció kapjon-e
  `recovery` mezőt (visszafelé kompatibilis bővítés), vagy a panel véglegesen
  csak a `faultMayBeActive`-ra támaszkodjon.

```text
Commit(ok), végső SHA: 8735d1d
Végső git státusz: tiszta (a napló commitja után)
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 06. nap – Visszavehető futamvezérlés

```text
Nap / dátum / implementáló: 06 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ f26aa5b
Napi feladat és előfeltételei: F01. Előfeltétel: 05. nap — megvan.
Auditpontok: F01 (és az F02 fele)
```

**Reprodukált kiinduló hiba — három út vezetett a vezérlés elvesztéséhez:**

1. **Oldalfrissítés.** A kiválasztott futam egyetlen komponens memóriájában élt.
2. **Bármely draftmező szerkesztése.** A `_newInput()` törölte a `_prepared`
   értéket, tehát egy karakter a seed mezőben ugyanazt csinálta, mint egy F5.
3. **A saját 30 másodperces frissítés.** A `_loadDashboard` így számolta újra a
   kiválasztást: `activeRuns[0]?.runKey ?? this._selectedRunKey`. Kiválasztasz
   egy futamot, vársz egy kört, és a képernyőn lévő Abort gomb **egy másik
   futamhoz tartozik**. Ezt az auditban nem szerepelt; kód olvasás közben
   találtam, és `decideSelection` unit teszt rögzíti.

**Változtatás röviden:** a kiválasztás az URL-be került (`/admin?run=sim_…`, a
futamkulcs és semmi más — egy URL bekerül hibajegyekbe). A szabályt egy tesztelt
helyen tartja a `decideSelection`: **explicit URL-kulcs > már kiválasztott >
aktív futam**. Hibás kulcs **hiba**, nem ok arra, hogy mást vezéreljünk. A Back
visszavisz; az aktív futam átvétele `replace`, mert az korrekció, nem döntés.

A visszatöltés a `GET /runs/:key/dry-run`-t olvassa — a futamot és a **mentett**
tervet. Új draft POST-olása másik futamot hozna létre, és a labort fogó futam
maradna vezérlés nélkül. A késői válasz generációszám és a szerver `revision`
alapján is elesik.

**A recovery-bizonyíték végre létezik** (ezt a döntést rám bíztad). Nem a
projekció bővítésével: az négy mezőt épít kézzel, hat válaszba ágyazódik, és a
`loadRun` minden olvasáskor összeveti az audit-visszajátszással. Helyette **saját
végpont**: `GET /runs/:key/recovery`, **szerveroldalon redaktálva** — a prober
`privateDetail` mezője célpontonkénti szabad szöveg, oda kerül egy hostcím, és
egy böngészőbeli típus nem akadályoz meg semmit abban, hogy a böngészőbe
jusson. Három válasz kettő helyett: tiszta / beavatkozás kell / **nincs rögzített
bizonyíték** — ez utóbbi soha nem olvasható tisztának.

**Érintett fájlok:** új `client/src/lib/adminRunSelection.ts` (+ teszt), új
`client/e2e/run-selection.spec.ts`, új `server/src/simulator/recoveryView.ts`
(+ teszt); módosítva `dd-admin-shell.ts`, `dd-simulation-control.ts`,
`admin-api.ts`, `simulationRunState.ts`, `simulationControl.service.ts`,
`simulationPersistence.service.ts`, `simulationAdmin.v1.routes.ts`,
`playwright.config.ts`, a harness és a fixture-ök.

**Szerződésváltozás / kompatibilitás:** **új** végpont
(`GET /runs/:runKey/recovery`), additív. A meglévő válaszok alakja változatlan.
Régi szerver + új kliens: a recovery-olvasás hibára fut, a panel `null`-t tart,
és **nem** ír ki tisztát. Telepítési sorrend: szerver előbb.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **839** szerver (836 → 839) + **121** kliens (111 → 121) |
| K2 | exit 0 — **40** böngészőteszt (37 → 40) |
| K3 | exit 0 — 12 integrációs fájl, **77** teszt (8 skipped) |

**Valós HTTP/Mongo tesztek (2 új, összesen 7 a fájlban):** a recovery-végpont
kiszolgálja a bizonyítékot, de a válasz **nem tartalmazza** a `privateDetail`
mezőt és a beültetett `198.51.100.11` címet; nem létező futamra **404**, nem
„nincs recovery" (az utóbbi azt olvasná, hogy nincs mit takarítani).

**UI-fixture tesztek (9 új):** URL-ből visszatöltött futam a mentett tervvel
(és **nulla POST**); draftszerkesztés után is ott az Abort gomb; hibás kulcs →
hiba, és az aktív futamot **nem** veszi át; nem feloldható kulcs → mindkét
felület kiírja a kulcsot, nincs vezérlés; A→B váltás 1,2 s-ot késő A-válasszal;
sessionlejárat elveszi a vezérlést; kijelentkezés törli az URL-paramétert;
recovery-bizonyíték megjelenik; bizonyíték hiányában „nincs rögzítve", nem
„tiszta".

**Negatív kontroll:** a `_draftChanged()`-be visszatéve a
`this._prepared = null` sort a draftszerkesztéses teszt elbukik, a másik hét
átmegy. Visszaállítva minden zöld.

**Két flake, és ami mögötte volt.** Ma kétszer bukott el egy-egy teszt, mindkettő
**egyedül futtatva zöld** (`experimentOutcome.integration.test.ts` és a
sessionlejárat E2E). Nem retry-jal kezeltem: minden Playwright worker ugyanazt a
Vite dev szervert hajtja, és négy fölött a torlódás állítás-timeoutként
jelentkezik, ami viselkedési hibának látszik, pedig kapacitás. A worker-szám
4-re korlátozva, az `expect` budget 10 s; a suite ezután **kétszer egymás után
40/40**. Az integrációs flake-et nem vezettem vissza gyökérokra — a hibaüzenetet
nem kaptam meg, és a fájl azóta kétszer zöld. **Nyitva marad.**

**Valódi laborfutam:** NEM FUTOTT.

**Más munkából megőrzött változtatás:** a `CLAUDE.md` munkafában lévő
módosítása (a node-binárisok sora, 2026-09-11-i méréssel) **nem az enyém**;
érintetlenül hagytam, és nem került a commitba.

```text
Commit(ok), végső SHA: 5fd3307
Végső git státusz: tiszta, a fenti CLAUDE.md-módosítás kivételével
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 07. nap – Frissülő futamállapot és műveletversenyek

```text
Nap / dátum / implementáló: 07 / 2026-09-11 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ f85a981
Napi feladat és előfeltételei: F02. Előfeltétel: 05–06. nap — megvan.
Auditpontok: F02 (és az F01 maradéka)
```

**Reprodukált kiinduló hiba:** a vezérlőpanel **saját futammásolatot** tartott,
amit a kiválasztáskor egyszer betöltött és soha nem frissített, miközben
mellette a dashboard 30 másodpercenként egy **másik** kérésből frissítette a
listát. A lista mutathatott `recovery`-t, miközben a gombok még mindig egy
befejezett futam indítását kínálták, és ezt kizárólag egy másik futam
kiválasztása javította.

**Változtatás röviden — egy tulajdonos.** A dashboard birtokolja a futamot és
adja le property-ként. **5 s-onként** kérdezi, amíg a lap látható és a futam nem
terminális, a publikus oldalakkal közös `PollController`-en keresztül: az
intervallum, a láthatóságkezelés és az előző tick megszakítása egy helyről jön,
és egy befejezett futamot nem kérdez tovább. A **tervet és a recovery-t
kiválasztásonként egyszer** olvassa — a terv immutable, a bizonyíték csak
recovery futásakor változik.

Műveletválasz után **azonnali** egyeztetés: az a legfrissebb leírás, ami létezik,
és öt másodpercig elavult panelt nézetni az operátorral pont az, amitől második
kattintás lesz. Hogy elfogadjuk-e, a szerver `revision` mezője dönti el, a
shellel közös szabályból — így egy már repülő poll nem tudja visszacsinálni a
közben megtörtént abortot.

**Az idempotency kulcs futamra ÉS műveletre van szűkítve.** Eddig csak műveletre
volt: az „A futam abortja, majd B futam abortja ugyanabból a panelből" **A
kulcsát használta újra** — a szerver B abortját A ismétlésének ismerte volna
fel, B soha nem abortált volna, a panel meg azt írta volna, hogy igen. A kulcs
csak akkor évül el, ha a saját művelete sikerült, tehát a bizonytalan kérés
ugyanazzal a kulccsal ismételhető.

**Egy hiba, ami a duplikáció mögött bujkált:** a `_loadDashboard` a **munka
végén** törölte az üzenetét, ezzel kitörölve azt, amit a benne futó
kiválasztás-betöltés épp jelentett. A „No run sim_… exists on this deployment"
ugyanabban a tickben jelent meg és tűnt el; csak azért látta bárki, mert a panel
kiírta a saját másolatát is. Most nem írja ki — és a teszt elkapta.

**Érintett fájlok:** `dd-admin-shell.ts`, `dd-simulation-control.ts`,
`e2e/harness.ts` (idempotency-fejléc rögzítése), új `e2e/run-status.spec.ts`,
`e2e/run-selection.spec.ts`.

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód ma nem változott; a
backend állapotgépéhez a terv szerint nem nyúltam.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 839 szerver + 121 kliens |
| K2 | exit 0 — **48** böngészőteszt (40 → 48) |
| K3 | exit 0 — 12 integrációs fájl, 77 teszt |

**UI-fixture tesztek (8 új, szabályozott órával):** a teljes állapotmenet
`activation_pending → fault_active → observing → recovery → cooldown →
completed` kizárólag szerverállapotból, és a `completed` után **megszűnik** a
kérdezés; elavult revisionű poll nem csinálja vissza az abortot; két kattintás
egy kérés; idempotency kulcs futamonként külön (a **tényleges fejlécet**
összehasonlítva); lejárt lease **nem** recovery-bizonyíték, és a „Retry recovery
proof" ott marad; rejtett lap nem kérdez, visszatéréskor újra kérdez; hibás
státuszolvasás **nem** veszi el a futamot és a gombokat; a mentett terv egyszer
olvasódik, a státusz többször.

**Negatív kontroll:** az `acceptsRunUpdate`-et mindig `true`-ra állítva az
elavult-poll teszt elbukik, a másik hét átmegy.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** a `_loadDashboard` és a
státusz-poll még két külön ütemterv; a dashboard 30 s-os frissítése továbbra is
`setInterval`, tehát **rejtett lapon is fut**. A futam pollja nem, mert az a
`PollController`-en van. A dashboard átvezetése ugyanoda a 18. napi
navigációs munkánál logikus, de ma nem tettem meg — a nap hatóköre a kiválasztott
futam volt.

```text
Commit(ok), végső SHA: c1e3605
Végső git státusz: tiszta, a más munkájából származó CLAUDE.md-módosítás kivételével
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## Checkpoint 1 (07. nap) – F01, F02, F03, F09

**Összegzés:** mind a négy pont **kliensoldalon lezárva**, egyik sincs élesben
telepítve. Az alábbi táblázat külön kezeli a kódot, az ellenőrzést és azt, amit
**nem** bizonyítottunk.

| Pont | Kód | Ellenőrzés | Amit ez NEM bizonyít |
|---|---|---|---|
| F01 futamvezérlés elvesztése | `5fd3307` | 10 unit + 9 E2E; negatív kontroll piros | Hogy egy valódi laborfutam vezérlése végigmegy — laborfutam nem futott |
| F02 állapotkövetés | `c1e3605` | `simulationRunState` unit + 8 E2E szabályozott órával | Hogy a szerver állapotgépe helyes — azt nem módosítottam és nem is auditáltam |
| F03 adatfrissesség | `c5c872c` | 15 unit + 7 E2E; negatív kontroll 3 pirosat adott | Hogy minden oldal jelez adatkort — csak a fejléc és az Overview |
| F09 scenario-alapértékek | `127e53d` | unit (minden sablon átmegy a sémán) + HTTP + 8 E2E | Hogy a célpontok léteznek vagy a preflight átmegy — az külön kérdés, és ki is van írva |

**Auth és idempotencia megőrzése — bizonyíték:**

- A szerveroldali jogosultság-ellenőrzést **nem gyengítettem**: az egyetlen
  szerverváltozás a napokban egy **új, olvasó** végpont
  (`GET /runs/:key/recovery`), ugyanazon `requireAdminAuth` mögött; HTTP-teszt
  igazolja, hogy hitelesítés nélkül **401**.
- A CSRF-token továbbra is minden mutációval megy (`admin-api.ts` `request`),
  és a mutációk **nem** kaptak `AbortSignal`-t — egy megszakított fetch nem
  mond semmit arról, hogy a szerver alkalmazta-e.
- Az idempotency kulcsok szűkítése **szigorítás**: a 07. napi E2E a tényleges
  `x-idempotency-key` fejlécet hasonlítja össze.
- Redakció: a recovery-válaszból a `privateDetail` **szerveroldalon** kimarad,
  beültetett `198.51.100.11` címmel bizonyítva.

**Feloldatlan versenyhelyzet: nincs ismert.** A terv feltétele szerint ezért a
15–17. napi szimulátoros munka ráépülhet. Amit viszont ki kell mondani: a
verseny-bizonyítékok **mockolt szerverválaszokkal** készültek. A szerver
állapotgépe, a lease és a lock valódi viselkedése ebben a körben nem volt
tesztelve, és a 20. napi labor-elfogadás nélkül nem is lesz.

**Trace-ek és képernyőképek:** `client/playwright-report/` és
`client/test-results/`, csak sikertelen futásnál keletkeznek, kizárólag kitalált
adatból. Jelenleg nincs bukás, tehát nincs artefaktum sem.

**Nyitott tételek a checkpoint idején:**

1. Az integrációs suite egy flake-je (06. nap) gyökérokra nem vezetve.
2. A dashboard 30 s-os frissítése rejtett lapon is fut.
3. A CI böngészős lépése még **nem futott le élesben** (01. nap óta nyitva).
4. F13 (függőségek) újramérése a 13. napon; az `npm audit` azóta 0-t jelez.

## 08. nap – Kísérletlista teljessége

```text
Nap / dátum / implementáló: 08 / 2026-09-11 (befejezve 2026-09-12) / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ 3a4ae3b
Napi feladat és előfeltételei: F04. Előfeltétel nincs a 07. napon túl.
Auditpontok: F04
```

**Reprodukált kiinduló hiba:** a `dd-page-experiments.ts` így kérte a listát:
`(await run.api.experiments()).items` — **argumentum nélkül**. A szerver
alapértelmezése 25, az archívum 34 rekord: kilenc kísérlet elérhetetlen volt
arról az egyetlen képernyőről, ami indexeli őket, és semmi nem utalt rá, hogy
van több. A szerver eddig is helyesen lapozott és adta a valódi `total`-t — a
kliens egyiket sem használta.

**Változtatás röviden:** szerveroldali lapozás 25-ösével, a darabszám a
kártyafejlécben és a pagerben, státuszszűrő, Newer/Older. Szűrőváltás **lap
1-re** áll: a lezárt futamok 2. oldala nem ugyanaz, mint az összes futam 2.
oldala. Három addig azonos kinézetű üres állapot szétvált — betöltés / hiba /
tényleg üres —, mert ezen az oldalon a „nem történt semmi" az az egyetlen
válasz, amit sosem szabad megtippelni. És két futam részlete között váltva a
régi nem marad ott az új URL alatt.

**Érintett fájlok:** `client/src/components/dd-page-experiments.ts`,
`server/src/routes/v1/experiments.v1.routes.ts`, új
`client/e2e/experiments.spec.ts`, új
`server/src/integration/experimentPaging.integration.test.ts`.

**Szerződésváltozás / kompatibilitás:** nincs. A route válaszalakja változatlan;
csak a rendezés kapott `runKey` tie-breakert.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 839 szerver + 121 kliens |
| K2 | exit 0 — **56** böngészőteszt (48 → 56) |
| K3 | exit 0 — **13** integrációs fájl, 84 teszt (8 skipped) |

**UI-fixture tesztek (8 új):** 34 rekord végiglapozása (1–25, majd 26–34, a
végén tiltott Older); a lapot a **szervertől** kéri (`offset=0`, `offset=25`);
státuszszűrő a darabszámot is szűkíti; szűrőváltás visszaáll az 1. lapra
(`status=running&offset=0`); üres archívum kimondva; **betöltés közben nem
állítja, hogy üres**; hibás betöltés sem olvasható üresnek; és egy futam
részlete nem marad ott egy másik URL alatt.

**Valós HTTP/Mongo tesztek (7 új):** valódi `total` a kiszolgált lap mellett;
34 rekord végiglapozása duplikáció és kimaradás nélkül; a deklarált sorrend;
ugyanaz a lap kétszer ugyanazt adja; a szűrő azt számolja, amit illeszt; utolsó
részleges lap; végen túli offset **üres lap + igaz `total`** (nem nulla).

**Negatív kontroll:** az argumentum nélküli `api.experiments()` hívást
visszatéve a 8 böngészőtesztből **3 elbukik**. Visszaállítva minden zöld.

**Egy állítást kétszer kellett helyesbítenem — ez a nap fontosabb tanulsága.**
A `runKey` tie-breakerhez előbb azt írtam a kódba és a tesztbe, hogy duplikált
és kimaradt sorokat javít. **A negatív kontroll nem bukott el**, ezért
megmértem közvetlenül:

- index **nélküli** rendezésnél 8 azonos kulcsú dokumentumot 4-es lapokban
  lapozva a MongoDB kettőt kétszer adott vissza (`r-0`, `r-2`), kettőt pedig
  egyszer sem (`r-4`, `r-7`);
- az `ExperimentRun` gyűjteményen viszont **van `startedAt` index**, és azzal a
  sorrend tie-breaker nélkül is determinisztikus — szűrővel és anélkül is.

Tehát a tie-breaker **biztosíték, nem megfigyelt hiba javítása**, és az F04
tisztán kliensoldali volt. A kód kommentje és a tesztfájl fejléce most pontosan
ezt mondja; a második, „a deklarált sorrendet bizonyítja" megfogalmazás is
téves volt, és szintén javítva.

**Valódi laborfutam:** NEM FUTOTT.

**Kihagyott ellenőrzés és oka:** szöveges keresés — a terv kifejezetten
kihagyhatónak jelölte ebben a hatókörben, és 25 betöltött soron imitálni
félrevezető lenne.

**Nyitott probléma / következő lépés:** a lapozás állapota még **nincs az
URL-ben** (`?page=`, `?status=`) — az a **10. nap** feladata, és a mostani
`_offset`/`_status` mezők pont annak a bemenetei.

```text
Commit(ok), végső SHA: 6c6fc96
Végső git státusz: a saját munkám tiszta. A fában maradt, NEM az enyém:
  CLAUDE.md módosítása és hat `ops/fleet-roll-dslv2-*.sh` / `ops/seed-roll-dslv2.sh`
  fájl a devnet-flotta munkájából — érintetlenül hagyva, nem stagelve.
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 09. nap – Fairness korrekció

```text
Nap / dátum / implementáló: 09 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ abba17c
Napi feladat és előfeltételei: F05, F06. Szerveroldali DTO is változik, tehát K3 alkalmazandó.
Auditpontok: F05, F06
```

**Reprodukált kiinduló hiba — két olvasat, mindkettő ugyanúgy téves: egy
mintára igaz szám, úgy bemutatva, mintha arra lenne igaz, amire a néző gondol.**

1. **F05.** A `dd-page-fairness.ts` így kért:
   `run.api.selectionFairness(this._rounds)` — **`llmqName` nélkül**. A szerver
   pedig profil nélkül **nem szűr**. Vagyis minden szám a lapon öt egymásba
   fésült ütemterv összegéből készült, és semmi nem írta ki. Ez az a hiba,
   amit a projekt saját jegyzetei kifejezetten tiltanak.
2. **F06.** A hosttábla „Masternodes" oszlopa a `hosts[].nodes` mezőt írta ki,
   ami a **mintában legalább egyszer kiválasztott** node-ok száma. Élesben egy
   hétnode-os host ötöt mutatott — a másik kettő nem tűnt el, hanem **kimaradt a
   kiválasztásból**, és pont ez a lap mondanivalója.

Emellett a csempék az `invalid` összeget a **képernyőn lévő sorokból** számolták,
miközben a route a node-listát **200 elemnél levágja**.

**Változtatás röviden:** a lap a front page-dzsel azonos szabállyal oldja fel az
aktuális profilt (ChainLock-aláírók + tip), **kiírja** a számok mellé, és a
registryből kínálja a többit. Az aggregát megmaradt — **választásként**, olyan
néven, ami megmondja, mi az. Ha a profil nem állapítható meg, a lap **kérdez**,
és **semmit nem tölt be**.

A hosttábla két oszlop, két forrásból: `Registered nodes` az aktuális
registryből, `Selected nodes` a mintából. A mintában nem szereplő, de jelenleg
regisztrált host **nullával szerepel**, nem hiányzik; az ablak után regisztrált
node viszont **nem számít bele** — ugyanaz a szabály, amiért az eligibility
létezik: nem kimaradt, hanem nem volt ott.

Az `invalid` összeg a szerveren, **a vágás előtt** készül, a legrosszabb
node-aránnyal együtt. Régi szerver (`totals` nélkül) → **em dash**, nem a
szeletből számolt szám: a szelet nem tartalék, hanem másik szám. Ugyanez a
`currentRegisteredNodes`-ra: hiányzó és `null` egyaránt **ismeretlen**, nem nulla.

**Érintett fájlok:** `shared/src/index.ts` (additív DTO),
`server/src/domain/selectionFairness.ts` (+ teszt),
`server/src/routes/v1/fairness.v1.routes.ts`, új
`server/src/integration/fairnessSelection.integration.test.ts`,
`client/src/lib/api.ts`, `client/src/components/dd-page-fairness.ts`, új
`client/e2e/fairness.spec.ts`, `client/e2e/fixtures/api.ts`.

**Szerződésváltozás / kompatibilitás:** **additív**. Új:
`hosts[].currentRegisteredNodes` és `totals`. A `hosts[].nodes` jelentése
**változatlan** (kiválasztott node-ok száma) — csak a UI neve lett `Selected
nodes`. Régi szerver + új kliens: mindkét új mező hiányában `—`, nem 0 és nem
a szeletből számolt összeg. A Fairness képletei és a konszenzus nem változtak.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **844** szerver (839 → 844) + 121 kliens |
| K2 | exit 0 — **65** böngészőteszt (56 → 65) |
| K3 | exit 0 — **14** integrációs fájl, 89 teszt (8 skipped) |

**Valós HTTP/Mongo tesztek (5 új):** a profilszűrő tényleg szűkít (llmq_defcon
**2**, llmq_400_60 **1**, aggregát **3** kör — tehát a három válasz nem
ugyanaz); 7 regisztrált / 5 kiválasztott egy válaszban; a néma host nullával
szerepel; a `totals` minden node-ot számol; és a **redakció**: a beültetett
RFC 5737 címek (`198.51.100.11/.12`) **egyike sem** szerepel a teljes
válasz-törzsben, miközben mindkét host tényleg renderelődött.

**UI-fixture tesztek (9 új):** a tipnél aláíró profilt kérdezi és ki is írja;
profilváltás követi az adatot; az aggregát explicit választás; feloldhatatlan
profilnál **nulla** fairness-kérés indul, és a választás indítja el; a
hosttábla két oszlopa; néma host nullával; hiányzó mező `—`; a totals a
szerverről jön (41 / 300 a képernyőn lévő 2 helyett); `totals` nélküli szerver
kiírja, hogy nem jelentette.

**Negatív kontrollok (mindkettő tüzelt):**

1. A `currentRegisteredNodes`-t a kiválasztott számra állítva **2 unit + 2
   HTTP** teszt bukik el.
2. Az `llmqName` küldését kivéve **4 böngészőteszt** bukik el.

**Valódi laborfutam:** NEM FUTOTT.

**Kihagyott ellenőrzés és oka:** az auditban szereplő 43,09% / 39,47% **nem
került tesztelvárásba** — az auditpillanat mérése, nem szerződés.

**Nyitott probléma / következő lépés:** a profil- és ablakválasztás még **nincs
az URL-ben** — a **10. nap** feladata, és a mostani `_llmq` / `_rounds` mezők
annak a bemenetei.

```text
Commit(ok), végső SHA: 881df65
Végső git státusz: a saját munkám tiszta. A fában maradt, NEM az enyém:
  CLAUDE.md módosítása és hat ops/*-dslv2*.sh fájl a flottamunkából.
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 10. nap – URL-szűrők alapja

```text
Nap / dátum / implementáló: 10 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/audit-2026-09-11 @ b9c5556
Napi feladat és előfeltételei: F11 alapja. Előfeltétel: 08–09. nap — megvan.
Auditpontok: F11 (alap; a többi oldal a 11. nap)
```

**Reprodukált kiinduló hiba:** mindhárom szűrt oldal komponensmemóriában tartotta
az állapotát (`_status`, `_llmq`, `_offset`, `_rounds`). Frissítés elvesztette,
link nem vitte. Egy incidens vizsgálata közben beállított profil, státusz,
ablak és oldalszám **nem adható át senkinek** — a hibajegybe bemásolt URL más
képernyőt nyit meg, mint amelyik megtalálta a dolgot.

**Változtatás röviden:** új `client/src/lib/queryState.ts` három szabállyal:

1. **Az alapérték hiányzik, nem kiírva** — a sima útvonal a sima nézet, és két
   különböző úton ugyanoda jutó olvasó ugyanazt a linket adja tovább.
2. **Az URL-ben `page` 1-től, az API-ban `offset`** — egy helyen konvertálva,
   nem három komponensben, három eséllyel elrontani.
3. **Ami olvashatatlan, az alapértékre esik** (negatív, NaN, ismeretlen státusz,
   a szerver `MAX_OFFSET`-jén túli oldal), és az URL **`replace`-szel** javul:
   a javítást nem az olvasó kérte, ne kerüljön neki egy Back-be.

**Egy hely reagál a szűrőváltásra.** A vezérlő az URL-t írja, a kontroller
egyszer adja vissza az értékeket, a poll abból az egy visszahívásból tölt.
A history-írás **nem** dob `popstate`-et — az útvonal nem változott, és a dobás
minden kattintásnál újramountolná az oldalt.

**A Fairness külön eset:** a hiányzó `llmq` nem az aggregát, hanem „amelyik a
tipnél aláír", a láncból feloldva; az `llmq=all` a választott aggregát. A
feloldott nevet **nem** írjuk az URL-be — az befagyasztana egy linket, aminek
követnie kellene a tipet. Az effektív profil **minden olvasáskor** feloldódik,
nem latch-elve: különben a profil nélküli URL-re visszalépve az utoljára
választott név maradna a lapon.

**Egy valódi hiba, amit a nap hozott elő:** a publikus linkinterceptor
**elnyelte az `/admin` linket**. Az a külön shell, amit a `main.ts` a pathname
alapján tölt be; az interceptor pusholta az útvonalat anélkül, hogy a shell
betöltődött volna, és ennek a routernek nincs rá route-ja — vagyis egy link,
ami begépelve működik, kattintva **„page not found"**-ot adott volna.

**Érintett fájlok:** új `client/src/lib/queryState.ts` (+ teszt), új
`client/e2e/query-state.spec.ts`; módosítva `router.ts` (+ teszt),
`dd-page-rounds.ts`, `dd-page-fairness.ts`, `dd-page-experiments.ts`.

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód ma nem változott.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + **139** kliens (121 → 139) |
| K2 | exit 0 — **75** böngészőteszt (65 → 75) |
| K3 | exit 0 — 14 integrációs fájl, 89 teszt |

**UI-fixture tesztek (10 új):** `/rounds?llmq=…&status=failed&page=2`
**egyetlen** kéréssel és `offset=50`-nel; szűrőkattintás URL-be kerül és
**pontosan egy** további kérést indít; Back visszaadja az előző szűrőt;
olvashatatlan query javul **Back nélkül**; `page=999999` a szerverkorláthoz
vágódik (2001 / `offset=100000`); Fairness viszi a profilt és az ablakot;
profil nélküli Fairness a tipet követi, és Back is oda tér vissza;
Experiments viszi a státuszt és az oldalt; szűrőváltás **1. oldalra** állít az
URL-ben és a kérésben is; gyors egymás utáni váltásnál az **utolsó** kérdés
válasza marad a képernyőn.

**Negatív kontroll — és itt megint kellett egy második kör.** A javítást
`push`-ra váltva a suite **zölden maradt**: a felesleges history-bejegyzés
ugyanazon a pathnamen ült, amit az állításom nézett. A tesztet átírtam úgy,
hogy másik oldalról induljon — így a `push` **pirosra viszi**. Ez a harmadik
alkalom ezen az ágon, hogy a negatív kontroll olyan tesztet buktatott le,
ami semmit nem bizonyított.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** a többi oldal időablak- és
topic-vezérlői (PoSe, ChainLocks, Staking, Vantage Points, Blocks,
Transactions, Sentinel Layer) még nincsenek URL-hez kötve — **11. nap**.

```text
Commit(ok), végső SHA: 700c420
Végső git státusz: a saját munkám tiszta. A fában maradt, NEM az enyém:
  CLAUDE.md módosítása és hat ops/*-dslv2*.sh fájl a flottamunkából.
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 11. nap – A többi meglévő szűrő URL-je

```text
Nap / dátum / implementáló: 11 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day11-url-filters @ 90993b3 (main, a J1–J3 merge után)
Napi feladat és előfeltételei: F11 befejezése a többi oldalon.
  Előfeltétel: 10. nap (`queryState.ts`) — megvan.
Auditpontok: F11
```

**Először a tábla, ahogy a terv kéri.** A nap szabálya az, hogy a **meglévő**
vezérlőket kell URL-hez kötni, és amelyik oldalon nincs vezérlő, ahhoz **ne
találjak ki újat**. A hét megnevezett oldalt végignézve:

| Oldal | Vezérlő | Komponensállapot | API-paraméter | URL-paraméter |
|---|---|---|---|---|
| PoSe Watch | **nincs** | — | rögzített 24 ó / 7 nap | — |
| ChainLocks | **nincs** | — | rögzített 500 blokk | — |
| Sentinel Layer | **nincs** | — | rögzített `limit=200` | — |
| Vantage Points | topic | `_topic` | `topic` | `topic` |
| Staking | időablak | `_blocks` | `blocks` | `blocks` |
| Staking | leaderboard nézet | `_view` | **nincs** (csak megjelenítés) | `view` |
| Blocks | lapozó | `_offset` | `offset` | `page` |
| Transactions | lapozó | `_offset` | `offset` | `page` |

Ellenőriztem a Masternodes és az Operators oldalt is: egyiken sincs vezérlő.
Tehát **négy** oldalon van ténylegesen kötnivaló, három megnevezett oldalon
pedig szándékosan **semmi**.

**A queryState nem kapott új primitívet.** Az `enum`, a `choice` és a `page`
mind a négyet lefedi; a szerver `MAX_OFFSET`-je (100 000) és a kliensé
megegyezik, tehát a lapszám vágása nem talál ki saját korlátot.

**A legbeszédesebb veszteség a topic volt.** Aki talált egy hostot, amelyik a
ChainLockokon lassú, a blokkokon nem — ez pont az a különbségtétel, amiért az
oldal létezik —, **nem tudta továbbadni** a képernyőjét: a link a másik
témára nyílt. A staking ablaka a legfélrevezetőbb: az „egy gép termelte a
blokkok 40%-át" **egy mintáról szóló állítás**, és az a link, amelyik a mintát
elejti, az állítást a minta nélkül adja tovább.

**Egy vezérlő, ami szándékosan nem kér újra.** A staking leaderboard nézete
(gépek vs. kifizetési kulcsok) a **már a képernyőn lévő** válasz másik olvasata
— két daemon egy gépen egy gép —, ezért bekerül a linkbe, de nem indít kérést.
A staking visszahívása csak akkor frissít, ha az **ablak** mozdult; ez a
változás előtt is így volt, és a teszt ki is feszíti.

**Érintett fájlok:** `dd-page-peers.ts`, `dd-page-staking.ts`,
`dd-page-blocks.ts`, `dd-page-txs.ts`; `client/e2e/fixtures/api.ts`
(+5 fixtúra) és `client/e2e/query-state.spec.ts` (+12 eset).

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód nem változott, új
API-paramétert nem vezettem be — mind a négy vezérlő olyan paramétert használ,
amit a szerver eddig is fogadott.

**Negatív kontrollok — három, oldalanként:**

| Kivett kötés | Ami elpirult |
|---|---|
| peers topic vissza komponensmemóriába | „choosing a topic lands in the URL, and Back returns to the other one" |
| staking ablak + nézet vissza | „the window lands in the URL…" **és** „the leaderboard view is in the URL and costs no request" |
| mindkét lapozó vissza | „paging lands in the URL…" **és** „a reload keeps the page of transactions…" |

**A harmadik kontroll elsőre csak félig bukott**, és ez a nap tanulsága: a
Transactions oldalon csak az **olvasási** irány volt kifeszítve. Az URL
olvasása és írása **két külön huzalozás**, és az az állapot, amikor egy vezérlő
olvas, de nem ír, pontosan az, amiből ezek az oldalak indultak — a `_move()`
visszaállítása után a reload-teszt zöld maradt, mert a `connectedCallback` még
mindig olvasta az URL-t. A teszt most a reload után **tovább is lapoz**, így
mindkét irány bizonyított.

**Egy hibaosztály, amit a CI hozott elő, nem a gépem.** A PR első CI-futása
megbuktatta a **10. napi** „a page past the server offset cap is clamped"
tesztet. A teszt megvárja, amíg az **URL** beáll, aztán **egyszer** kiolvassa a
kéréslistát — csakhogy az URL előbb áll be, mint ahogy az általa kiváltott kérés
elindul. A gépemen két napig zöld volt, a CI lassabb gépén elsőre elbukott: az
állítás időzítésről szólt, nem arról a viselkedésről, amit megnevez.

Öt állítás volt ilyen alakú — **három a 10. napról, kettő a maiból** —, és mind
az öt `expect.poll`-ra váltott. A megkülönböztető kérdés az, hogy az előtte lévő
várakozás **mit bizonyít**: a válaszból származó, kirajzolt adatra várni elég;
az URL-re vagy egy custom element létezésére várni **nem**, mert egyik sem
jelenti azt, hogy a kérés megtörtént. Ugyanez a hiba jött elő két commit-tal
korábban a Fairness-tesztben is — a második előfordulás teszi osztállyá.

**Amit ma szándékosan NEM csináltam:** a staking nézetváltó gombjain nincs
`aria-pressed`, az ablakválasztón van. Ez valódi hiány, de a **12. nap**
(szemantika, fókusz, kontraszt) dolga; nem kezdek bele egy másik nap
feladatába azért, mert útközben láttam.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + 151 kliens unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **104** böngészőteszt (92 → 104); a query-state suite négyszer egymás után zöld, a teljes suite **egy workerrel** (ahogy a CI futtatja) kétszer |

A 10. napi három oldal (Rounds, Fairness, Experiments) regressziótesztjei
változatlanul zöldek.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** F11 kliensoldalon ezzel teljes. A
**12. nap** (F12 + F14: szemantikus címek, fókuszkezelés, kontraszt)
elkezdhető; függősége nincs a mai munkán túl.

```text
Commit(ok), végső SHA: b954e9b (kötések + tesztek), 1a0d7d3 (a versenyhelyzetes állítások)
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 12. nap – Szemantika, fókusz, kontraszt

```text
Nap / dátum / implementáló: 12 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day12-semantics-focus-contrast @ 5076718 (main, a 11. nap után)
Napi feladat és előfeltételei: F12 + F14. Előfeltétel: nincs a 11. napon túl.
Auditpontok: F12, F14
```

**Reprodukált kiinduló állapot.** Minden publikus oldal `<div class="page-title">`
elemben nevezte meg magát, vagyis a dokumentumnak **egyáltalán nem volt
címhierarchiája** — egy képernyőolvasó címlistája a site minden oldalán üres
volt. A navigáció görgetett és dokumentumcímet állított, a **fókuszt ott hagyta,
ahol volt**: egy billentyűzetes olvasó úgy érkezett meg egy új oldalra, hogy
semmi nem jelezte, történt valami, és a teljes fejlécen át kellett tabbolnia,
hogy elérje. Ugrás a tartalomra nem létezett.

**Ami változott:**

1. **Egy h1 oldalanként**, alatta h2 szekciók. A szimulátor vezérlőpanelje az
   admin shellben ül, aminek a brandje már az **ő** dokumentumának h1-e, ezért
   ott h2 a panel neve és h3 a három lépése — egy szinttel lejjebb, mert a
   körülötte lévő dokumentum más.
2. **A fókusz a navigáció után az új oldal címére kerül**, `tabindex="-1"`-gyel,
   **mindkét render bevárása** után: a shellé, ami becseréli az oldalelemet, és
   magáé az oldalé, ami a címet legyártja. Különben a cím még nem létezik, és a
   fókusz a semmibe megy.
3. **Az őrszem a javítás másik fele.** A Back egy szűrőváltás fölött is
   `popstate`, de **nem navigáció**: az oldal nem változott, tehát nincs mit
   bejelenteni, és a fókusz oda tartozik, ahol az olvasó hagyta. A pollok pedig
   ezt a kódot egyáltalán nem hívják.
4. **Ugrás a tartalomra**, ami tényleg működik. A `href="#content"` önmagában
   **nem** tud működni: a fragment egy shadow rooton belüli id-t nevez meg, a
   böngésző pedig a dokumentumban keresi. A href marad — ez az, amit a link
   *jelent* és amit az állapotsorban látni —, a kezelő teszi igazzá.
5. **Caption a táblázatába** (`dd-simulation-control.ts`).
6. **A veszélygomb saját színpárja.**

**F14 — miért nem a `--crit`-et sötétítettem.** Fehér a `--crit`-en sötét témában
**3,23:1**, pontosan ahogy az audit mérte. De a `--crit` **szövegszín** 26 helyen,
ahol 4,5:1 fölött van, és a palettateszt ezt meg is követeli — a sötétítés
mindet magával rántaná. A gomb ezért **saját párt** kapott
(`--btn-danger-bg` / `--btn-danger-fg`, sötét témában 7,29:1, világosban
5,61:1), a keret pedig maradt `--crit`, hogy a gomb továbbra is **alakként**
olvasható legyen a felület előtt (5,0–5,9:1 a felületeken). A paletta globális
átrajzolása így elmaradt, ahogy a terv kérte.

**A palettateszt eddig nem is láthatott gombot:** szövegtokeneket mért
felületszíneken. Mostantól a **tényleges párosításokat** is méri, és rögzíti
mérésként, hogy a régi kompozíció valóban a küszöb alatt volt.

**Érintett fájlok:** 15 publikus oldalkomponens (címek), `dd-shell.ts`
(skip link, `<main id="content" tabindex="-1">`, fókusz), `dd-simulation-control.ts`
(címszintek, caption, gomb), `styles/global.css` (a pár), `styles/shared.ts`
(`.card-title` margó), `styles/contrast.test.ts` (+3 eset), új
`client/e2e/accessibility.spec.ts` (15 eset).

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód nem változott.

**Egy mérés, ami megjavította a saját elvárásomat.** Az audit szerint a
táblázaton kívüli caption „nem társul" a táblázathoz. Megmértem: a HTML-elemző
**eldobja** — a caption egyáltalán **nincs benne a DOM-ban**. Vagyis nem egy
társítás veszett el, hanem **maga a szöveg**. Az első tesztem árva captionöket
számolt, és a hibával együtt is **zöld maradt**, mert nem volt mit számolnia.
A teszt most a **jelenlétet** kéri számon, és a `parentElement`-et.

**Negatív kontrollok — hét, és kettő elsőre nem bukott:**

| Kivett őrszem | Ami elpirult |
|---|---|
| fókuszmozgatás navigációkor | 3 eset (navigáció, Back, billentyűzetes útvonal) |
| a skip link kezelője (csak href marad) | „the skip link is the first stop…" |
| a gomb a `--crit`-re mutat vissza | „the danger button clears 4.5:1 in the dark theme" |
| a `--btn-danger-bg` token vissza a világosra | 2 unit eset a `contrast.test.ts`-ben |
| az Overview címe vissza `div`-be | 3 eset (egy h1, minden oldal, Back) |
| a popstate-őrszem | „Back over a filter change does not move the focus" — **csak az új teszt megírása után** |
| a caption vissza a táblázaton kívülre | „the target table carries its caption…" — **csak a teszt átirányítása után** |

A két utólag kifeszített eset a nap érdemi tanulsága. Az őrszemet semmi nem
mérte: a szűrőváltás nem dob `popstate`-et, tehát a „szűrő nem viszi el a
fókuszt" teszt akkor is zöld, ha az őrszem nincs ott — az őrszem a **Back**
esetét védi, és arra kellett külön eset. A captionnél pedig a fenti mérés
mutatta meg, hogy rossz dolgot számoltam.

**Amit a kapuk nem bizonyítanak:** ez **számított színellenőrzés és
fókuszmérés**, nem teljes akadálymentességi tanúsítás; valódi
képernyőolvasóval nem futott. Az `aria-pressed` most már a staking
nézetváltóján is ott van a szegmensvezérlő mintájára? **Nincs** — a nap
fájlköre a címekre, a fókuszra és a kontrasztra szólt, és a nézetváltó
`.toggle` gombjai továbbra sem közölnek megnyomott állapotot. Ez marad nyitva,
és a 20. napi regressziós körben javítandó vagy kifejezetten elfogadandó.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + **154** kliens unit (151 → 154), typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **119** böngészőteszt (104 → 119), **egy workerrel** (ahogy a CI futtatja) kétszer egymás után |

Ellenőrizve a nap kész-feltételei szerint: billentyűzetes fő útvonal (Tab a
navigációig, Enter, majd a fókusz a címen és onnan a szűrőkön), fókusz
láthatóság, fókusz megmaradása poll alatt **és** szűrőváltás alatt, reduced
motion **mindkét irányban mérve**, 200% zoom (nincs vízszintes túlcsordulás),
és a veszélygomb tényleges szín-párja mindkét témában, a lapon számolva.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** a **13. nap** (F13: három moderate
függőségi találat) elkezdhető; függősége nincs.

```text
Commit(ok), végső SHA: 1828831
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 13. nap – Függőségek

```text
Nap / dátum / implementáló: 13 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day13-dependencies @ 3e48551 (main, a 12. nap után)
Napi feladat és előfeltételei: F13. Előfeltétel: nincs.
Auditpontok: F13 (részben — lásd lent)
```

**Az audit reprodukálva, előtte:** `npm audit --json` → **3 moderate**, mind
`qs`, `fixAvailable: true`. A lánc rögzítve (`npm explain qs`):

```
server  express@^4.21.2  →  express@4.22.2
                             ├── body-parser@~1.20.5 → 1.20.6 → qs@~6.15.1 → 6.15.3
                             └── qs@~6.15.1                                → 6.15.3
```

Az advisoryk sávja `qs 2.2.5 – 6.15.3`; a javított verzió a **6.16.0**.

**Két útból az egyik lezárható, manifest nélkül.** A `body-parser@1.20.8` már
`qs@~6.16.0`-t deklarál, és ezt az express saját `~1.20.5` tartománya **eleve
megengedi**. Vagyis a legszűkebb szülőcsomag-frissítés egy **lockfile-változás**:
nincs `package.json` módosítás, nincs override, nincs megsértett tartomány.

**Mérve, nem állítva:** a régi lockfile-lal `npm audit` **3 moderate**-et jelent
és nevesíti a `body-parser`-t; az újjal **2 moderate**-et, a `body-parser` eltűnt
a listáról. Ugyanaz a parancs, ugyanaz a fa, csak a lockfile más.

**Ami marad, és miért.** A maradék kettő az **express saját, közvetlen**
`qs@~6.15.1` függése. A `4.22.2` az utolsó express 4.x, és a 4-es vonalon
**semmi** nem lép le erről a pinről — az egyetlen felfelé út az **express 5**,
ami framework-major, és amit a munkaterv kifejezetten nem kér.

**A CI-ben dokumentált korábbi döntést újraellenőriztem, nem megismételtem.**
A komment azt rögzítette, hogy egy `overrides` bejegyzést **kipróbáltak és
visszavontak**, mert az „megsértene egy deklarált tartományt egy olyan
sérülékenység miatt, amink nincs". Ennek az érvelésnek az **egyik premisszája
megváltozott** — a body-parser már nincs a listán —, a másik viszont áll, sőt
most jobban alátámasztott:

- `app.set('query parser', 'simple')` (`server/src/index.ts:66`) → az express a
  query stringhez **nem** hívja a qs-t;
- `express.urlencoded` **sehol** nincs felcsatolva, csak `express.json` →
  a body-parser sem jut el a qs-hez.

Vagyis egyik advisory kódútja sem érhető el ezen az API-n. Ez **elfogadott
moderate, nevesített úttal — nem javított**.

**A high/critical kapu nem gyengült:** a `npm audit --audit-level=high` sor
változatlan. A CI-komment számai frissültek (három helyett kettő, és a
maradék út megnevezve), a korábbi döntés maga **bent maradt**, nem töröltem ki
a probléma helyett.

**Érintett fájlok:** `package-lock.json` (csak a body-parser-ág),
`.github/workflows/ci.yml` (komment). `package.json` **egyik workspace-ben sem**
változott. `npm audit fix --force` nem futott, a lockfile nem lett törölve,
override nem került be.

**Parancsok, exit-kódok — tiszta checkoutból:**

| Kapu | Eredmény |
|---|---|
| `npm ci` (lockfile-egzakt) | exit 0; a fa: `body-parser@1.20.8` → `qs@6.16.0`, `express@4.22.2` → `qs@6.15.3` |
| `npm audit` előtte / utána | **3 moderate → 2 moderate**; `npm audit --audit-level=high` exit 0 |
| K1 | mind exit 0 — 844 szerver + 154 kliens unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — 119 böngészőteszt, egy workerrel |
| K3 | exit 0 — 14 fájl, 90 integrációs teszt **valódi HTTP-vel** az expressen és a body-parseren át, query stringekkel és JSON bodykkal |

A K3 itt nem formalitás: pontosan azt a két csomagot gyakorolja, amelyek
verziója változott.

**Nyitott probléma / következő lépés:**

- **F13 nem zárható le**, a terv saját feltétele szerint: csak javított láncnál
  zárható. Két moderate marad, **elfogadott** státusszal, express 5-ig.
- **Egy őrszem hiányzik, és ma nem tettem be.** Az elfogadás teljes indoklása
  két konfigurációs tényen áll (`query parser` = `simple`, nincs `urlencoded`),
  és ezt **semmi nem védi**: ha valaki átkapcsol az extended parserre, az
  elfogadott kockázat csendben elveszti az alapját. Egy szerveroldali teszt
  megfogná, de a mai fájlkör manifestekre, lockfile-ra és CI-kommentre szól.
  A **20. napi regressziós körbe** viszem.
- Automatikus frissítési PR-ek (Dependabot/Renovate) az audit javaslatában
  szerepelnek; ma nem vezettem be, mert az a repo-szintű CI-politika része és
  nem ennek a napnak a fájlköre.

**Valódi laborfutam:** NEM FUTOTT.

```text
Commit(ok), végső SHA: 5b8b5a7
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT (F13 részben — elfogadott maradék)
Éles deploy: NEM TÖRTÉNT
```

## 14. nap – nginx fejlécek + 2. checkpoint

```text
Nap / dátum / implementáló: 14 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day14-nginx-headers @ 87f8a7b (main, a 13. nap után)
Napi feladat és előfeltételei: F10, és F07 production fele. Előfeltétel: nincs.
Auditpontok: F10, F07
```

**A terv egy korlátját a tulajdonos feloldotta.** A 14. nap kész-feltétele úgy
szól, hogy „**élő nginxet nem reloadol e nap önmagában**". A megbízó ma
kifejezetten engedélyezte a VPS-t („mehet a vps-re is ami kell"), ezért a
fejlécek **élesbe is kikerültek** — a mérések viszont pontosan abban a
sorrendben készültek, ahogy a terv előírja: előbb izolált nginx, aztán
böngészős CSP-mérés, és csak utána az élő telepítés. A CSP **report-only**
maradt, ahogy a terv kéri.

### Amit tudni kell az `add_header`-ről, és amiért snippet lett belőle

Az nginx `add_header` direktívái **nem halmozódnak**: ha egy `location` akár
egyetlen sajátot deklarál, azzal **eldobja az összes örököltet** — csendben, és
az `nginx -t` ettől még sikeres. Az élő vhost ezt eddig úgy oldotta meg, hogy
ugyanazt a négy fejlécet **három helyen** megismételte. Ez helyes, és pontosan
ez az a szerkezet, amiben egy ötödik fejléc kettőbe bekerül, a harmadikba nem.

Most egy fájl a teljes készlet, és minden location, aminek saját fejléce van,
**beemeli**, majd hozzáteszi a magáét. A location-specifikus `Cache-Control`
sorok érintetlenek.

### Mérés valódi nginxen, nem konfigolvasással

`ops/nginx/verify-headers.sh` saját prefixben, `127.0.0.1:8099`-en indít egy
külön nginxet, és végigméri a `/`, `/rounds`, `/admin`, egy content-hash-elt
asset és **egy valódi 404** válaszát. A 404 azért kell, mert az `always`
viselkedését böngészőből a főoldalon nem lehet látni.

**Negatív kontroll:** kivettem az `include`-ot **egyetlen** locationből. Az
`nginx -t` **továbbra is sikeres**, a szkript viszont pontosan ott bukik el:
`FAIL: content-hashed asset: missing X-Robots-Tag`. Ez az a hiba, amit
konfigszintaxis-ellenőrzés soha nem talál meg.

### A CSP mérve lett, nem megtervezve

Az egyetlen lazítás a `style-src 'unsafe-inline'`. Leszűkítettem
`style-src 'self'`-re, és lefuttattam a **buildelt** appot: pontosan **egy**
direktíva sértődött meg, a `style-src-attr` — és a Littől **semmi**. Vagyis az
ok a 31 számolt `style=` attribútum (sávszélességek, flex-arányok), nem a Lit:
az `adoptedStyleSheets`-et használó böngészőkben a `css` sablonokból
constructable stylesheet lesz, amit a CSP nem vizsgál, és ezt a mérés mutatja.

A szűkebb `style-src 'self'; style-src-attr 'unsafe-inline'` **itt elég lenne**,
és szándékosan nem ezt használom: csendben bukik el olyan böngészőn, aminek
nincs CSP3 `style-src-attr`-je, vagy nincs `adoptedStyleSheets`-je. Egyik sem
mérhető abból az egy böngészőből, amit ez a suite hajt. **A valódi szigorítás a
kliensben van, nem a fejlécben.**

`client/e2e/csp.spec.ts` az **enforce** házirendet teszi a dokumentumra — a
`csp-enforce.conf`-ból **kiolvasva**, nem lemásolva —, mert report-only alatt a
„nincs jogsértés" és „a házirend hatástalan" egyformán néz ki. Van benne
kontroll, ami inline scriptet injektál, és megköveteli a visszautasítást.

**Mindkét bundle-on lemértem.** A `main` mai buildjén **és** a VPS-en
ténylegesen kiszolgált (régebbi) bundle-on is tisztán fut az **enforce**
házirend. Ezért van egyáltalán jogom azt mondani, hogy az élesen bekapcsolt
report-only biztonságos.

### Élő telepítés és az élő mérés

Időbélyeges mentés a vhostról, két snippet a `/etc/nginx/snippets/`-be, a négy
ismételt fejlécsor helyére `include`, `nginx -t`, `systemctl reload nginx`.
Ezután **valódi válaszokon** mérve:

| Útvonal | Státusz | CSP-RO | HSTS | a négy meglévő | Cache-Control |
|---|---|---|---|---|---|
| `/` | 200 | ✓ | ✓ | ✓ | `no-cache` |
| `/rounds` | 200 | ✓ | ✓ | ✓ | `no-cache` |
| `/admin` | 200 | ✓ | ✓ | ✓ | `no-cache` |
| ismeretlen útvonal | 200 (SPA fallback) | ✓ | ✓ | ✓ | `no-cache` |
| `/assets/*.js` | 200 | ✓ | ✓ | ✓ | `immutable` |
| `/api/v1/health` | 200 | ✓ (a helmet sajátja mellett) | ✓ | — | — |

### F07 production fele – lezárva, méréssel

A 2. nap óta nyitott kérdés az volt, mit csinál az **éles** nginx a hibás
percent-escape-ekkel. Megmérve:

| URL | Válasz |
|---|---|
| `/round/%` | **400 Bad Request** |
| `/tx/%E0%A4%A` | **400 Bad Request** |
| `/block/%zz` | **400 Bad Request** |
| `/round/7%3A7416%3A0` (szabályos) | 200 OK |

Vagyis az nginx **a kliens előtt** visszautasítja: a 2. napon javított üres-oldal
hiba **beírt/beillesztett URL-ből nem érhető el** production alatt. A kliensoldali
javítás továbbra is az SPA-n belüli navigációra kell (link, `pushState`), és azt
a böngészőtesztek fedik. A 400 az nginx saját hibalapja, nem a site „That link
could not be read" oldala — ez helyes egy valóban hibás kérésre, és nem
próbáltam `error_page`-dzsel elfedni.

### Egy hajszál híján elkerült hiba, ami a naplóba való

A CSP-konfig a fő Playwright-konfigot terjeszti ki. Amikor a fő konfigba
betettem a `testIgnore: 'csp.spec.ts'`-t (hogy a dev szerveres suite **ne**
futtassa, mert ott értelmetlen), a CSP-konfig **megörökölte** — és ezzel
kihagyta azt az egyetlen tesztet, amiért létezik. A kimenet: `Total: 0 tests`,
**exit 0**. Ugyanaz az osztály, mint a „zöld suite, ami semmit nem mér".
Javítva (`testIgnore: []`), és mindkét irányban ellenőrizve.

### Érintett fájlok

Új: `ops/nginx/security-headers.conf`, `csp-report-only.conf`, `csp-enforce.conf`,
`test-vhost.conf`, `verify-headers.sh`; `client/playwright.csp.config.ts`,
`client/e2e/csp.spec.ts`; `docs/NGINX_HEADERS_RUNBOOK_HU.md`.
Módosítva: `client/playwright.config.ts` (testIgnore), `client/package.json`
(`test:csp`), `.github/workflows/ci.yml` (CSP-kapu).

**Szerverkód nem változott.** Az éles vhost a szerveren él, a repóban **nincs**
kitalált production konfiguráció.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + 154 kliens unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **119** böngészőteszt (a CSP-teszt már nem itt fut) |
| CSP-kapu | exit 0 — 3 eset a **buildelt** kliensen; a deployolt bundle-on külön is lemérve |
| izolált nginx | `nginx -t` ok; 6 fejléc mind az 5 mért válaszon; negatív kontroll bukik |
| shellcheck 0.11.0 (a CI-vel azonos, pinelt) | exit 0 |
| élő nginx | `nginx -t` ok, `reload` ok, `systemctl is-active` = active |

**Valódi laborfutam:** NEM FUTOTT. **Éles deploy: MEGTÖRTÉNT** — csak nginx
fejlécek, a kliens bundle **nem** lett újratelepítve.

### Nyitott tételek

1. **A CSP report-only marad.** Az enforce-ra váltás egyetlen fájlcsere
   (`csp-enforce.conf` ugyanarra a snippet-névre), a bizonyíték megvan
   mindkét bundle-ra. Szándékosan nem most: a report-only értelme az, hogy
   valós forgalmat is lásson, és egy este egyetlen mérésre élesíteni pont az,
   amiből csendes kiesés lesz.
2. **`/api/` most két HSTS fejlécet küld** (a helmet 1 éve és az nginx 2 éve).
   Az RFC szerint az első számít, tehát az API-válaszok 1 évre állítják a
   hostot — nem romlott semmi a maihoz képest, de a szándékolt 2 év nem
   érvényesül következetesen. A tiszta megoldás egy tulajdonos: mivel a TLS-t
   az nginx zárja, a helmet HSTS-ét kellene kivenni. Szerverkód-változás, nem
   ennek a napnak a köre.
3. **A deployolt bundle régebbi, mint a `main`.** Ma szándékosan **nem**
   telepítettem klienst — egy fejléces nap nem szállít UI-t mellékhatásként.
4. **Nincs CSP report-collector** és **nincs HSTS preload**; mindkettő indoklása
   a runbookban.

---

## 2. checkpoint – F04–F14 lefedettség (14. nap)

| Pont | Állapot | Bizonyíték | Környezeti / telepítési korlát |
|---|---|---|---|
| F04 | Lezárva | E2E lapozás + HTTP-integrációs teszt | — |
| F05 | Lezárva (J3) | 8 E2E eset, tickenkénti feloldás | — |
| F06 | Lezárva (J3) | domén-unit + HTTP: a jelenlegi registry létszáma | — |
| F07 | **Lezárva** | unit + E2E; **élő nginx: 400** a hibás escape-ekre | — |
| F08 | Lezárva | router-unit + E2E | A szerveroldali SPA fallback szándékosan változatlan: ismeretlen útvonal 200-at ad |
| F09 | Lezárva | descriptor/preset/capability, HTTP-integráció | Valódi laborfutamot nem bizonyít |
| F10 | **Lezárva** | izolált nginx 5 válaszon + böngészős CSP mindkét bundle-on + **élő fejlécek lemérve** | A CSP report-only; az enforce külön lépés |
| F11 | Lezárva | 22 E2E eset, 4 oldal vezérlői | Vezérlő nélküli oldalak szándékosan paraméter nélkül |
| F12 | Lezárva | 15 E2E eset: címek, fókusz, skip link, zoom, reduced motion | Számított mérés, nem képernyőolvasós tanúsítás |
| F13 | **Részben** | `npm audit` 3 → 2, mérve mindkét lockfile-lal | Elfogadott maradék: express saját `qs` pinje; express 5 kell hozzá |
| F14 | Lezárva | unit gombpár + élő számított kontraszt mindkét témában | — |

**Nyitott környezeti/telepítési korlátok a checkpointban:**

- A CSP enforce-ra váltása és annak élő megfigyelése (1. pont fent).
- A `/api/` duplikált HSTS-e (2. pont fent).
- Az F13 elfogadott maradéka, és hogy az indoklását (`query parser` = `simple`,
  nincs `urlencoded`) **semmi nem védi** — 20. nap.
- A staking nézetváltóján nincs `aria-pressed` — 20. nap.
- A deployolt kliens bundle régebbi a `main`-nél.

```text
Commit(ok), végső SHA: 5262482
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: MEGTÖRTÉNT (csak nginx fejlécek, tulajdonosi engedéllyel)
```

## 15. nap – Egyszerű szimulátorűrlapok

```text
Nap / dátum / implementáló: 15 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day15-scenario-forms @ 4e5dc81 (main, a 14. nap után)
Napi feladat és előfeltételei: a négy target-választó nélküli scenario űrlapja.
  Előfeltétel: 04. nap (descriptor, presetek) — megvan.
Auditpontok: nincs önálló F-pont; a szimulátor-termékfolyamat 2. lépése
```

**Kiinduló állapot.** A panel egyetlen paraméterszerkesztője egy JSON-textarea
volt. Az operátor egy mező nevét, mértékegységét és határait **abban a
pillanatban** tudta meg, amikor a szerver visszautasította a kérést — a lehető
legrosszabb pillanatban és a lehető leghaszontalanabb helyen.

**Ami változott.** Az `mn-stop`, `staker-stop`, `quorum-member-outage` és
`dsl-fault` valódi mezőket kap: egész számok a séma saját min/max-ával és
mértékegységgel a képernyőn, enumok pontosan azokkal az értékekkel, amiket a
séma elfogad. A metaadat a **scenario-descriptoron** utazik, tehát a kliens
egyetlen limitet sem tart másolatban, és semmit nem importál a szerver
registryből — ahogy a terv kéri.

### Miért nem tud elcsúszni

Egy validátor mellé kézzel vezetett határtábla elcsúszik — a projekt már
látta ezt: a panel saját paraméteralapértékeinek a `dsl-fault`-ra egyáltalán
nem volt bejegyzése. Ezért a `scenarioFields.test.ts` **soha nem olvassa vissza
a táblát önmagának**: valódi kéréseket épít, és a `parseScenarioRequest`-en —
ugyanazon a függvényen, amit a route hív — tolja át **minden deklarált
határon**: min elfogadva, max elfogadva, egyel túl mindkettőn elutasítva, tört
elutasítva, minden felsorolt enum érték elfogadva, egy ismeretlen elutasítva,
és a `required` egyezik azzal, amit a séma hiányozni enged.

**Negatív kontroll:** a `staker-stop` `max`-át egyel a séma fölé toltam — azonnal
bukott (`max rejected`).

**A saját tesztsegédem elsőre rossz volt.** Az első változat a feltételes mezők
függőségét csak **egy irányban** rendezte: a `param` vizsgálatához adott
megfelelő `faultKind`-et, de a `faultKind` vizsgálatához nem adta hozzá a
késleltetéses fajták által **megkövetelt** `param`-ot. A suite az első
futásra azt jelentette, hogy a tábla hibás — pedig a segéd volt az. Most
szimmetrikus.

### Egy objektum, két arc

A paraméterek **egyetlen kanonikus objektum**, és az űrlap meg a JSON is abból
renderelődik. A JSON egy „Advanced" nyitható panel mögé került. Egy
**olvashatatlan** szerkesztés ott **szó szerint megmarad**, magyarázatot kap, és a
Prepare visszautasítja — nem ugrik vissza csendben az utolsó olvasható
objektumra, és nem megy ki.

### A késleltetés mezője

A `dsl-fault` `param`-ja az a szabály, amit egy űrlap **mindkét irányban**
elronthat: a késleltetéses fajták **megkövetelik**, a többi **elutasítja**, tehát
egy mindig látható mező olyan kérést küld, amit a szerver olyan okból utasít
vissza, amit senki nem lát. Most csak a késleltetéses fajtáknál jelenik meg, a
séma minimumával kitöltve érkezik, és a fajta elváltásakor **kikerül** az
objektumból — nem nullázódik. Ugyanezért egy **üres számmező hiányzik, nem nulla**.

### Seed

Draftnál újragenerálható, máshol nem. A kiválasztott futam azt a seedet mutatja,
amivel **ténylegesen** létrejött — a saját metaadatából, nem a mellette lévő
draftból. A 6–7. napon szétválasztott draft és futam így szét is marad.

### A harness egy valódi korlátja

A stubfüggvények mostantól a **metódust** is megkapják az URL mellé. A
`/admin/simulations/runs` GET-re a futamlista, POST-ra a létrehozás — egy stub,
ami csak az URL-t látta, az egyiket biztosan rosszul válaszolta meg.

### Érintett fájlok

Szerver: `scenarioTypes.ts` (`ScenarioField`), `scenarioRegistry.ts`
(`SCENARIO_FIELDS`, a katalógus kiszolgálja), új `scenarioFields.test.ts`
(6 eset), `simulationScenarios.integration.test.ts` (+1 HTTP-eset).
Kliens: `admin-api.ts` (`ScenarioFieldSpec`), `dd-simulation-control.ts`,
`e2e/harness.ts` (metódus), `e2e/fixtures/admin.ts`, új
`e2e/scenario-forms.spec.ts` (10 eset); a meglévő `simulation-control`,
`run-status` és `run-selection` specek a textarea helyett a mezőre célozva.

**Szerződésváltozás / kompatibilitás:** **additív** — a descriptor új,
opcionális `parameterFields` mezőt kap. Egy régebbi szerver nem küldi, és a
panel ilyenkor a JSON-nézetre esik vissza, nem talál ki mezőket. A szerver
validációja **nem változott**.

### Negatív kontrollok — négy, mind a saját tesztjén bukott

| Kivett őrszem | Ami elpirult |
|---|---|
| a feltételes mező rendezése fajtaváltáskor | a két késleltetés-teszt |
| az olvashatatlan JSON megtartása | „unreadable JSON is kept, explained, and cannot prepare a run" |
| a deklarált határ a séma szerint | `scenarioFields.test.ts` — „max rejected" |
| az üres mező hiányként | „an empty number box is absent, never zero" |

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **850** szerver (844 → 850) + 154 kliens unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **129** böngészőteszt (119 → 129), egy workerrel |
| K3 | exit 0 — 14 fájl, **91** teszt (90 → 91): a katalógus HTTP-n tényleg kiszolgálja a mezőket, és a mező nélküli scenariónál a kulcs **hiányzik**, nem üres lista |
| CSP-kapu | exit 0 — az új űrlap nem hozott új CSP-sértést |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** a **16. nap** (a maradék öt scenario:
target-választó, hatáselőnézet) elkezdhető. A négy mai scenario `targetIds`
mezője egyelőre vesszővel elválasztott szöveg — a valódi registry-választó a
16. nap dolga, és a mai mező kifejezetten opcionálisnak van jelölve.

```text
Commit(ok), végső SHA: d7469ff
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 16. nap – Összetett űrlapok és hatáselőnézet

```text
Nap / dátum / implementáló: 16 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day16-complex-forms @ bb70418 (main, a 15. nap után)
Napi feladat és előfeltételei: az öt target-választót igénylő scenario.
  Előfeltétel: 15. nap (field-metaadat, kanonikus objektum) — megvan.
Auditpontok: nincs önálló F-pont; a szimulátor-termékfolyamat 2–3. lépése
```

**Kiinduló állapot.** A `host-outage`, `restart-flapping`, `network-degradation`,
`node-isolation` és `clear-recover` mind célpontot nevez meg, és ehhez egyetlen
eszköz volt: egy szövegmező. Egy registryben nem létező id, egy staker egy
masternode-helyen, egy karbantartásban lévő célpont — mindegyik a szervertől
derült ki, a Prepare **után**.

### Egy választó, ami megmondja, miért nem

Minden regisztrált célpont listázva van, **azok is**, amelyek nem választhatók,
mindegyik az okkal: rossz hálózaton, letiltva, karbantartásban, rossz szerep,
hiányzó képesség. Egy célpont, ami csendben nincs ott, registry-hibának
olvasódik; egy, ami azt írja, „in maintenance", megmondja, mit kell tenni.
**Csak a megjelenítési név és a target id látszik, a host-hivatkozás soha.**

Az okok a szerver **két** helyéről jönnek, és mindkettőt ellenőriztem a forrásban:
a resolver jelöltszűrője (hálózat, enabled, nem maintenance — `targetResolver.ts:156`,
és a `draftPreparation.ts` pontosan ezt adja tovább a végrehajtónak, tehát a
`clear-recover`-re is vonatkozik), és a dry-run végrehajtó scenariónkénti
jogosultsága (szerep + képesség).

### A szerep a registryből jön, soha nem a névből

Ezen a flottán az egyik hoston a 11-es példány masternode, minden más hoston
staker — és ez a rövidítés egyszer majdnem levett egy masternode-ot a hálózatról.
A fixtúra-registry ezért egy stakert `lab-mn-st`-nek nevez: egy nevet olvasó
választó azonnal elbukna rajta.

### Bizonyítva azon, ami dönt

A field-metaadat mostantól minden célpontmezőnél hordozza a követelményt
(szerep vagy az azt tartó paraméter neve, plusz képesség), és a
`scenarioFields.test.ts` a jelölteket **magán a `generateDryRunPlan`-en** tolja
át: a megfelelő célpont feloldódik, minden rossz szerep (a seed is) elutasítva,
a hiányzó képesség elutasítva. Ugyanez a teszt fedi mostantól a **tört** mezőket
(a csomagvesztés valós szám — egy egész lépésű űrlap olyan értéket utasítana el,
amit a szerver elfogad) és a `restart-flapping` staker-plafonját (10 masternode,
de csak 5 staker).

**Öt szerveroldali negatív kontroll, mind a saját állításán bukott:**
`node-isolation` rossz képességgel, `staker-stop` rossz szereppel, a staker-plafon
egyel elcsúsztatva, a csomagvesztés egésznek deklarálva, és a `clear-recover`
live-jelzője hamisan igaznak.

### Egy valódi hiba, amit a tesztek találtak meg

A célpontot igénylő scenariók sablonja egy **helyőrző** id-t hordoz, mert a
sablonnak meg kell felelnie a sémájának. A választóval ez csapdává vált: egy
valódi célpont bepipálása a helyőrző **mellé adta hozzá**, és a kérés egy nem
létező célpontot nevezett meg. A célpontmezők mostantól **üresen indulnak** —
a mező *fajtája* dönt, nem a helyőrző szöveg illesztése —, és a Prepare nevén
nevezi a kötelező, de ki nem választott célpontot, ahelyett hogy semmit küldene.

Két korábbi teszt azt állította, hogy a helyőrző bekerül a draftba. **Javítottam,
nem töröltem** őket, az indoklással mellettük; a régebbi szerver útja, ahol a
helyőrző még ott van, saját tesztet tartott meg.

### A `clear-recover` a saját policyja szerint

Nincs időtartam és nincs darabszám, mert nem fault. És **nincs live-ként
felkínálva**: minden akciója egy `fault-clear`, amit a live végrehajtó szándékosan
kihagy (a takarítás a recovery dolga) — egy live futása tehát **semmit nem
alkalmazna**, és lefutottnak mondaná magát. A katalógus ezt `liveAppliesFaults`
jelzővel mondja ki, a `labFaultsForPlan`-en bizonyítva, kontrollként egy valódi
fault-scenarióval.

### Az előnézet

Masternode- és staker-darabszám, quorumméret és túlélők, és **„unknown", soha
nem 0**, ahol a szerver nem tudta megmérni — egy nulla margin **lelet**, egy
nem mért nem az. Ha a draft eltér a képernyőn lévő futamtól, az előnézet
kimondja, hogy az a **mentett terv**, és új Prepare-t kér; **a futam vezérlése
érintetlen**, ahogy a terv előírja.

### Egy nap óta nyitott flake gyökérokának megtalálása — külön commitban

A K3-hoz a teljes integrációs suite-nak zöldnek kellett lennie, és ma nem volt
az: **négy futás egymás után bukott** (10, 2, 1 és 1 hibával), mindig
ugyanaz az `experimentOutcome` `beforeAll` hook lépte túl az időkorlátot. Ez a
6. nap óta nyitott flake.

**Két hipotézist teszteltem, és az elsőt megcáfoltam.**

1. *A 333 szivárgott teszt-adatbázis lassítja a mongodot.* Mind a 333-at
   letöröltem (szigorúan a `deftrack_itest_` előtaggal, kizárólag a 27018-as
   eldobható példányon — a `deftrack_devnet` a 27017-en van), és újrafuttattam:
   **továbbra is bukott.** Megcáfolva.
2. *A 14 fájl párhuzamosan dolgozik egyetlen mongod-on.* Egyenként minden fájl
   átment; szekvenciálisan a teljes suite **háromból háromszor** zöld, kb. 30 s
   alatt. Megerősítve.

A javítás egy flag: `--no-file-parallelism` az npm scriptben, az indoklással a
`mongo.ts` fejkommentjében. **Nem emelt időkorlát** — az elrejtené a versengést,
nem megszüntetné.

**A szivárgás külön hiba, és nyitva marad.** A 14 fájlból 11 **minden futáson**
— a sikereseken is — otthagyja az adatbázisát, pedig mindegyik hívja a
`dropTestMongo`-t; csak a `fairness`, `mndiff` és `mnpoller` takarít. Hibát nem
okoz (a szekvenciális futás szivárgás mellett is zöld), de naponta gyűlik. **20. nap.**

### Érintett fájlok

Szerver: `scenarioTypes.ts` (`ScenarioTargetRequirement`, `maxWhen`,
`liveAppliesFaults`, új mezőfajták), `scenarioRegistry.ts` (mind a kilenc scenario),
`scenarioFields.test.ts` (11 eset), `simulationScenarios.integration.test.ts`,
`integration/mongo.ts` és `package.json` (a flake).
Kliens: új `lib/targetEligibility.ts` (+ 9 unit eset), `admin-api.ts`,
`dd-simulation-control.ts`, `dd-admin-shell.ts`, új
`e2e/complex-scenarios.spec.ts` (15 eset), `e2e/fixtures/admin.ts`, és a javított
`simulation-control` / `scenario-forms` specek.

**Szerződésváltozás / kompatibilitás:** additív — a descriptor `target`, `maxWhen`
és `liveAppliesFaults` mezőket kap, a target DTO-n a szerver által eddig is küldött
`capabilities` mostantól olvasva van. Egy régebbi szerver ezeket nem küldi, és a
panel ilyenkor nem talál ki semmit. Szerveroldali validáció **nem változott**.

### Negatív kontrollok — tizenegy, mind a saját tesztjén bukott

Szerver (5): lásd fent. Kliens (6): a sablon célpontja bent marad; a jogosultság
figyelmen kívül hagyja a szerepet; a staker-plafon figyelmen kívül; a megváltozott
draft sosem elavult; a `clear-recover` live-ként felkínálva; a hiányzó kötelező
célpont mégis kimegy.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **855** szerver (850 → 855) + **163** kliens (154 → 163) unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **145** böngészőteszt (129 → 145), egy workerrel |
| K3 | exit 0 — 14 fájl, 91 teszt, **szekvenciálisan**, háromból háromszor |
| CSP-kapu | exit 0 |

**Egy nem megerősített flake a böngésző-suite-ban:** a teljes suite négy workeres
futásán egyszer elbukott a 12. napi skip-link teszt, mert az Overview címe nem
rajzolódott ki a keretidőn belül. Egyenként 3×, ismételve 5× négy workeren, és a
teljes suite egy workerrel (ahogy a CI futtatja) zöld. Feljegyzem, nem retryval
tüntetem el.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:**

- a **17. nap** (publikus szimulációs eredmények) elkezdhető;
- az integrációs adatbázis-szivárgás (11/14 fájl) — 20. nap;
- a terv „profilt" is kér az előnézetbe, de a mentett terv DTO-ja **nem hordoz
  profilnevet**; nem találtam ki, a meglévő quorumméret és túlélőszám van kint.

```text
Commit(ok), végső SHA: 0d08439 (integrációs flake), e4c16d5 (16. nap)
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 17. nap – Publikus szimulációs eredmények

```text
Nap / dátum / implementáló: 17 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day17-public-simulations @ 61a78cc (main, a 16. nap után)
Napi feladat és előfeltételei: /simulations lista és /simulations/:runKey részlet
  a már létező publikus API-kra, JSON-exporttal.
  Előfeltétel: a három publikus végpont — megvan, nem kellett hozzá új szerverút.
Auditpontok: nincs önálló F-pont; a szimulátor-termékfolyamat publikus vége
```

**Kiinduló állapot.** A szerver három publikus végpontot kínált
(`/api/v1/simulations`, `/:runKey`, `/:runKey/report`), allowlist DTO-kkal és
unit tesztekkel. A kliens egyiket sem használta, és — ez lett a nap fontosabb
lelete — **a route és a DTO együtt, HTTP-n, valódi MongoDB-vel soha nem futott.**

### A lap dolga, hogy ne lehessen félreolvasni

Egy eredményt megmutatni könnyű; a nehéz az, hogy ne olvasódjon annak, ami nem.
Az olvasatok a döntés sorrendjében:

- ami még fut, az **folyamatban**, soha nem eredmény;
- a megszakított, a sikertelen és az elutasított futam **se nem eredmény, se nem
  siker**;
- a befejezett, de riport nélküli futam **mérésre vár** — és szavakkal kimondja,
  hogy ez nem sikeres futam;
- egy **nem olvasható** riport külön van a **nem létező** riporttól;
- az érvénytelen mérés **nem értékelhető**, akkor is, ha egyezést állít;
- a száraz futás **száraz futás**, akármi lett az eredménye: semmi nem történt
  egy hálózattal, tehát egy zöld egyezés ugyanolyan hamisan nyugtatna meg, mint
  amennyire egy piros eltérés hamisan riasztana;
- **zöld csak egy élő futam érvényes, sikeres mérése.**

Az utolsó sor nem egy eset, hanem tulajdonság: egy unit teszt végigjárja
az összes státusz × élő/száraz × riportállapot kombinációt, és elbukik, ha bármi
más valaha a „good" tónust kapja.

### Két 404, amit a riport-végpont egyedül nem tud szétválasztani

A `/:runKey/report` 404-et ad arra is, ha a futam nem létezik, és arra is, ha
létezik, csak még nincs mérése — a szerver ezt nem tudja másképp mondani, és ezt
az integrációs teszt most rögzíti is. A lap ezért **előbb a futamot kéri**: ha az
404, „nincs ilyen futam"; ha a futam megvan és a riport 404, „mérésre vár"; ha a
riport bármi más hibát ad, a futam látszik tovább, és a riport „nem olvasható".
A formailag hibás kulcsot a lap a kérés előtt utasítja el.

### Az export

A két publikus válasz, változatlanul, egy borítékban: `schemaVersion`, lekérési
idő, és a két URL, ahonnan jött. Semmi más — admin history és artifact soha,
mert az export kizárólag abból épül, amit a publikus végpontok visszaadtak.
Riport nélkül `report: null`, nem kitalált riport. `data:` link, ezért a CSP-kapu
mostantól ezt a lapot és az exportját is lefuttatja az enforce házirend alatt.

A Core-adapter hivatkozása **nem jelenik meg**: a publikus DTO nem hordozza, és
egy mért eredmény mellé tett modellanyag előrejelzésnek olvasódna.

### Három valódi szivárgás a publikus route-okon — külön commitban

Egy új integrációs teszt a futam- és riportdokumentumokat **nyersen**, a
driveren át, a Mongoose-validációt megkerülve szúrja be, és egy sentinel
sztringet ültet **minden olyan mélységbe**, ahol publikus mező privát mellett
ül: a futam tetejére, az `actorId`-ba, a célpont `hostRef`/`unitRef`/`operatorId`
mezőibe, a `lastTransition`-be, a `state`-be, a preflight privát részletébe,
a `dataQuality`-be, a riport `anchor`-jába és a riportrekord tetejére. Egyetlen
választörzs sem tartalmazhatja.

**Három úton kijött:**

| Út | Miért |
|---|---|
| `state.lastTransition` | a futam-DTO egészben továbbadta |
| `dataQuality` | a projekció egészben kiválasztotta, a DTO egészben továbbadta |
| `anchor` | a riport-DTO spreadelte, és a fingerprintelt riporton **kívül** ül, így semmi nem ellenőrizte |

Mindhárom mostantól **név szerint** másolódik. Ami eddig publikus volt, az is
maradt; új mező nem tud velük együtt kiutazni. Minden más beültetett érték már
eddig is kiesett, és a fingerprintelt riporton **belülre** ültetett mező a riportot
**zárva buktatja** (≥500), nem publikálja.

**Nem kihasznált, hanem lappangó hiba:** ezeket az al-objektumokat ma a szerver
rögzített alakkal állítja elő. De egy publikus szerződés, amely közzéteszi, amit
egy tárolt objektum tartalmaz, a következő, oda felvett mezőt is közzéteszi —
anélkül, hogy bárki úgy döntött volna. Pontosan ezt kell egy allowlistnek
megakadályoznia.

**Két kisebb lelet ugyanebből a tesztből.** A riport-DTO egysoros állítása
(„future unknown fields cannot escape") a riporton belüli aggregát al-objektumokra
nem igaz — azok még spreadelve vannak; a komment most pontosan azt mondja, mi
garantált és mi maradék. És a javítás **első változata** — a `missingHeights`
név szerinti másolása — egy olyan régi dokumentumon, amely e mező előtt íródott,
az **egész listát 500-ra** vitte. A main ezt nem csinálta (ott a mező egyszerűen
kimaradt a válaszból); a hibát én vezettem be, és a teszt fogta meg a commit
előtt. Most `null` — „nincs rögzítve", nem üres tömb, ami azt állítaná, hogy
semmi nem hiányzott —, saját tesztesettel.

### Érintett fájlok

Szerver: `simulator/simulationPublicDto.ts`, `simulator/simulationMeasurementPublicDto.ts`,
új `integration/publicSimulations.integration.test.ts` (7 eset).
Kliens: új `lib/simulations.ts` (+ 13 unit eset), `lib/api.ts`, `lib/router.ts`
(a látható `/simulations` és a rejtett részlet-minta), `components/dd-shell.ts`,
új `components/dd-page-simulations.ts`, új `e2e/fixtures/simulations.ts`, új
`e2e/public-simulations.spec.ts` (17 eset), `e2e/csp.spec.ts` (+1 eset).

**Szerződésváltozás / kompatibilitás:** a publikus válaszok mezőkészlete a
fixtúrákban szereplő, rendesen tárolt dokumentumokra **változatlan**. Eltérés
kettő: egy tárolt al-objektumba ültetett ismeretlen mező többé nem jelenik meg,
és egy `missingHeights` nélküli régi `dataQuality`-ben a mező `null`, ahol eddig
hiányzott a válaszból.
Szerveroldali validáció nem változott.

### Negatív kontrollok

Kliens (4), egyszerre egy őr eltávolítva:

| Kontroll | Eredmény |
|---|---|
| a riport nélküli befejezett futam egyezésnek olvasódik | unit 2/13 bukott, E2E 1/17 bukott |
| a száraz futás nincs száraz futásnak jelölve | unit 2/13 bukott, E2E 1/17 bukott |
| a riport 404 a futam nemlétezésének olvasódik | E2E 1/17 bukott (a unit zöld: ez a lap őre, nem a könyvtáré) |
| a nem értékelhető mérés egyezésnek olvasódhat | **unit** 1/13 bukott; az E2E 17/17 zöld maradt, mert a tartalék ág ezen a fixtúrán is biztonságosan „nem értékelhető"-t ad — ezt a unit teszt fedi, nem a böngésző |

A kontrollokat a commit után, a véglegesített fán újrafuttattam; a számok ebből
a futásból vannak, és utána minden őr visszaállt.

Szerver: a két DTO visszaállítva a javítás előtti (`61a78cc`) állapotra, csak a
sentinel-fájl: **4/7 bukott** — a lista és a futam kiadta a `lastTransition` és a
`dataQuality` sentineljét, a riport az `anchor`-ét, a régi futamnál a
`missingHeights` hiányzott. A fingerprinten belüli manipuláció, a két 404 és a
400 a régi kóddal is zöld volt — azok a már meglévő viselkedést rögzítik.
Visszaállítva **7/7 zöld**.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **855** szerver (változatlan) + **176** kliens (163 → 176) unit, typecheck, build, `git diff --check` tiszta; a véglegesített fán |
| K2 | exit 0 — **162** böngészőteszt (145 → 162), egy workerrel |
| K3 | exit 0 — **15** fájl (14 → 15), **98** teszt (91 → 98), szekvenciálisan; a 8 kihagyott a fájlok „needs a database" párdarabja, ami épp adatbázis mellett hagyódik ki |
| CSP-kapu | exit 0 — **4** eset (3 → 4), a szimulációs lap és exportja az enforce házirend alatt |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:**

- a **18. nap** (navigáció és mobil) elkezdhető;
- a riport-DTO-ban a riporton **belüli** aggregát al-objektumok még spreadelve
  vannak: tárolt adatba ültetett mező ellen a fingerprint véd, a generátorba
  jövőben felvett mező ellen nem — 20. nap, elfogadni vagy név szerint másolni;
- a VPS kliensbundle-je továbbra is a 11. nap előtti, tehát ez a lap élesen még
  nem látszik — átadás előtt deploy kell (20. nap).

```text
Commit(ok), végső SHA: 2a2e791 (publikus DTO-szivárgás), 6cc471f (17. nap)
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 18. nap – Navigáció és mobil

```text
Nap / dátum / implementáló: 18 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day18-navigation-mobile @ 6d9c603 (main, a 17. nap után)
Napi feladat és előfeltételei: csoportos navigáció, mobilnézet, vízszintes görgetés
  megszüntetése, táblázatok jelzett görgetése, főoldal felső része.
  Előfeltétel: nincs — a 12. napi fókusz- és skip link-viselkedés megvan, megtartandó.
Auditpontok: nincs önálló F-pont; az audit „Navigáció" és „Mobil" javaslata
```

**Kiinduló állapot — mérve, nem becsülve.** Új böngészős mérés minden publikus
útvonalon (a 14 menüpont, az öt részletoldal és egy nem létező oldal), a
dokumentum saját `scrollWidth`/`clientWidth` arányán:

| Állapot | 360 px | 390 px | 768 px | Ok |
|---|---|---|---|---|
| hiba (hosszú azonosítót idéző üzenet) | **+587 px** minden oldalon | +557 px | +180 px | a közös hibasáv nem tört |
| betöltés | **+176 px** minden oldalon | +146 px | — | a fejléc két fix szélességű skeletonja (380 és 520 px) |
| bármely (a számlálósor) | +152 px | +122 px | — | a számlálósor `flex: 0 0 auto`, nem tudott tördelni |

A navigáció 14 egyenrangú fül volt: asztalon két sorba tört, 1100 px alatt
oldalra görgetett. Egy kör-, blokk- vagy tranzakciórészletnél **semmi** nem
világított a menüben (a `/round` nem egyezik a `/rounds`-szal), egy kísérlet
részleténél csak véletlenül — mert ugyanaz a path.

### A csoportos menü

A terv rögzített csoportjai, változatlan pathokkal: Overview; Network (DKG Rounds,
PoSe Watch, Masternodes, ChainLocks, Sentinel Layer, Staking, Vantage Points,
Operators, Fairness); Blockchain (Blocks, Transactions); Experiments (Experiments,
Simulations). A csoportosítás a `ROUTES`-ból épül, nem egy második kézzel írt
listából; a unit teszt a terv listáját **betű szerint** írja ki, mert egy
`ROUTES`-ból visszaolvasott elvárás bármilyen csoportosítással egyezne.

- **Széles (≥ 960 px):** a csoportok egy sorban, alattuk az aktuális csoport
  oldalai. A csoport `aria-current="true"`, az oldal `aria-current="page"` — a
  kettő mást mond, és mindkettő látszik. A csoportlink a csoport első oldalára visz.
- **Keskeny:** egy Menu gomb, ami kiírja, hol van az olvasó („Network › PoSe
  Watch"), alatta kinyitható csoportok; nyitáskor az olvasó saját csoportja nyitva.
  Linkre, Vissza gombra és Escape-re bezárul; az Escape a fókuszt a gombra adja.
  Az épp nyitott oldal linkje nem navigáció (a router figyelmen kívül hagyja),
  ezért ott a menü külön zárul, és a fókusz szintén a gombra kerül.
- **Részletoldal:** a route-ok `section` metaadatot kapnak, így egy blokk a
  Blockchain › Blocks alatt világít, `aria-current="true"`-val — nem `page`-dzsel,
  mert a Blocks link nem a blokkra visz.
- A két forma közül a rejtett `display: none`, tehát az akadálymentességi fából és
  a tab-sorrendből is kiesik; egy link sosem érhető el kétszer.
- A márkanév link lett a főoldalra.

### A dokumentum nem görget oldalra

Három javítás a fenti három okra: a hibasáv és a megjegyzés `overflow-wrap:
anywhere`; a számlálósor zsugorodhat; a telemetriasor `min-width: 0`. A mérés
ezután **két további helyet** talált hosszú azonosítónál, betöltött állapotban:
a főoldal futó-kísérlet sávját (a futamkulcs-chip miatt **1440 px-en is +172 px**)
és a kísérlet részletoldal kulcs–érték listáját (+996 px 360-on). Mindkettő
tördelhető lett; a kulcs–érték lista telefonon egymás alá rendeződik, és ez is
teszt mögött van.

**A mérés négy állapotban fut** — hosszú azonosítókkal betöltve, üresen, hosszú
tokent idéző hibával, és betöltés közben —, négy szélességen, plusz 200%-os
nagyítás (720 CSS px, `deviceScaleFactor` 2 — emuláció: a Playwright valódi
böngészőzoomot nem tud nyomni, de ez ugyanaz az elrendezés). A fixtúra
szándékosan túlzó: 144 karakteres, töréspont nélküli token, teljes 64 karakteres
hashek, hosszú operátor- és hostcímkék; a cím a dokumentációs tartományból
(RFC 5737) való.

A mérő a saját negatív kontrollját is futtatja: egy oldal shadow rootjába ültetett
900 px-es elemet meg kell találnia és meg kell neveznie. Kétszer is kiderült, hogy
a mérés azt mérte, amit mondott, csak az én tesztem nem: (1) a 200%-os „hiba" kör
a stubok összefésülése miatt betöltött oldalt mért — szétválasztottam, és a mérés
útvonalanként ellenőrzi, hogy a hibaállapot tényleg hibát rajzolt ki; (2) az üres
fixtúrám egy olyan `signers: undefined`-ot adott, amit a szerver sosem küld —
javítva.

### Táblázatok: saját dobozukban görgetnek, és ezt ki is mondják

A táblázat **valódi táblázat marad** (a teszt a számított `display: table` /
`table-cell` értéket és az oszlop–cella darabszámot nézi 360 px-en). Egy közös Lit
controller méri minden `.twrap`-on, hogy van-e oldalra rejtett tartalom, és ha
van: felirat („Scroll sideways for more columns ↔"), halványuló szél azon az
oldalon, ahol még van mit látni, `tabindex="0"` és név — hogy billentyűzettel
elérhető és nyilakkal görgethető legyen. Ha a táblázat kifér, mindez lekerül: egy
mindig bekapcsolt jelzés ugyanolyan haszontalan, mint egy soha be nem kapcsoló, és
egy nem görgető dobozon a tabstop semmit nem csinál. Nem nézethatárról dönt, hanem
mér — egy teszt minden oldal minden táblázatán 360 és 1440 px-en ellenőrzi, hogy a
jelölés egyezik a tényleges túlfolyással, és hogy mindkét eset előfordult.

Az admin felület táblázatai **nem** kapják meg: a terv szerint az `/admin` külön
felület, és ez a nap a publikus shell.

### A főoldal felső része

Adatfrissesség, profil, hálózati állapot és futó kísérlet eddig is fent volt — de
a kísérletsor **eltűnt**, ha nem futott semmi, és akkor is, ha a lista nem volt
olvasható. A két eset most két kimondott mondat („No experiment is running." /
„Whether an experiment is running could not be read: …"), a statisztika-csempék
előtt. **Hosszú módszertani blokk a főoldalon nincs** (a státuszszövegek egy
mondatosak), így nincs mit összecsukni; nem találtam ki egyet.

### Hat meglévő teszt új útvonalon — nem gyengítve

Négy teszt az overview-ról közvetlenül egy oldal linkjére kattintott, egy fókuszt
tett egy ilyen linkre, egy pedig odáig tabolt. Az új menüben ezek a csoport alatt
vannak. Mind a hat a csoportlinket használja (ami ugyanarra az oldalra visz), vagy
a csoport után az oldalt;
**az állításaik változatlanok** (fókusz a h1-en, Vissza/Előre, a poll nem veszi
el a fókuszt, a Simulations elérhető a menüből).

### Negatív kontrollok — tizenöt; három elsőre nem bukott, és az volt a lelet

| Kontroll | Eredmény |
|---|---|
| A — a számlálósor nem zsugorodhat | a hibaállapot-mérés bukott |
| B — a hibasáv nem töri a hosszú tokent | a hibaállapot-mérés bukott |
| C — a skeleton `max-width` kivéve | **nem bukott** → a szabály felesleges volt, kivettem |
| C2 — a telemetriasor `min-width: 0` kivéve | a betöltési mérés bukott — ez a valódi őr |
| D — egy görgető táblázat sosincs jelölve | 4 táblázatteszt bukott |
| E — minden táblázat jelölve, akkor is, ha kifér | 2 bukott (a „kifér" és az egyezés-teszt) |
| F — a kulcs–érték rács `minmax(0, …)` kivéve | **nem bukott** → felesleges volt, visszaállítottam az eredetit |
| F2 — a `dd` `overflow-wrap` kivéve | a betöltött mérés bukott — ez a valódi őr |
| G — a részletoldal nem világít szekciót | E2E 1 és unit 1 bukott |
| H — a menü nyitva marad navigáció után | **nem bukott** → a linkkattintás maga zár; hiányzott a Vissza-eset tesztje, pótoltam, azóta bukik |
| I — a nyitott oldal linkje nyitva hagyja a menüt | bukott |
| J — az Escape nem csinál semmit | bukott |
| K — az olvashatatlan kísérletlista „nincs futó"-nak olvasódik | bukott |
| L — az aktuális csoport nem világít | 3 bukott |
| M — a kulcs–érték lista telefonon is egymás mellett marad | bukott |

A két felesleges szabály kivétele után a C2 kontrollt újrafuttattam: továbbra is bukik.

### Amit találtam, és nem ennek a napnak a dolga — 20. nap

- **A főoldal health-grafikonja `ResizeObserver loop` hibát dob** átméretezéskor: a
  magasságát a szélességéből számolja, és ugyanazt az elemet figyeli, amelyiknek
  a magasságát így állítja. **A mainen is megvan** (mérve: a controllerem nélkül is
  ugyanannyi); működési hibát nem okoz, de konzolhiba.
- 1440 px-en a számlálósor a figyelmeztetés alá tör. Mérve: a régi és az új
  szabállyal is ugyanott áll (49 px), tehát nem ennek a napnak a változása.
- Telefonon a fejléc (figyelmeztetés, számlálók, frissesség, márka, telemetria)
  kb. 370 px a menü előtt. A terv nem kéri a fejléc átrendezését; nem nyúltam hozzá.

### Külön commitban: cím nélküli részletoldalak (F12 hézag)

Ugyanez a mérés mutatta meg, hogy a kör-, blokk- és tranzakciórészlet betöltés
közben — a blokk és a tranzakció hibánál is — **nem renderel h1-et**. A 12. napi
„minden publikus oldalnak egy h1-e van" teszt valójában három útvonalat nézett,
betöltött adattal. Lásd a következő bejegyzés-részt.

A javítás: a cím **egyetlen sablonban** renderelődik minden állapotban (betöltés,
hiba, nem található, kész). Ez nem stílus kérdése: egy saját sablonban lévő
betöltési cím adatérkezéskor lecserélődik, és a navigáció által rá tett fókusz
leesik a body-ra.

Két új teszt az `accessibility.spec.ts`-ben: mind a húsz útvonal, négy állapotban,
pontosan egy h1-gyel; és egy blokkra navigálás visszatartott válasszal — a fókusz
a „Block" címen van, és ugyanott marad, amikor „Block 11,500" lesz belőle. A
régi, háromútvonalas teszt megmaradt.

**Negatív kontrollok:** a javítás előtti kód a h1-mérésen pontosan az öt
állapot–útvonal páron bukik (betöltés: kör, blokk, tranzakció; hiba: blokk,
tranzakció), a fókuszteszten pedig a fókusz a `main`-en találja magát. Egy
saját sablonba tett betöltési cím a számláláson **átmegy**, a fókuszteszten
**bukik** — ezért kell mindkettő.

Ugyanitt: a 12. napi „200%-os zoomnál semmi nem folyik túl" teszt egyetlen oldalt
mért (a betöltött főoldalt, 640 px-en), ahol a számlálósor még kifér — ezért volt
zöld a mai +152/+587 px-es mérés mellett. Nem hibás teszt, csak szűk; a 18. napi
mérés tágítja.

### Érintett fájlok

Kliens: `lib/router.ts` (+ 7 unit eset a `router.test.ts`-ben), új
`lib/tableScroll.ts`, `components/dd-shell.ts`, `styles/shared.ts`,
`components/dd-page-overview.ts`, `components/dd-page-experiments.ts`, és a
controller bekötése a táblázatos publikus oldalakba (`rounds`, `round`, `pose`,
`masternodes`, `chainlocks`, `dsl`, `peers`, `operators`, `fairness`,
`simulations`, `blocks`, `txs`). Tesztek: új `e2e/responsive.spec.ts` (12 eset),
új `e2e/navigation.spec.ts` (14 eset), új `e2e/fixtures/layout.ts`,
`e2e/overview.spec.ts` (+3), és a hat újra irányított teszt az
`accessibility`, `router` és `public-simulations` specben.

**Szerződésváltozás / kompatibilitás:** nincs API-változás, a pathok változatlanok.
Szerver, Core, admin logika érintetlen.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **855** szerver (változatlan) + **183** kliens (176 → 183) unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **193** böngészőteszt (162 → 193), egy workerrel, 4,5 perc (1,3 percről: a mérések ennyit adnak hozzá) |
| K3 | exit 0 — 15 fájl, 98 teszt (változatlan; nem kötelező ezen a napon, lefutott) |
| CSP-kapu | exit 0 — 4 eset |

Mindegyik a végleges `fc4652d` fán. **Egy K2-kísérlet 1-es kóddal zárult**, tesztfuttatás
nélkül: egy megszakított kapufuttatás tesztfolyamata a szülő shell nélkül tovább
futott, és foglalta az 5191-es portot (`http://127.0.0.1:5191 is already used`).
A folyamatfát azonosítás után leállítottam — csak azt; az IDE saját Playwright- és
MCP-folyamatai érintetlenek maradtak —, és a K2 újrafuttatva zöld.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:**

- a **19. nap** (keresés és súgó) elkezdhető;
- 20. napra: a grafikon `ResizeObserver` hibája; a VPS-bundle továbbra is a 11. nap
  előtti, tehát sem a 17., sem a 18. nap nem látszik élesen.

```text
Commit(ok), végső SHA: 171443d (18. nap), fc4652d (cím nélküli részletoldalak)
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 19. nap – Célzott keresés és használati segítség

```text
Nap / dátum / implementáló: 19 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day19-search-help @ ccfd961 (main, a 18. nap után)
Napi feladat és előfeltételei: célzott keresés (magasság, blokkhash, txid, kísérlet- és
  szimuláció-runKey), rövid módszertani oldal, favicon, másolásgomb hibajelzéssel.
  Előfeltétel: a 18. napi fejléc és menü — megvan.
Auditpontok: nincs önálló F-pont; az audit „Keresés", „Fogalmak" és „Arculati részletek" javaslata
```

**Kiinduló állapot.** Keresés nem volt. Súgó nem volt: egy HHI- vagy Gini-számot
csak az érthetett, aki a forrást olvasta. Favicon nem volt (az `index.html` nem
hivatkozott ikonra). Az egyetlen másolásgomb — a főoldal quorum hash-e — a
vágólap hibáját **csendben elnyelte**, azzal az indokkal, hogy a teljes hash a cella
`title`-jében úgyis ott van.

### A keresés: amit egy 64 hex karakteres azonosítóról nem lehet tudni

A fejlécben egy kereső, ami **csak explicit submitra** keres — gépelésre semmi nem
megy ki. Üres vagy csak szóközt tartalmazó submit semmit nem kérdez, és kiírja,
mit fogad a mező. A keresés a `/search?q=` oldalra visz, ami a meglévő publikus
végpontokat kérdezi:

| Bemenet | Megkérdezett végpontok |
|---|---|
| csak számjegy (≤ 12) | blokk magasság szerint **és** kísérlet runKey szerint |
| 64 hex karakter | blokk hash szerint **és** tranzakció **és** kísérlet |
| `sim_` + 32 hex | szimuláció **és** kísérlet |
| a szerver runKey-ábécéjében bármi más | kísérlet |
| minden egyéb (szóköz, `/`, `<`…) | semmi — „nem kereshető" |

A táblázat oka mindenhol ugyanaz: **egyik alakról sem a formátum dönt.** A szerver
kísérlet-runKey szabálya (`/^[a-z0-9][a-z0-9._-]*$/i`, legfeljebb 80) egy magasságot,
egy hash-t és egy `sim_…` kulcsot is elfogad — ezt a unit teszt a saját hibás
elvárásomon fogta meg (a `sim_short`-ot „nem kereshetőnek" vártam, de az
aláhúzás benne van az ábécében).

**Minden válasz megmarad annak, ami volt:** 404 = nincs ilyen; minden más státusz
(400, 401, 429, 5xx), hálózati hiba vagy 8 másodperc válasz nélkül = **nem
sikerült ellenőrizni**, okkal együtt. „No match" csak akkor jelenik meg, ha minden
kérdés 404-et kapott; ha egy is ellenőrizetlen, a lap kimondja: „Not a »no match«",
és felsorolja, hol nem talált és mit nem sikerült ellenőrizni, egy „Search again"
gombbal. Egy 64 hex karakteres „no match" azt is kimondja, hogy egy proTxHash is
ilyen hosszú, és masternode-keresés még nincs — **nem irányít blokk- vagy
tranzakcióoldalra**.

**Továbbugrás:** pontosan egy találat, és minden más kérdés 404 → a lap magára az
elemre visz, `history.replaceState`-tel. Push-sal a Vissza gomb a keresésre lépne
vissza, ami újra továbbugrana — a Vissza-gombos teszt ezt rögzíti. Egy találat
és egy ellenőrizetlen kérdés **nem** egyértelmű válasz: a lap mindkettőt mutatja.
Több találat külön kártyákon, mindegyik saját linkkel.

**Régebbi keresés nem írhatja felül az újabbat:** új keresés megszakítja az előző
kéréseit, és egy válaszra csak az a keresés hallgat, amelyik kérdezte.

### Másolás

Közös `dd-copy` komponens: a **teljes** azonosítót másolja (a képernyőn rövidített
hash soha nem az, ami a vágólapra kerül), sikerre „copied", elutasított vágólapra
„copy failed" — a gombon és egy képernyőolvasónak szóló állapotsorban is. A főoldal
quorum hash-gombja is ezt használja, a régi megjelenéssel; a hiba elnyelése megszűnt.

### A 18. napi mérés azonnal megfogott egy hibát

A `dd-copy` állapotsora `sr-only`, tehát `position: absolute`. Egy abszolút
pozicionált elemet egy görgető doboz csak akkor vág le, ha a tartalmazó blokkja a
dobozon belül van — itt nem volt, így a táblázat képernyőn kívüli soraiban a
láthatatlan állapotsor a lap szélén túl ült: **a főoldal 360 px-en +773 px-szel
lett szélesebb**. A javítás egy `position: relative` a komponens hostján. Ez az a
hiba, amire egy csak ránézéssel ellenőrzött oldal zöld lett volna.

### How we measure

Rövid oldal a DKG, PoSe, Sentinel Layer, HHI és Gini mutatóhoz, a fejlécből egy
linkkel. Minden szakasz három dolgot mond: **mi a szám, mi a minta, és mit nem tud
megmondani.** Minden definíció ott olvasva, ahol a szám számolódik, és a
komponensben minden szakasz mellett ott a forrás helye:

| Mutató | Forrás |
|---|---|
| formation rate, median health | `server/src/domain/roundStats.ts` (formed ÷ (formed + failed); pending és impossible kimarad) |
| health ratio | Core `src/rpc/quorums.cpp:158` @ `e06908d850` — érvényes tagok ÷ a quorum **tényleges** taglétszáma, két tizedesre |
| punished | `server/src/services/quorumRound.service.ts` |
| PoSe küszöb és büntetés | CLAUDE.md, forráshivatkozással (`deterministicmns.cpp:328-340`, `:810/:815`, `:1131`) |
| DSL convergence, missed, unobserved | `server/src/routes/v1/dsl.v1.routes.ts` |
| HHI, Gini, alapablak 500 blokk | `server/src/domain/stakingHealth.ts`, `server/src/routes/v1/staking.v1.routes.ts` |

A csoportos menü rögzített, ezért a keresés és a módszertan **nem kerül a
csoportokba**: a fejlécből érhető el, és a menüben semmit nem világít. A router
unit tesztje, amely minden rejtett route-tól szekciót várt, a nevének megfelelően
most a **részletoldalakra** (mintás route-okra) szűkül, és külön teszt rögzíti,
hogy a két önálló oldal nem világít semmit.

### Favicon

`client/public/favicon.svg`: a kártyacímek akcentszínű négyzete és mellette egy
üres — egy kör, ami formálódott, és egy, ami nem. Nincs új arculat, nincs külső
hivatkozás (a teszt ezt is nézi). A `ops/deploy.sh` a teljes `dist`-et rsync-eli,
tehát élesen is kikerül.

### Érintett fájlok

Kliens: új `lib/search.ts` (+ 15 unit eset), új `components/dd-page-search.ts`, új
`components/dd-page-methodology.ts`, új `components/dd-copy.ts`, `lib/router.ts`
(két önálló route, `navigate(…, { replace })`), `lib/router.test.ts` (+1, és a
szekció-teszt szűkítése), `components/dd-shell.ts` (kereső, link, bekötés),
`components/dd-page-overview.ts` (a másolásgomb cseréje), `index.html`, új
`public/favicon.svg`. Tesztek: új `e2e/search.spec.ts` (19 eset); a 18. napi
`responsive.spec.ts` és az `accessibility.spec.ts` h1-tesztje kiterjesztve a két új
oldalra.

**Szerződésváltozás / kompatibilitás:** nincs API-változás, nincs új függőség.
A shell-bundle 221 kB-ról 253 kB-ra (gzip 49 → 58 kB) nőtt a 18. és 19. nap
együtt; az audit a kis kliensméretet megtartandónak nevezte, ez még e tartományban
van, de a 20. napi átadásban szerepel.

### Negatív kontrollok

Egyszerre egy őr kivéve, a hozzá tartozó teszt futtatva, majd visszaállítva.

| Kontroll | Eredmény |
|---|---|
| A — minden sikertelen kérdés „nincs találat"-nak számít | E2E 1 és unit 1 bukott |
| B — a 64 hex karakteres azonosítót a formátuma dönti el (csak blokk) | E2E 2 és unit 1 bukott |
| C — a mező gépelés közben keres | bukott |
| D — mindkét elavult-keresés őr kivéve | bukott |
| D1 — csak az abort kivéve | **nem bukott** — a generációs ellenőrzés fedi |
| D2 — csak a generációs ellenőrzés kivéve | **nem bukott** — az abort fedi |
| E — a továbbugrás push-sal, nem replace-szel | a Vissza-teszt bukott |
| F — az időtúllépés nincs jelezve | bukott |
| G — egy találat egy ellenőrizetlen mellett is továbbugrik | unit bukott |
| H — a másolásgomb elnyeli a vágólap hibáját | 2 bukott (a keresési és a főoldali gomb) |
| I — rövidített azonosítót másol | bukott |
| J — üres submit is navigál | bukott |
| K — a „no match" nem említi a proTxHash-t | bukott |
| L — nincs favicon-link | bukott |
| M — a `dd-copy` állapotsora kiszökik a táblázat dobozából | a betöltött elrendezésmérés bukott (ez maga a megtalált hiba) |

**D1 és D2 őszintén:** a két őr ugyanazt a hibát fedi, a teszt csak mindkettő
kivételekor bukik. A generációs ellenőrzés a kódkomment szerint egy olyan válaszra
is való, ami az abort pillanatában már megérkezett — ezt az ablakot egyik teszt sem
tudja szándékosan kinyitni, úgyhogy az a rész **érvelés, nem bizonyíték**, és a
komment is így mondja.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — **855** szerver (változatlan) + **199** kliens (183 → 199) unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **212** böngészőteszt (193 → 212), egy workerrel, 5,1 perc |
| K3 | exit 0 — 15 fájl, 98 teszt (változatlan; nem kötelező ezen a napon, lefutott) |
| CSP-kapu | exit 0 — 4 eset; a favicon a buildelt kliensben is ott van (`dist/favicon.svg`) |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:**

- a **20. nap** (regresszió és review-csomag) elkezdhető;
- **proTxHash-keresés:** a backlogba került (lásd lent) — nincs hozzá masternode-részletoldal.

```text
Commit(ok), végső SHA: 6b5385d (19. nap)
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## 20. nap – Regresszió és review-csomag

```text
Nap / dátum / implementáló: 20 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/day20-regression-handover @ 5aae3e4 (main, a 19. nap után)
Napi feladat és előfeltételei: friss checkoutban K0–K4, F01–F14 újraellenőrzés, hibás
  API-utak és admin desktop/mobil, átadási csomag. Nincs új funkció.
Auditpontok: mind (újraellenőrzés); F10, F12, F13 érdemi javítással
```

Az átadási csomag: [WEBSITE_HANDOVER_2026-09-13_HU.md](WEBSITE_HANDOVER_2026-09-13_HU.md).
Ez a bejegyzés arról szól, mit találtam és mit javítottam a regressziós körben.

### Mi fut élesben — és ami ebből következik

Csak olvasással mérve a VPS-en: a szerver és a kliens a `83b8710`-ből fut (a #163 merge,
2026-09-12 16:17). Ebben a #162 (**1–10. nap**) benne van, a #164 (**J1–J3, az R1–R7
review-javítások**) és minden későbbi **nincs**. A korábbi bejegyzések „a VPS kliense a
11. nap előtti" mondata igaz volt, de kevesebbet mondott a kelleténél: **élesben ma is a
review által talált hibák futnak**. A 14. napi nginx-fejlécek élnek (a host
konfigurációjában). Mindez az átadási csomag 3. pontjában, és a mátrix „élesben"
státuszában.

### Hét célzott javítás, mindegyik külön commitban

| Commit | Lelet → javítás | Negatív kontroll |
|---|---|---|
| `694d5cc` | **F13 hézag:** a labor-szerver (`labServer.ts`) nem állította a simple query parsert, tehát a `qs`-t, amit az F13 elfogadása „nem elérhetőnek" nevezett, ott hitelesítés előtt feldolgozta minden kérés (alapból `127.0.0.1`). Közös `hardenHttpApp()` mindkét szervernek; a helmet HSTS-e kikerül (egy tulajdonos: az nginx). Tesztek valódi kérésen és a forrás sweepjével | a labor-szerver hardening nélkül; a parser beállítása az első `app.use` után (**bizonyítja, hogy a sorrend számít**); a helmet alap-HSTS-e; egy urlencoded parser — mind bukik |
| `5d04fce` | **Integrációs szivárgás:** 167 hátrahagyott adatbázis, mind csak üres gyűjtemény indexekkel — a Mongoose háttér-indexépítése a drop után újra létrehozta őket. A drop előtt minden modell `init()`-jét várjuk; egy futás végi globális ellenőrzés bukik, ha maradt adatbázis. Mérve: a vitest a teardownban dobott hibát kiírja és **0-val lép ki**, ezért `process.exitCode = 1` is | a várakozás nélkül a futás 1-gyel bukik, 8 adatbázist megnevezve; független számlálás a mongodban: a javított három futás egyet sem hagyott |
| `611fdde` | `aria-pressed` a staking nézetváltón (a 12. nap óta nyitott); sweep minden toggle-csoportra | a javítás nélkül a sweep pontosan azon a páron bukik |
| `ecea0ec` | a health-grafikon `ResizeObserver loop` hibája (egy méretezési körben 7); a PoSe-grafikon fix magasságú, sosem loopolt, nem nyúltam hozzá | a javítás előtt 7 hiba a főoldalon, 0 a PoSe-n |
| `f8354e6` | a publikus mérési riport **teljes mezőleltára** tesztben; a `byProfile` sorok `rounds`-a és a `hostGrouping` név szerint | mindkét név szerinti másolás spreadre visszaállítva bukik; a leltár a saját tesztjén bukik egy hozzáadott mezővel |
| `56e85f3` | **Egy sikertelen betöltés üres rekordnak látszott** — lásd lent | a régi kódon 15-ből 10 teszt bukik |
| `a436d6b` | **Az admin panel túlfolyt:** 768 px-en +160, 360 px-en +568 (a `1fr` oszlop nem lehet keskenyebb a táblázatnál); a sessionhiba +423, az abort-hiba +814 hosszú tokennel | a `1fr` visszaállítva a működő állapotok bukik; a tördelés nélkül mindkét hibadoboz |

### A hibás API-utak mérése, és amit találtam

Minden publikus útvonal 401, 404, 429 és 500 mögött. A legtöbb oldal kiírja a szerver
üzenetét — de **hat a hibasáv mellett az üres állapot mondatait is**: „0 indexed", „No
bans recorded in this window", „No operator mapping loaded yet", „No rounds recorded
yet". Egy sikertelen kérés így üres rekordnak olvasódott, és ez ezen az oldalon pont az
az olvasat, aminek lehetetlennek kell lennie. A PoSe Watch **betöltés közben** is ezeket
írta. A Fairness és a főoldali profilmegjegyzés egy 500-at adó ChainLock-riportot „nincs
ChainLock report"-nak nevezett.

A javítás: minden érintett lista tudja, betöltődött-e már egyszer. Addig a számláló
„count unknown", a táblázat „Could not be loaded, so what exists is unknown."; üres
állapotot csak sikeres válasz mondhat. Sikeres betöltés után egy hibás frissítés
megtartja az utolsó jó oldalt (a 3. napi döntés). A profilmegjegyzés: „the ChainLock
report could not be read: <ok>". Egy meglévő Fairness-teszt a régi mondatot várta
jelzésként; az új, pontosabb mondatra vár.

### Admin desktop és mobil

A 18. nap a publikus shellt mérte, az admint szándékosan nem. Ma mérve: kijelentkezve,
elérhetetlen sessionnel, működve, kiválasztott futammal, rate-limitelt és hibás
futamlistával, 360/390/768/1440 px-en — és egy elutasított aborttal telefonon. Javítva,
teszt mögött.

### Friss, tiszta checkout

| Kapu | Parancs | Eredmény |
|---|---|---|
| K0 | Node/npm, lockfile, git | Node v24.7.0, npm 11.5.1; `.node-version` 24; `package-lock.json` sha256 `2f72d372cf5d6dac7bc2e68a656971236a9791fe5cd163f80173f9a3177ffb78`; a munkafa a klón után és a build után is tiszta; `npm ci` exit 0 |
| K1 | `npm run build -w shared`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` | mind exit 0 — **864** szerver (92 fájl) + **202** kliens (18 fájl) unit teszt |
| K2 | `CI=1 npm run test:e2e -w client` | **nem tiszta.** 1. futás (5,4 perc): 230 zöld, 1 bukott — `accessibility.spec.ts` „the target table carries its caption": az oldal JavaScriptje 10 s alatt el sem indult (a futás naplójában ennél a tesztnél hiányzik a minden oldalbetöltéskor megjelenő Lit-figyelmeztetés); önmagában 8/8-szor zöld. 2. futás (25,3 perc — közben a másik checkoutban buildet és CSP-kaput futtattam): 229 zöld, 2 bukott, mindkettő navigációs időtúllépés a két nagy elrendezésmérésben. **Egyik futásban sem bukott viselkedési állítás.** Az első futás hibaképét a CSP-kapu törölte (ugyanaz a kimeneti mappa volt) — ezt a `46ac9da` javítja |
| K3 | `MONGODB_TEST_URI=mongodb://127.0.0.1:27018 npm run test:integration` | exit 0 — 15 fájl, 98 teszt (8 kihagyott: az adatbázis nélküli párdarabok); a futás végi szivárgás-ellenőrzés nem talált hátrahagyott adatbázist |
| CSP | `CI=1 npm run test:csp -w client` | exit 0 — 4 eset |
| audit | `npm audit --omit=dev` | 2 moderate (az elfogadott F13-maradék) |

### Képek

`npm run review:shots -w client` — 17 kép a `client/review-shots/`-ba, szintetikus
fixtúrából: a hibás, betöltési, üres, elutasított, kijelentkezett és telefonos utakról
is. Nincs a repóban; a reviewer a vizsgált commitból generálja.

### Érintett fájlok

Szerver: új `httpHardening.ts` (+ teszt), `index.ts`, `labServer.ts`, `package.json`,
új `vitest.integration.config.ts`, új `integration/leakCheck.globalSetup.ts`,
`integration/mongo.ts`, `simulator/simulationMeasurementPublicDto.ts` (+ teszt).
Kliens: `dd-page-{blocks,txs,rounds,pose,operators,overview,fairness,staking}.ts`,
`dd-health-chart.ts`, `dd-admin-shell.ts`, `dd-simulation-control.ts`, `lib/errors.ts`,
`lib/primaryProfile.ts` (+ teszt), `package.json`, új `playwright.shots.config.ts`; tesztek:
új `e2e/failure-states.spec.ts`, új `e2e/review-shots.shots.ts`, `responsive.spec.ts`,
`accessibility.spec.ts`, `fairness.spec.ts`. Dokumentáció: új átadási csomag, ez a napló.

**Szerződésváltozás / kompatibilitás:** a szerver nem küld HSTS-t (az nginx küldi; a
deploy után az `/api/` egy fejlécet kap). A mérési riport publikus mezőkészlete változatlan.

### Parancsok, exit-kódok

| Kapu | Eredmény |
|---|---|
| K1 | a friss klónban mind exit 0 — **864** szerver (855 → 864) + **202** kliens (199 → 202) |
| K2 | a javítások célzott specjei helyben zöldek (a hibaállapot-, elrendezés-, navigáció-, akadálymentesség-, fairness- és overview-spec); a **teljes** suite a friss klónban két futásban futott le, és **nem volt tiszta** (lásd fent) — viselkedési állítás nem bukott; a tiszta környezetű teljes K2 a #174 CI-ja |
| K3 | exit 0 — 15 fájl, 98 teszt, **0** hátrahagyott adatbázis (helyben háromszor egymás után, és a friss klónban) |
| CSP-kapu | exit 0 — 4 eset, helyben és a friss klónban |
| `npm audit` | 2 moderate (F13, változatlan) |

**Valódi laborfutam:** NEM FUTOTT — nem futtatott labor-elfogadás (átadási csomag, 11. pont).

**Nyitott probléma / következő lépés:**

- a független végső review; utána, külön döntéssel, a deploy (átadási csomag, 10. pont), majd a CSP enforce-ra váltása;
- a friss klón K2-je két futásban sem volt tiszta (egy nem induló oldal, két navigációs időtúllépés, viselkedési hiba nélkül) — figyelni kell, megjelenik-e a CI-ban is.

```text
Commit(ok), végső SHA: 694d5cc, 5d04fce, 611fdde, ecea0ec, f8354e6, 56e85f3, a436d6b, cc304bd, 46ac9da; dokumentáció: a #174 PR dokumentációs commitja; a CSP-mappa: `46ac9da`
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT — independent review még nem történt
Éles deploy: NEM TÖRTÉNT
```

## J4 javító munkanap – a végső review A csomagja: futamállapot, bizonyíték, belépés (V1, V2, V7, V3)

```text
Nap / dátum / implementáló: J4 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-13 @ 39e7f80 (main, a #174 merge)
Napi feladat és előfeltételei: a végső független review (docs/WEBSITE_FINAL_REVIEW_2026-09-13_HU.md)
  V1, V2, V7 és V3 találata, a reviewer írásos pontosításaival. Előfeltétel: az ellenpróbák
  reprodukálva a mainen — 7 bukott, a C1 kontroll zöld, ugyanazokkal a hibaüzenetekkel.
Auditpontok: F01 (V1, V3), F02 (V1, V2, V7)
```

**Először a sorrend kimondása, a tesztekben.** A harness addig csak késleltetni tudott
(`delayMs`); a késleltetés azt mondja, hogy „lassabb”, azt nem, hogy „utána”. A `e529b4e`
visszatartott válaszokat ad (`ResponseGate`): a teszt engedi el őket, a kívánt sorrendben, és a
`release()` csak akkor tér vissza, amikor az oldal a választ JSON-ként már elolvasta. Így az
állítás a feldolgozás után történik, nem a hálózati érkezés után — ezt a reviewer kifejezetten
kérte. Négy önteszt, négy negatív kontroll; a negyedik elsőre **nem bukott**: mérve, a telepített
oldalóra valós időben fut, a teszt egy nem létező esetet védett. Megállított órára írva bukik.

**V1 — `96e6e30`.** A kezdeti olvasás a futamot a mentett tervvel együtt kéri, és a futamot
revision-ellenőrzés nélkül írta felül: egy közben megérkezett újabb státuszt visszatekert
`armed`-re, és felkínálta az indítást aktív faultra. A futam most ugyanazon a revision-szabályon
megy át, mint a poll és a mutációk. Ugyanennek az olvasásnak a hibája törölte a poll által már
elfogadott futamot is, a panel pedig terv nélkül semmit nem rajzolt — elveszett az Abort. A terv
olvasási hibája most hiányzó terv, nem hiányzó futam: a futam, a bizonyíték és az idővonal marad,
a panel mutatja az állapotot, az abortot és a recovery vezérlőit, kimondja, hogy a terv nem
olvasható, és ad egy csak olvasó „Read the saved plan again” gombot. Preflight, élesítés és indítás
terv nélkül nincs. A 404 továbbra is törli a kiválasztást, a 401 továbbra is session-lejárat.

**V2 — `2e2d56c`.** Az idővonal és a recovery-bizonyíték olvasásai egymás között nem voltak
rendezve: ugyanahhoz a kiválasztáshoz tartozó két olvasásból az utoljára érkező nyert, így egy
korábbi „nincs bizonyíték” lecserélte a frissebb „all targets clear”-t. Minden ilyen olvasás —
a kezdeti, a poll utáni, a mutáció utáni és a Refresh — sorszámot kap, és a két mező csak
újabb kérésből íródik. Egy régebbi válasz, amely előbb érkezik, ettől még megjelenik; a sikertelen
olvasás nem ír és nem foglal helyet.

**V7 — `11bbe63`.** A kezdeti olvasás a bizonyíték-hibát `null`-ra fordította, vagyis „No
recovery proof has been recorded” lett belőle. A shell külön tartja, hogy a bizonyítékot
*elolvasta-e* (olvasás alatt / elolvasva / olvashatatlan), és azt, hogy mit mond. Olvashatatlan
állapot csak addig áll fenn, amíg semmit nem sikerült elolvasni; az elolvasott bizonyítékot egy
sikertelen frissítés megtartja (J2). A hiba mellett csak olvasó „Read the evidence again” gomb áll
— nem a „Retry recovery proof”, amely recovery-parancs a laborra; a teszt méri, hogy csak GET megy ki.

**V3 — `451e3e8`** (örökölt, a baseline-ban is megvolt). A belépés a dashboard betöltési flagjét
tartotta, a dashboard-betöltés pedig épp erre a flagre kilépett. A session-művelet saját flaget
kapott; a gomb letiltása a dupla küldés elleni őr; a sikeres belépés azonnal betölti a dashboardot
és az URL futamát.

**Amit a nap mért, és nem várt:**

1. **Az első V1-teszt a javítás nélkül is zöld volt.** A valós időben futó óra miatt az 5
   másodperces poll az állítás 10 másodperces újrapróbálási ablakában „kijavította” a
   visszatekerést. A versenytesztek megállított órával futnak.
2. **Két őr nem tudott bukni, és kikerült.** A terv hibajelzőjének törlése a sikerágban
   megfigyelhetetlen volt (NC6) — most az olvasás elején törlődik, ami az újraolvasás közbeni
   „still being read” feliratban látszik. A belépés elé tett JS-őr sem volt elérhető, mert a
   letiltott gomb már megállítja a második kattintást.
3. **Egy J2-teszt semmit nem mért.** A „failed evidence refresh keeps what was proven” a sikertelen
   frissítés feldolgozása előtt állított; egy kontroll zöld maradt tőle. Most megvárja a hibás
   válasz elolvasását. Ugyanez a minta látszik a régi „a poll describing an older state cannot undo
   an action” tesztben — azt ez a kör nem érintette (nyitott tétel).
4. **Környezeti hiba a K2-ben.** A V7 első K2-futásában egy teszt üres oldalt kapott: a
   `/src/main.ts` betöltése `net::ERR_NO_BUFFER_SPACE`-szel bukott (a trace-ben). Külön futtatva a
   spec zöld, a második teljes K2 tiszta. A TIME_WAIT-számláló a hipotézisemet nem igazolta
   (tiszta futásban 878, később 1000 körül is tiszta). Nyitott tétel.

**Negatív kontrollok:** a harnessre 4, a V1-re 7, a V2-re 5, a V7-re 7, a V3-ra 3 — mind a saját
tesztjén bukott, minden visszaállítás sha256-tal ellenőrizve. A V2 két kontrollja a hydration-tesztet
is buktatja, mert a sorszám könyvelését is kiveszi; az a teszt mindkét oldalt védi.

**Érintett fájlok:** `client/e2e/harness.ts`, `client/e2e/harness.spec.ts`,
`client/e2e/run-status.spec.ts`, `client/e2e/admin.spec.ts`,
`client/src/components/dd-admin-shell.ts`, `client/src/components/dd-simulation-control.ts`,
`client/src/lib/simulationRunState.ts`.

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód, auth, CSRF, revision- és
idempotencia-szabály változatlan; a kliens azokhoz igazodik.

**Parancsok, exit-kódok** (commitonként, a commit fáján):

| Commit | K1 | K2 | CSP |
|---|---|---|---|
| `e529b4e` harness | exit 0 — 864 + 202 | 235 | — |
| `96e6e30` V1 | exit 0 — 864 + 202 | 241 | 4 |
| `2e2d56c` V2 | exit 0 — 864 + 202 | 245 | 4 |
| `11bbe63` V7 | exit 0 — 864 + 202 | 1. futás: 249 + **1 bukott** (`ERR_NO_BUFFER_SPACE`); 2. futás: 250 | 4 |
| `451e3e8` V3 | exit 0 — 864 + 202 | 253 | 4 |

A review ellenpróbái: V1, V2, V3 és V7 zöld a javítás után.

**Valódi laborfutam:** NEM FUTOTT.

```text
Commit(ok), végső SHA: e529b4e, 96e6e30, 2e2d56c, 11bbe63, 451e3e8
Végső git státusz: a saját munkám commitolva; a munkafában négy követetlen ops/c2-*.sh áll, más
  munkából — érintetlenül hagyva, nem került commitba
Napi státusz: ELLENŐRZÖTT — a független újra-review még nem történt meg
Éles deploy: NEM TÖRTÉNT
```

## J5 javító munkanap – a végső review B csomagja: az adat a saját lekérdezése alatt (V4)

```text
Nap / dátum / implementáló: J5 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-13 @ 451e3e8 (J4 után)
Napi feladat és előfeltételei: V4. A reviewer pontosítása: böngészős ellenpróbával csak a Blocks
  bizonyított; a többi oldal vizsgálati feladat, a Staking és a Vantage points nézettel kiegészítve.
Auditpontok: F11 (V4)
```

**Oldal-leltár** — minden oldal, amelynek lekérdezés-állapota van:

| Oldal | Lekérdezés | Érintett? | Megjegyzés |
|---|---|---|---|
| Blocks | lap | igen | a review reprodukálta |
| Transactions | lap | igen | azonos kód |
| DKG Rounds | lap, státusz, profil | igen | szűrőváltásnál is |
| Experiments | lap, státusz | igen | a fejléc már az új tartományt írta |
| Simulations (lista) | lap | igen, betöltés közben | hibánál a lista már eddig is eltűnt |
| Staking | ablak | igen | az „1,000” alatt az 500-as minta |
| Vantage points | téma | igen | a „Recent ChainLocks” alatt a blokk-adat |
| Fairness | ablak, profil | nem | a lekérdezés-váltás eddig is törölte az adatot |
| PoSe Watch, Operators | — | nem értelmezhető | nincs lekérdezés |

**A javítás — `dc05f11`.** Minden érintett oldal feljegyzi, melyik lekérdezésre olvasta az
adatát, és csak az alatt mutatja; más lekérdezés alatt „Loading…” vagy a meglévő „nem tölthető be”
felirat áll. Ugyanannak a lekérdezésnek a sikertelen frissítése továbbra is megtartja az utolsó jó
adatot (3. nap).

**A késői válasz, mérve.** Egy elhagyott lekérdezés válasza nem érkezhet meg: a poll-vezérlő
megszakítja az olvasást (`net::ERR_ABORTED` a trace-ben). A késői-válasz teszt első változata ezt
nem tudta: elengedte a kérést, kilenc másodpercig várt egy olvasásra, amely nem történhetett meg,
elnyelte az időtúllépést és zöld lett. A harness most jelzi, ha a lap maga szakította meg a
visszatartott kérést (`cancelled()`, a `release()` azonnal kimondja); ennek önteszt és két negatív
kontroll jár.

**A nap saját mérési hibája.** A mintavevő szkript az `ERR_NO_BUFFER_SPACE`-t a K2
konzolkimenetében kereste; a hiba csak a bukott teszt trace-ében jelenik meg, így a korábbi „0”
semmit nem bizonyított. Javítva, pozitív kontrollal (az ismert bukást megtalálja).

**Tesztek:** `client/e2e/query-identity.spec.ts` (+17): hét oldalon a hibázó és a töltődő következő
lekérdezés; azonos téma pollhibája megtartja az adatot; a késői válasz megszakított olvasás, a 3.
oldal marad; Back az 1. oldalra a 2. oldal sorai nélkül. `harness.spec.ts` (+1).

**Negatív kontrollok:** kilenc a javításra (oldalanként egy, egy az azonos lekérdezésű adat
megtartására, egy a megszakításra) és kettő a harness-bővítésre — mind a saját tesztjein bukott.

**Érintett fájlok:** `client/src/components/dd-page-{blocks,txs,rounds,experiments,simulations,staking,peers}.ts`,
`client/e2e/query-identity.spec.ts`, `client/e2e/harness.ts`, `client/e2e/harness.spec.ts`.

**Parancsok, exit-kódok:** K1 exit 0 — 864 + 202. K2: 1. futás 270 + **1 bukott**
(`public-simulations`, üres oldal, `ERR_NO_BUFFER_SPACE` a trace-ben); 2. futás **271**, a trace-ekben
pufferhiba nincs. CSP 4. A review V4-ellenpróbája zöld.

**Valódi laborfutam:** NEM FUTOTT.

```text
Commit(ok), végső SHA: dc05f11
Napi státusz: ELLENŐRZÖTT — a független újra-review még nem történt meg
Éles deploy: NEM TÖRTÉNT
```

## J6 javító munkanap – a végső review C csomagja: szerkesztés és export (V5, V6), a CSP-riport mappája

```text
Nap / dátum / implementáló: J6 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-13 @ dc05f11 (J5 után)
Napi feladat és előfeltételei: V5, V6 a reviewer döntéseivel (V5: a scenario-választó is zárolva,
  explicit eldobás az utolsó olvasható paraméterekhez; V6: (a) változat, schemaVersion 2, csak
  besorolás). Utána a CSP-kapu riportmappája, a review megfigyelése nyomán.
Auditpontok: F09 (V5); V6 a 17. nap terméke, nem auditpont
```

**V5 — `b7ee9f8`.** Az olvashatatlan Advanced JSON megmaradt, de a következő mezőszerkesztés vagy
scenario-váltás csendben eldobta. Amíg a szöveg olvashatatlan, zárolva van minden, ami felülírná:
szám- és enum-mezők, a targetválasztó és a scenario-választó. Kiút a JSON kijavítása (mindent felold,
a kétirányú szinkron a régi) vagy a „Discard the unreadable JSON”, amely mellette kimondja, hogy az
utolsó olvasható paraméterekhez tér vissza. A network, a mode és a futam vezérlői használhatók.
A review V5-ellenpróbája most a letiltott Count mezőbe gépelésen időtúllépésre fut — a reviewer ezt
előre elfogadta; a szövegmegőrzést a kapuban lévő teszt állítja. Két saját teszthiba: a
targetválasztó első állítása a `fieldset`-re szólt, amelyet a Playwright sosem jelent letiltottnak
(a javítás nélkül is zöld volt), és az enum-zárolást semmi nem mérte — mindkettő pótolva.

**V6 — `f119407`.** Az export `report: null`-t írt a nem létező és az olvashatatlan riportra is. Új
mező: `reportRead` (`present` / `absent` / `unavailable`); a `report` az utóbbi kettőnél `null`
marad. HTTP-státusz és szerverszöveg nem kerül a fájlba. **`schemaVersion` 1 → 2.** Az export típusa
csak lezárult riportolvasást fogad el.

**A CSP-kapu riportmappája — `ad033ba`.** A review egy HTML-artefakt okozta „page reload”-ot
figyelt meg. Mérve, pozitív kontrollal (a megnyitott oldal saját HTML-jének átírása újratölt): a
`playwright-report/` és a `test-results-csp/` alá írt HTML-re a Vite *naplóz* „page reload”-ot, de
az alkalmazás oldalát **nem** tölti újra; a `test-results/` és a `dist/` nincs figyelve. Watch-kizárás
nem kell. Ami valós volt: a CSP-konfig örökölte a HTML-riportert a mappájával együtt, és felülírta a
böngészős futás riportját (egy 277-tesztes futás után a riport a CSP 4 tesztjét tartalmazta). A CI-ben
ez nem vesztett adatot (bukott suite után a CSP-lépés nem fut), helyben igen. Saját mappa:
`client/playwright-report-csp`, `.gitignore` és a CI hibás futásnál feltöltött mappái közé felvéve;
utólag mérve, hogy a két riport külön marad.

**Negatív kontrollok:** V5-re 6 (zárolásonként, eldobás, abort), V6-ra 8 (4 unit és 4 böngészős) —
mind a saját tesztjén bukott.

**Érintett fájlok:** `client/src/components/dd-simulation-control.ts`,
`client/e2e/scenario-forms.spec.ts`, `client/src/lib/simulations.ts`,
`client/src/lib/simulations.test.ts`, `client/src/components/dd-page-simulations.ts`,
`client/e2e/public-simulations.spec.ts`, `client/playwright.csp.config.ts`, `.gitignore`,
`.github/workflows/ci.yml`.

**Szerződésváltozás / kompatibilitás:** a publikus szimulációs export fájlformátuma `schemaVersion` 2,
additív `reportRead` mezővel. Kliensoldali fájl; a szerver publikus DTO-ja nem változott.

**Parancsok, exit-kódok:**

| Commit | K1 | K2 | CSP |
|---|---|---|---|
| `b7ee9f8` V5 | exit 0 — 864 + 202 | 276 | 4 |
| `f119407` V6 | exit 0 — 864 + **203** | 277 | 4 |
| `ad033ba` CSP-riport | exit 0 — 864 + 203 | 277 | 4 |

K3 az `ad033ba`-n: exit 0 — 15 fájl, **98** teszt, 8 kihagyott (a Mongo nélküli párdarabok); a J4–J6
szerverkódot nem érintett.

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott tételek a J4–J6 után** (az átadási csomag 8. és 14. pontjában is):

- `ERR_NO_BUFFER_SPACE` a helyi K2-ben: a 2026-09-13-i 12 végigfutott teljes K2-ből kettőben egy-egy
  üres oldal (egy-egy bukott teszt); a gyökérok nem mért, a TIME_WAIT-hipotézis nem igazolt.
- A „a poll describing an older state cannot undo an action” teszt a válasz feldolgozása előtt állít.
- Fairness: ha a tip átlép egy aktiválási magasságot és az új profil kérése hibázik, a régi profil
  adata az új „at the tip” gomb alatt maradhat — kódolvasásból, nem mérve.
- A harness teardown-kori megszakításának nincs saját tesztje.

```text
Commit(ok), végső SHA: b7ee9f8, f119407, ad033ba, + ez a dokumentációs commit
Napi státusz: ELLENŐRZÖTT — a független újra-review még nem történt meg
Éles deploy: NEM TÖRTÉNT
```

## J7 javító munkanap – az ismételt review hibajegyei (W1–W4) és egy tesztadósság

```text
Nap / dátum / implementáló: J7 / 2026-09-13 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-13-2 @ 72fec82 (main, a #175 merge)
Napi feladat és előfeltételei: az ismételt független review (docs/WEBSITE_REVIEW_V1_V7_2026-09-13_HU.md)
  négy P2 hibajegye és a megerősített tesztadósság. Előfeltétel: az ellenpróbák reprodukálva a mainen —
  W1–W4 piros, C2 zöld.
Auditpontok: F02 (W2), F05 (W4), F11 (W1); W3 a tesztharness
```

**Sorrend.** A review W2 → W3 → W1 → W4 sorrendet javasolt; a W3-mal kezdtem, mert a többi javítás tesztjei
ugyanerre a harnessre épülnek, és nem akartam tudottan hibás eszközzel mérni.

**W3 — `2bd3139` (harness, a #175 saját hibája).** A `release()` arra várt, hogy „az URL-t még egyszer
elolvassák”; egy ugyanarra az URL-re érkező másik válasz elolvasása ezt teljesítette, miközben a saját törzs
még olvasatlan volt. Minden API-válasz csak tesztben használt `x-harness-response-id` fejlécet kap, az
olvasásjelző ezt a konkrét `Response`-hoz jegyzi fel, a `release()` a saját azonosítójára vár. A törzs, a
státusz és az oldalnak visszaadott Promise változatlan. Két önteszt (a review esete és két azonos URL-ű
válasz fordított olvasási sorrendben); a negatív kontroll — a darabszámos logika — mindkettőt **korai
visszatéréssel** buktatja (`undefined` törzs), nem időtúllépéssel.

**W2 — `6c94aa0`.** A bizonyíték-olvasás a 401-et is „nem olvasható”-nak vette, a history-frissítés elnyelte.
A 401 most a kezdeti olvasásnál és minden frissítésnél — az újraolvasó gombét is beleértve — a
session-lejárati kezelőhöz jut, **a kiválasztás-ellenőrzés után**: egy már elhagyott futam késői 401-e nem
dobja ki az aktuálisat. Az 503 olvasási hiba marad, az újraolvasás csak GET. +4 teszt, 5 negatív kontroll.

**W1 — `35899d4`.** A Simulations lista minden hibánál csak a hibát rajzolta, mielőtt megnézte volna, kinek a
sorait tartja. Ennek a lapnak a sorai most a hiba mellett maradnak; adat nélkül csak a hiba látszik, sem
kitalált üres lista, sem hamis „Loading”. +3 teszt, 3 negatív kontroll — a harmadik csak azért bukik, mert az
első betöltési hiba tesztje megkapta a „nem Loading” állítást; nélküle az őr megfigyelhetetlen lett volna.

**W4 — `f2a4873`.** A Fairness adata az URL-váltásnál törlődött, a tip-vezérelt profilváltásnál nem. Az adat
most az ablakhoz és a **ténylegesen követett** profilhoz van kötve; hiba után a közös „Could not be loaded”
felirat áll. +3 teszt, 4 negatív kontroll. Ezzel az átadási csomag „Fairness: tip-vezérelt profilváltás —
nem mérve” tétele lezárult.

**Tesztadósság — `c82db16`.** A „a poll describing an older state cannot undo an action” az óra léptetése után
azonnal állított. Mérve, változtatás előtt: a revision-szabály kivételét a régi változat is **3/3-szor**
elkapta — a gyengeség a konstrukcióban volt, nem megfigyelt hamis zöldben. Most megvárja a régi pollválasz
elolvasását; a kontroll 3/3 bukik, a teszt 3/3 zöld.

**A nap saját hibái és mérési lelete:**

1. **A review naplói UTF-16 kódolásúak**, ezért az első titokkeresésem ezekre nem működött (a pozitív
   kontroll csak a markdown- és spec-fájlokból számolt). Push előtt UTF-8-ra alakítva, fájlonkénti pozitív
   kontrollal újraellenőrizve: tiszták. A repóban a review által írt kódolásban maradtak.
2. Az első W1-tesztem két elemre illeszkedő szelektorral (`.page-sub`) bukott a javított kódon is — szűkítve.
3. A W4 hibaágának „Could not be loaded” feliratát eredetileg semmi nem mérte — a teszt kiegészítve.

**Érintett fájlok:** `client/e2e/harness.ts`, `client/e2e/harness.spec.ts`,
`client/src/components/dd-admin-shell.ts`, `client/e2e/run-status.spec.ts`,
`client/src/components/dd-page-simulations.ts`, `client/e2e/public-simulations.spec.ts`,
`client/src/components/dd-page-fairness.ts`, `client/e2e/fairness.spec.ts`.

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód, auth, CSRF, DTO változatlan.

**Parancsok, exit-kódok** (commitonként, a commit fáján):

| Commit | K1 | K2 | CSP |
|---|---|---|---|
| `2bd3139` W3 | exit 0 — 864 + 203 | 279 | 4 |
| `6c94aa0` W2 | exit 0 — 864 + 203 | 283 | 4 |
| `35899d4` W1 | exit 0 — 864 + 203 | 286 | 4 |
| `f2a4873` W4 | exit 0 — 864 + 203 | 289 | 4 |
| `c82db16` tesztadósság | exit 0 — 864 + 203 | 289 | 4 |

K3 a `c82db16`-on: exit 0 — 15 fájl, **98** teszt, 8 kihagyott (a Mongo nélküli párdarabok). A review
ellenpróbái a `c82db16`-on: **5/5 zöld** (W1, W2, W3, W4, C2). Mind az öt K2 első futásra tiszta volt.

**Valódi laborfutam:** NEM FUTOTT.

```text
Commit(ok), végső SHA: 1a4a592 (review-dokumentumok), 2bd3139, 6c94aa0, 35899d4, f2a4873, c82db16,
  + ez a dokumentációs commit
Végső git státusz: a saját munkám commitolva; öt követetlen ops/c2-*.sh más munkából, érintetlenül
Napi státusz: ELLENŐRZÖTT — a független újra-review még nem történt meg
Éles deploy: NEM TÖRTÉNT
```

## J8 javító munkanap – a harmadik review maradéka: X1 (a W2 maradéka) és X2 (tesztlezárás)

```text
Nap / dátum / implementáló: J8 / 2026-09-14 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-13-2 @ eb76773 (a #176 feje, a PR nyitott)
Napi feladat és előfeltételei: a harmadik független review (docs/WEBSITE_REVIEW_W1_W4_2026-09-14_HU.md)
  P2 maradéka (X1) és P3 teszthibája (X2). Előfeltétel: reprodukálva az ágon, változtatás előtt — X1 két
  ellenpróbája piros, C3 és C4 zöld; a W3 negatív kontrolljának futásában egy „has been closed” hiba.
Auditpontok: F02 (X1); X2 a tesztharness öntesztje
Döntés: ugyanarra az ágra és PR-be (#176) — ezt javasoltam, mert az X1 a W2 maradéka; a tulajdonos
  „csináld”-dal indította, hogy egy PR-t mergeljen
```

**Dokumentáció — `6b07a8b`.** A jelentés, a két hibajegy, az ellenpróbák és a review UTF-8 naplói a repóban,
a review által írt formában (a sorvégeket a `.gitattributes` LF-re normálja). A review `artifacts/` és
`generated/` mappája a saját `.gitignore`-ja szerint kimarad; a repón kívüli másolat és a `SHA256SUMS` hash-e a
„Review checkpointok” alatt.

**X1 — `d0f28fe`.** A kiválasztás első betöltése a mentett tervet, az idővonalat és a bizonyítékot egy
`Promise.all`-lal olvasta, ami az elsőként érkező hibával tér vissza. Ha a terv vagy az idővonal 503-a egy
másik olvasás 401-e előtt érkezett, olvasási hibaként ment tovább, a 401-et senki nem nézte meg, és a privát
panel — az Abort gombbal együtt — nyitva maradt egy lejárt sessionön. A bizonyíték-olvasás 401-e mindkét
sorrendben elveszett, mert az az olvasás a hibáját válasszá alakítja, nem elutasítássá.

Most a terv és az idővonal `Promise.allSettled`-del fut a bizonyíték-olvasás mellett, és a betöltés csak
akkor dönt, amikor mindhárom válaszolt. A döntés sorrendje: (1) az aktuális kiválasztáshoz tartozik-e még a
válasz; (2) bármelyik olvasás mondja-e, hogy a session véget ért; (3) csak ezután, melyik olvasási hibát
jelenti (előbb a tervét, aztán az idővonalét). A magában álló 503 olvasási hiba marad, a futam és az abortja a
V1 szerint megmarad. A `_loadSelectedRun` catch-ágának 401-ága elérhetetlenné vált, ezért kikerült.

Két következmény, amit kimondok, mert nem hibajavítás, hanem mellékhatás: (a) a terv nélküli nézet üzenete
most a leglassabb olvasás után jelenik meg, nem az első hibánál — az abort addig is elérhető a státuszpollból
kapott futamon, és ezt a V1 meglévő tesztje visszatartott tervvel állítja; (b) ha a terv és az idővonal is
nem-401 hibával bukik, eddig az érkezési sorrend döntötte el, melyik üzenete látszik, most rögzítetten a
tervé. Ez utóbbira **nincs külön teszt**.

Tesztek (`run-status.spec.ts`, +10):

- a 401 minden olyan első olvasáson, amely hordozhatja, minden olyan olvasás 503-a mellett, amely vele együtt
  bukhat, **mindkét sorrendben** — 8 eset, mindegyik azt is állítja, hogy nincs lapszintű hiba. Változtatás
  előtt **pontosan az a 6 bukott, amelyet a kódból előre jeleztem**, mind a kijelentkezett nézet állításán; a
  dry-run- és history-401 „401 érkezik előbb” esete a régi kódon is zöld volt;
- egy elhagyott futam késői első-olvasási 401-e nem zárja le a sessiont, amikor az új futam terve nem olvasható
  (a review C3-a, a rendes kapuba emelve);
- az első olvasáson olvashatatlan idővonal a tervre és az idővonalra is jelentve, a futam megtartja az abortot.
  Ez a viselkedés **régebbi a javításnál** (a régi fájlon is zöld); semmi nem tesztelte, és a negatív kontroll
  nélküle nem bukott volna (lásd lent).

Negatív kontrollok a teljes `run-status.spec.ts`-en (43 teszt), a végső tesztfájllal:

| Kontroll | Bukott | Várt |
|---|---|---|
| a fájl a javítás előtti állapotában (`eb76773`) | 6 | a 6 előre jelzett eset, más semmi |
| a session a kiválasztás-ellenőrzés előtt ér véget | 1 | a C3-eset |
| a terv- és idővonal-olvasás 401-ét nem keresi | 5 | 4 mátrixeset + a meglévő terv-401 teszt |
| a bizonyíték-olvasás 401-ét nem keresi | 5 | 4 mátrixeset + a meglévő bizonyíték-401 teszt |
| a terv hibáját nem dobja tovább | 1 | a V1 tervhiba-tesztje |
| az idővonal hibáját nem dobja tovább | 1 | az új idővonal-teszt |

Egyik kontroll sem buktatott váratlan tesztet, és mindegyik után a fa hash-e egyezett a K2-t futtató fáéval.
A review extra ellenpróbái a javítás után: X1 history, X1 dry-run, C3, C4 — **4/4 zöld**.

**X2 — `504b8cd` (csak teszt).** A W3 első öntesztje a negatív kontroll alatt helyesen bukott (`undefined`
törzs), de az állítás még azelőtt dobott, hogy a teszt megvárta volna a visszatartott törzs olvasását
engedő időzítőt; a teardown bezárta a lapot, és az időzítő ezután hívta. Mindkét W3-önteszt most közvetlenül a
`release()` visszatérésekor elmenti az értéket, megvárja a függő munkát (az időzítőt, illetve a második
`release()`-t), és az elmentett értéken állít. Nincs utólagos pollozás vagy újraolvasás, így a korai visszatérés
továbbra is azon az értéken bukik, amelyet látott. A második tesztben nem mértem utólagos hibát, de ugyanaz volt
a szerkezete: a második `release()`-t egy dobható állítás után várta.

A W3 kontrollja (URL-darabszámos harness), 3-3 ismétléssel:

| Állapot | Bukott | Utólagos „has been closed” | Kezeletlen rejection | Időtúllépés |
|---|---|---|---|---|
| előtte | 6/6, `undefined` törzzsel | **2** (az első teszt 3 futásából 2-ben) | 0 | 0 |
| utána | 6/6, `undefined` törzzsel, 0,5–1,2 s alatt | 0 | 0 | 0 |

A valódi harnessszel a `harness.spec.ts` 3 ismétlésben **27/27**.

**A nap saját hibái és mérési leletei:**

1. **A negatív kontroll-futtatóm eldobta a Playwright kimenetét**, csak a teszt-címeket nézte — ezért a W3-nál
   nem is láthatta azt a második hibát, amelyet a review X2-ként talált. Most futásonként menti a naplót, és
   külön számolja a bezárt-lap és a kezeletlen-rejection hibákat; az X2 „előtte” mérése a számláló pozitív
   kontrollja.
2. **Az új titokkeresőm első futása hamis találatot adott**: a `.env` `HOST=127.0.0.1` értékét titokként
   kereste. A loopback- és dokumentációs címek kizárva; önteszt minden ellenőrzésre (UTF-16 is), és egy valódi
   helyi titokérték beültetése egy listázott fájl másolatába — a kereső megtalálja, értéket nem ír ki.
3. **Az idővonal-hiba továbbdobása megfigyelhetetlen őr volt**: a hatodik kontroll először egyetlen tesztet sem
   buktatott. Új teszt, amely a régi viselkedést rögzíti; utána a kontroll bukik.
4. A hat kontrollt először az idővonal-teszt előtt futtattam — mind a hatot újrafuttattam a végső tesztfájlon,
   a táblázat azt mutatja.
5. **Két K2 az X1 fáján nem volt tiszta** (lásd a kapukat). A harmadik, az X2 fáján tiszta volt. A
   TIME_WAIT-csúcs a tiszta futásban is ugyanakkora volt (**1062**; a két hibásban 1070 és 1045), tehát ez a
   mérés sem támasztja alá a TIME_WAIT-hipotézist.

**Érintett fájlok:** `client/src/components/dd-admin-shell.ts`, `client/e2e/run-status.spec.ts`,
`client/e2e/harness.spec.ts`; dokumentáció: a review mappája és jelentése, ez a napló, az átadási csomag.

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód, auth, CSRF, DTO változatlan.

**Parancsok, exit-kódok** (commitonként, a commit fáján):

| Commit | K1 | K2 | CSP |
|---|---|---|---|
| `d0f28fe` X1 | exit 0 — 864 + 203 | 1. futás: 297 + **2 bukás** (`accessibility.spec.ts` h1-teszt, `simulation-control.spec.ts` mode/network-teszt); 2. futás: 298 + **1 bukás** (`freshness.spec.ts` helyreállítás-teszt). Mind a három bukott teszt trace-ében `net::ERR_NO_BUFFER_SPACE`; az első kettőnél a hibás kérés egy modulé (`src/lib/freshness.ts`, `src/lib/format.ts`), a harmadiknál a trace-t egy későbbi futás már törölte, a napló a `dd-shell.ts` dinamikus importjának hibáját mutatja. A három teszt célzott újrafuttatása 3/3 zöld | 4 |
| `504b8cd` X2 | exit 0 — 864 + 203 | **299, első futásra tiszta**; a K2 naplójában 0 kezeletlen rejection | 4 |

A két hibás K2 naplójában a kezeletlen rejection-sorok („Failed to fetch dynamically imported module”) pontosan a
bukott tesztekhez tartoznak, és a fenti hálózati hibák következményei. Az `504b8cd` fája az X1 kódját is
tartalmazza (az X2 csak egy harness-önteszt), ezért **az ág kódfejére van tiszta, első futású K2**; magára a
`d0f28fe`-re nincs. A projekt szabálya szerint a két hibás futás nem siker, hanem rögzített környezeti tétel
(átadási csomag, 8. pont).

K3 az `504b8cd`-n, az eldobható mongodon (27018, `~/devnet-mongo-itest`, ellenőrizve): exit 0 — 15 fájl,
**98** teszt, 8 kihagyott (a Mongo nélküli párdarabok). A review ellenpróbái az `504b8cd`-n: a korábbi öt
(W1–W4, C2) **5/5 zöld**, az új négy (X1 ×2, C3, C4) **4/4 zöld**.

**Valódi laborfutam:** NEM FUTOTT.

```text
Commit(ok), végső SHA: 6b07a8b (review-dokumentumok), d0f28fe, 504b8cd, + ez a dokumentációs commit
Végső git státusz: a saját munkám commitolva; öt követetlen ops/c2-*.sh más munkából, érintetlenül
Napi státusz: ELLENŐRZÖTT — a független újra-review még nem történt meg
Éles deploy: NEM TÖRTÉNT
```

## Deploy 2026-09-14 – a 11–20. nap és a J1–J8 élesre kerül

```text
Dátum / végrehajtó: 2026-09-14 / Claude Opus 5 (1M)
Telepített SHA: 5237f80 (main a #176 és a #177 merge után); előtte a VPS-en 83b8710 (#163), azaz 78 commit
Engedély: a tulajdonos kifejezett engedélye („szinkron+deploy mehet vpsre”), a negyedik független review után
Hatókör: ops/deploy.sh a VPS-en — szerver és kliens. Nginx-konfig, CSP, flotta, node, adatbázis nem érintve
```

**Előtte — kapuk a mergelt mainen** (`3a999eb`; a `5237f80` ehhez képest csak az öt `ops/c2-*.sh`
szkriptet adja, kliens- és szerverkód nem változik): K1 exit 0 — 864 + 203 unit; K2 **299/299** első
futásra, `ERR_NO_BUFFER_SPACE` nélkül; K3 98 (8 kihagyott); CSP 4/4.

**Előtte — a VPS, csak olvasással:** app `83b8710`, tiszta munkafa; a szolgáltatás 2026-09-12 16:17 óta
fut; health 200; kiszolgált bundle `index-CkY3rdOC.js`. Új `.env`-kulcs nem kell: a
`83b8710..5237f80` különbségben az egyetlen új környezetiváltozó-olvasás integrációs tesztben van; a
szimulátor lánc-azonosító pinjei megvannak. Az élő fejlécek rögzítve (`/`, `/api/v1/health`, `/rounds`,
`/admin`, ismeretlen útvonal): az `/api/v1/health` válaszában **két** `Strict-Transport-Security`.

**Deploy:** 01:19:46Z–01:20:47Z, exit 0. Pull (fast-forward `83b8710..5237f80`), `npm ci`, build,
rsync a webrootba, restart (01:20:39Z), readiness: az API azonnal válaszolt, `status: ok`, `chainTip`
= `indexedHeight` = 13028, `behind` 0. A naplóban az egyetlen figyelmeztetés („MongoDB disconnected”) a
régi folyamaté (SIGTERM utáni leállás); az új folyamat tisztán indult.

**Utána — mérve:**

| Mit | Eredmény |
|---|---|
| VPS | app `5237f80`, tiszta munkafa; a `client/dist` és a webroot **azonos** (`diff -rq`); kiszolgált bundle `index-CNPCV91P.js` — ugyanaz a név, mint a helyi buildé ugyanabból a kliensforrásból |
| Lockfile | a VPS `package-lock.json` sha256-ja `2f72d372…ffb78`, byte-azonos a repóéval — a 13. napi `body-parser` javítás élesben |
| `npm audit --omit=dev` a VPS-en | 2 moderate: `qs`, az `express`-en át — pontosan az elfogadott F13-maradék |
| Szolgáltatás, 01:32:06Z | aktív, 0 újraindulás; health `ok`, tip = indexed = 13033, `behind` 0; az új folyamat 59 naplósorából 0 warn, 0 error |
| Fejlécek, az előtte-állapothoz képest | **egyetlen különbség:** az `/api/v1/health` válaszából eltűnt a helmet HSTS-e — **egy** maradt, az nginxé (a 20. napi `694d5cc` élesben mérve) |
| A 17–19. nap oldalai | `/simulations`, `/search`, `/methodology`: 200 `text/html`; `favicon.svg`: 200 |
| Bundle | az új 200, `Cache-Control: public, max-age=31536000, immutable`; a régi 404 (az rsync `--delete`) |
| Router | hibás escape 400; ismeretlen API-útvonal JSON 404 |
| Publikus API | `/api/v1/simulations?limit=25`: 200, `success: true`, 0 futam; `/api/v1/chainlocks`: 200 |
| Valódi böngésző (élő oldal) | Overview, Simulations, DKG Rounds, Admin betölt; az Overview hét API-hívása 200; az Admin a belépési képernyőt mutatja, a `/api/v1/admin/session` 401-e a várt „nincs session” |

**Két megfigyelés, nem a deploy okozta — a deploy előtt is így volt:**

1. **A report-only CSP semmit nem gyűjt.** Az nginx `Content-Security-Policy-Report-Only` fejlécében nincs
   `report-uri` és `report-to` — ez a runbook szerint **szándékos** (nincs gyűjtő ezen a telepítésen) —, így
   valós forgalomból nem érkezik jelentés, a sértés csak az oldalt megnyitó böngésző konzoljában látszik. Ezért
   a „valós forgalmat is lásson” indok e nélkül nem teljesül. A böngészőkonzol mind a négy
   oldalon egyetlen üzenetet adott: az `upgrade-insecure-requests` direktíva report-only módban hatástalan.
   CSP-sértést nem mutatott.
2. **Az `/api/` válaszain duplikált, részben ellentmondó biztonsági fejlécek.** A helmet és az nginx is
   küld `X-Frame-Options`-t (`SAMEORIGIN` és `DENY`), `Referrer-Policy`-t (`no-referrer` és
   `strict-origin-when-cross-origin`) és `X-Content-Type-Options`-t, a helmet pedig egy saját CSP-t. JSON-
   válaszon gyakorlati hatása nincs; a HSTS-duplikáció megszűnt, a többi nem volt a 20. nap célja.

**Ami nem történt meg:** a CSP enforce-ra váltása (átadási csomag 10. pont, 4. lépés) — külön engedélyre vár.
**Tulajdonosi döntés, 2026-09-14:** a live szimulátor laborelfogadása **nem kerül tervbe**; a live mód
ezért nem elfogadott, a megfigyelő webfelület élesben fut.

```text
Telepített SHA: 5237f80
Napi státusz: TELEPÍTVE, élőben mérve — a CSP enforce-ra váltása nyitott; laborfutam: nem kerül tervbe
Éles deploy: MEGTÖRTÉNT (szerver + kliens, ops/deploy.sh)
```

## CSP enforce 2026-09-14 – a report-only házirend érvénybe lép

```text
Dátum / végrehajtó: 2026-09-14 / Claude Opus 5 (1M)
Engedély: a tulajdonos kifejezett engedélye (a deploy-rögzítés után, „folytasd”)
Hatókör: egyetlen nginx-snippet cseréje a runbook szerint (/etc/nginx/snippets/deftrack-csp.conf); a vhost,
  a többi fejléc, a szerver és a kliens nem változott
```

**Előtte, csak olvasással:**
- Az élő snippet házirend-sora byte-azonos a repó `ops/nginx/csp-report-only.conf`-jáéval.
- Az enforce fájl ugyanezt a szöveget hordozza, csak a fejléc neve más (`diff` üres).
- A vhost a snippetet a `server` blokkban, az `= /index.html` és az `/assets/` locationben emeli be; az
  nginx.conf nem használ `snippets/*` globot.
- Az admin belépés `fetch`, a két `<form>` (keresés, szimuláció-előkészítés) `preventDefault()`-ot hív, így
  a `form-action 'none'` nem blokkol valós műveletet.

**Csere, 02:07:57Z:**
- A feltöltött `csp-enforce.conf` sha256-ja (`18b43187…2d842e`) egyezett a helyivel.
- Mentés: `/root/nginx-backups/deftrack-csp.conf.report-only-20260914-040757` (az nginx-konfig fán kívül).
- `install`, `nginx -t` rendben, `systemctl reload nginx`. A szkript hibás `nginx -t` esetén
  visszamásolta volna a mentést, és nem töltött volna újra.

**Utána — fejlécek (curl):**
- A `Content-Security-Policy` (enforce) megvan ezeken: `/`, `/rounds`, `/admin`, SPA-fallback útvonal,
  content-hash-elt asset, valódi 404 (`/assets/nope.js`).
- `Content-Security-Policy-Report-Only` sehol nincs.
- A többi fejléc változatlan; az `/api/` alatt továbbra is egy HSTS.
- Az `/api/v1/health` válaszán most két *érvényes* CSP van (a helmeté és az nginxé), JSON-válaszon hatás
  nélkül. Ez a 2026-09-14-i duplikált-fejléc megfigyelés része.

**Utána — valódi böngésző az élő oldalon:**

| Mit | Eredmény |
|---|---|
| A dokumentum tényleg enforce alatt fut | cache-kerülő URL-lel betöltve; a friss válasz `content-security-policy` fejléccel, `…-report-only` nélkül |
| Pozitív kontroll | egy befecskendezett inline `<script>` **nem futott le**; `securitypolicyviolation`: `script-src-elem`, `disposition: enforce`, `blocked: inline` |
| 17 útvonal az alkalmazás routerével, egy dokumentumban, egy `securitypolicyviolation`-figyelővel | **0 sértés**: Overview, PoSe Watch, Masternodes, ChainLocks, Sentinel Layer, Staking, Vantage points, Experiments, Simulations, Blocks, Transactions, Operators, Fairness, How we measure, Search (`?q=13000`), Block 13,000, DKG Rounds; minden oldal a saját `h1`-ével renderelt. A számolt `style=` attribútumos oldalak is (Staking 22, Fairness 56, Sentinel Layer 4, ChainLocks 3) |
| Fejléc-keresés elküldése (`requestSubmit`) | a keresés a 13000-es blokkra vitt, 0 sértés. A konzol 3 hibája a keresés saját próbája (`/api/v1/experiments/13000` → 404: „nem futamkulcs”, `client/src/lib/search.ts:160`), nem CSP |
| `/rounds` friss betöltés | a konzol üres — a report-only módban látott `upgrade-insecure-requests`-megjegyzés enforce alatt eltűnt |
| `/admin` friss betöltés | a belépési képernyő renderelt (az admin chunk betöltött); az egyetlen konzolüzenet a várt `/api/v1/admin/session` 401 |

**Mérési megjegyzés — a tulajdonos ugyanabban a böngészőben követte a mérést.** A fül a hívásaim között
`/admin` → `/` → `/blocks` → `/` útvonalra váltott. Az nginx access-log szerint 04:11:39-kor ugyanabból a
böngészőből egy `POST /api/v1/admin/session` ment ki, 404-gyel. Ez a „Continue to admin dashboard” gomb, a
szerver zárt válaszával: „browser sign-in is not enabled on this deployment”,
`server/src/routes/v1/adminSession.v1.routes.ts:49-51`. A navigációk és a gombnyomás a tulajdonostól
jöttek, aki nézte, mit csinálok; utólag megerősítette. A mérés ettől érvényes:
- az útvonal-bejárás egyetlen, lapon belüli szkriptben futott — egy közbenső navigáció megszakította volna,
  és mind a 17 lépés a várt oldalt látta;
- az admin-ellenőrzés egymás utáni betöltés → snapshot → konzol sorrendben készült;
- a kliensben nincs programozott navigáció a `/`-re; a váltásokat nem az oldal okozta.

A production admin oldalon inline-script-próbát az ügynök-jogosultság nem engedett; a pozitív kontroll a
publikus oldalon készült, ugyanazzal a snippet-házirenddel.

**Visszaállítás, ha kell:** a mentés visszamásolása a snippet helyére, `nginx -t`, `systemctl reload nginx`
— a vhosthoz nem kell nyúlni.

```text
Napi státusz: ÉLESBEN, mérve — a CSP enforce alatt fut
Éles módosítás: MEGTÖRTÉNT (egy nginx-snippet; mentés a VPS-en)
```

## MongoDB-mentés 2026-09-14 – telepítve, két ellenőrzött futás

```text
Dátum / végrehajtó: 2026-09-14 / Claude Opus 5 (1M) — a telepítés és a visszaállítás-próba az előző ügynöké,
  ez a bejegyzés a 11:29Z-s csak olvasó ellenőrzéssel rögzíti
Engedély: a tulajdonos engedélye a #180 telepítésére
Hatókör: /usr/local/sbin/deftrack-mongo-backup, /etc/deftrack-backup/mongodump.yaml (600),
  /var/backups/deftrack-mongo/ (700/600), deftrack-mongo-backup.{service,timer}; runbook: MONGO_BACKUP_RUNBOOK_HU.md
```

**A VPS journaljából, 11:29Z** (a szkript saját összegző sora):

| Futás (UTC) | Archívum | Méret | Gyűjtemény | Dokumentum | Idő |
|---|---|---|---|---|---|
| 03:12:03 (kézi, első éles) | `deftrack_devnet-20260914T031203Z.archive.gz` | 20 315 669 bájt | 26 | 560 104 | 5 s |
| 03:39:55 (időzítő) | `deftrack_devnet-20260914T033955Z.archive.gz` | 20 331 432 bájt | 26 | 560 619 | 6 s |

- **Az unit utolsó futása:** `Result=success`, `ExecMainStatus=0`.
- **Következő futás:** 2026-09-15 03:44:18Z. Az időzítő 03:30 UTC-t és legfeljebb 15 perc késleltetést ad.

**A visszaállítás-próba** az előző ügynök átadási jegyzete szerint készült; ezt nem ismételtem meg:
- a helyi, eldobható mongodra (27018), átnevezett névtérbe állította vissza az archívumot;
- 560 104 dokumentum, mind a 26 gyűjtemény darabszáma egyezett a manifesttel, 125 index-definíció;
- utána a névteret törölte.

**Nyitott:** a gépen kívüli mentés helye tulajdonosi döntésre vár. Az archívum nem publikus host-címeket tartalmaz,
ezért csak privát hely jöhet szóba. Jelenleg az egyetlen gépen kívüli példány egy kézi másolat az implementáló
gépén.

## Deploy 2026-09-14 (#181) – a pooled RPC-kapcsolatok 15 s után zárulnak

```text
Dátum / végrehajtó: 2026-09-14 11:19:27–11:20:13Z / Claude Opus 5 (1M)
Engedély: a tulajdonos kifejezett engedélye („a #181 telepítése a main-ről”); a független review (Astra)
  APPROVED, egy nem blokkoló P3-mal
Hatókör: ops/deploy.sh a main 65dcadf-jén (#178–#181); a nodeokhoz és a mongodhoz nem nyúlt; a #182 nem
```

**Előtte:**
- **Ellenőrzés közvetlenül a deploy előtt:** `origin/main` = `65dcadf`, a #182 `OPEN`; a VPS app `5237f80`, tiszta
  munkafa; a VPS is `65dcadf`-et látott az `origin/main`-en.
- **Terhelés mindkét mérési ablakban:** egy látható böngészőlap (Playwright), a nyilvános Overview oldal, 30 s-os
  health-polling. A lap 10:45:00Z-től a mérés végéig `visible` maradt.
- **RPC-kapcsolatok mintavétele:** csak olvasó szkript, 5 s-onként, az explorer processz kapcsolatai a seed RPC-portjára
  (forrásport-listák). Kimenet a helyi gépen, a VPS-re nem írt.

**Deploy:** `Updating 5237f80..65dcadf`, `npm ci`, build, rsync, restart 11:20:07Z, readiness azonnal `ok`, kiszolgált
bundle `index-CNPCV91P.js` (a kliens nem változott), exit 0.
- **Az egyetlen `warn` sor** („MongoDB disconnected”) a **régi** processzé (PID 782617), 24 ms-mal a
  „SIGTERM received” után.
- **Az új processz (806642)** tisztán indult, 0 újraindulással.

**Mérés, két egyenlő, 30 perces ablak:**

| | Előtte, 10:50:07–11:20:07Z | Utána, 11:20:08–11:50:07Z |
|---|---|---|
| journal | 102 info, 0 warn, 0 error | 116 info, **0 warn, 0 error** |
| `socket hang up` / transzporthiba sor | 0 | 0 |
| különböző RPC-kapcsolat a mintákban | 29 (0,97/perc) | **61 (2,03/perc)** |
| átlagosan nyitott RPC-kapcsolat mintánként | 1,82 | 2,21 |
| health-válaszidő (böngésző, 200-asok) | 61 kérés 10:45–11:00: p50 80 ms, p90 353 ms, max 808 ms; 8 kérés 11:18–11:20: p50 54 ms | 118 kérés: p50 60 ms, p90 112 ms, max 613 ms |

**Amit ez bizonyít, és amit nem:**
- **A hibaszám nem bizonyít semmit.** A deploy előtti 30 percben ugyanezzel a terheléssel egyetlen `socket hang up`
  sem volt. A napi 35 (02:18–03:54Z) + 4 (04:00–04:26Z) hiba más terhelés mellett keletkezett. A „0 → 0” összhangban
  van a javítással, de nem igazolja.
- **A mechanizmus mérhető.** Az új kapcsolatok száma kb. megduplázódott, miközben az egyszerre nyitott kapcsolatok száma
  alig nőtt. Ez a 15 s-os tétlen-zárás várt nyoma: a 20 s-os sync-tick és a 30 s-os poll most új kapcsolatot nyit.
  - A mintavétel 5 s-os, a rövidebb életű kapcsolatokat nem látja, ezért mindkét szám alsó becslés.
  - Az arány a becsült érték, nem a két abszolút szám.
- **A válaszidő nem romlott.** A p50 hasonló, a p90 és a max kisebb. Egyetlen lap és kis minta; nem terhelésmérés.

**Mellékesen talált, nem a #181 okozza:** a mérés alatt egyetlen health-kérés **503**-at kapott (11:31:57Z az nginx
szerint). A válasz törzsét nem láttam: a `sync-stalled` ok a lenti kódból és időpontokból levezetett, nem kiolvasott
érték.
- **Ok, kódból és naplóból:** az indexelő a `lastSyncedAt`-et csak új blokk írásakor frissíti
  (`server/src/services/sync.service.ts:405-417`); a tétlen tick csak a `heartbeatAt`-et (`:372-373`). A readiness
  viszont a `lastSyncedAt`-ből számolja a tétlenséget (`server/src/index.ts:106`, `server/src/domain/readiness.ts:53`).
  Így egy 5 percnél hosszabb blokk-köz után az új blokk érkezésétől a következő tickig (≤ 20 s) `behind 1` és
  „5 percnél régebbi szinkron” áll fenn: 503.
- **Mérve:**
  - 13271 indexelve 11:26:49.6Z, 13272 header-idő 11:31:46Z, az 503 11:31:57Z, indexelve 11:32:09.7Z;
  - ugyanez a deploy előtt: 13242 10:15:47.7Z, 503-ak 10:21:16 és 10:21:26 (egy másik böngészőből), 13243 10:21:27.7Z.
- **Gyakoriság:** mért 161,6 s-os átlagos blokkidővel a blokkok kb. 16%-a előtt nagyobb a köz 5 percnél.
- **Nincs rá jegy; javítás külön döntéssel.**

```text
Napi státusz: ÉLESBEN, mérve — a #181 fut (65dcadf)
Éles módosítás: MEGTÖRTÉNT (szerverkód; a kliens-bundle változatlan)
```

## Bináris-takarítás 2026-09-14 – 50 daemon-mentés törölve, md5 szerint

```text
Dátum / végrehajtó: 2026-09-14 10:44–10:49Z / Claude Opus 5 (1M)
Engedély: a tulajdonos kifejezett engedélye, megtartandó md5-listával
  (5c8fab67, c9898910, 6987a13b, d555bdaa, 83409a08, 455d516e)
Hatókör: csak /usr/local/bin/defcond.bak-* és defcond-nobdb.bak-*; a CLI- és hook-mentésekhez nem nyúltam
```

**Előtte, csak olvasással (10:44:33–10:45:29Z):**
- 54 daemon-mentés, mind különböző md5-tel: 28 `defcond.bak-*` és 26 `defcond-nobdb.bak-*`, együtt 16,71 GB.
- A futó binárisok: seed `5c8fab67…` (`/usr/local/bin/defcond`), devnet2 `c9898910…` (`defcond-nobdb`).
- Unit- és drop-in-hivatkozás `.bak` binárisra nincs. Az aktív unitok `ExecStart`-jai: `defcond`, `defcond-nobdb`,
  `defcon-enable-staking`. Két régi unit-mentés (`*.service.bak-20260910-0953`) is ezekre mutat.
- A megtartandó négy mentés a C2 visszaállítási célpontja: `6987a13b` és `d555bdaa` (`.bak-20260913-2212`), valamint
  `83409a08` és `455d516e` (`.bak-20260913-2006`).

**Törlés (10:48:03–10:48:50Z):**
- A szkript minden fájlnál abban a pillanatban újraszámolta az md5-öt, és csak akkor törölt, ha:
  - az egyezett a listázottal;
  - nem volt a megtartandók között;
  - nem a futó exe volt;
  - a név `defcond.bak-` vagy `defcond-nobdb.bak-` alakú volt.
- Előtte egy WSL-beli álkönyvtáron kipróbáltam mind az öt ágat: egyező → törölve; megváltozott, megtartandó, hiányzó és
  rossz nevű → kihagyva; listán kívüli → érintetlen.

**Utána:**

| Mit | Eredmény |
|---|---|
| Törölve / kihagyva | **50 / 0** |
| Lemez | foglalt 47 G → 33 G |
| `/usr/local/bin` | 17 G → 2,5 G |
| Megmaradt daemon-fájlok | pontosan a hat megtartandó md5 |
| Futó md5 | seed `5c8fab67`, devnet2 `c9898910` — változatlan; mindkét unit `active` |

**Nem törölve:** 9 `defcon-cli.bak-*`, 3 `defcon-cli-nobdb.bak-*`, 2 `defcon-enable-staking.bak-*`, együtt kb.
200 MB. A megtartásukról nem született döntés.

```text
Éles módosítás: MEGTÖRTÉNT (fájltörlés a /usr/local/bin-ben; szolgáltatás nem változott)
```

## VPS karbantartási ablak – előkészítés és két review-kör (a futtatás még nem történt meg)

```text
Mit: friss mentés → MongoDB 8.0.29 → 8.0.32 és Node 24.19 → 24.21 (rögzített verziókkal) → reboot a felrakott
  linux-image-6.8.0-139 és az új libc6 miatt; a #181 külön lépés
Állapot: NEM FUTOTT — a második review-kör eredményére és a tulajdonos indítási engedélyére vár
```

**Időzítési lelet a csak olvasó előkészítésben:**
- A 13104 = 144·91, vagyis a 24-, 48- és 72-es ciklus közös bázisa.
- Az átadott szkript őre csak a Q60 24-es ciklusát nézte (a `-gt 31` felső határa `h % 24 ≤ 23` miatt sosem
  teljesült). Így a +19-es kezdés után a reboot a 13124-ben nyíló `llmq_60_75` [+20,+36] és `llmq_400_60`
  [+20,+28] bányászati ablak elejére esett volna (`src/llmq/params.h`).
- A seed `quorum list`-je az `llmq_400_85`-öt (576, [+20,+48]) is mutatja.
- A `dpkg --audit && echo` `set -e` alatt nem állította volna meg a rebootot, és a csomagverziók nem voltak rögzítve.

**1. review-kör (Astra), CHANGES REQUESTED**, négy jegy:
- MW1/P1: a kiesés nem volt a tiltott sávhoz kötve; nem volt visszatérési időkeret és folytatási terv;
- MW2/P2: a diagnosztikai `grep | head/tail` pipefail mellett megakasztotta a hibakezelést — reprodukálva, exit 1 és
  141;
- MW3/P2: a minter visszatérésének elfogadása nem volt bizonyító erejű;
- MW4/P2: a snapshot kimenete nem publikálható automatikusan.

**Tulajdonosi döntések:**
1. kemény feltétel csak a Q60-ablak (+10…+18); a 48/72/576-os ablakot a szkript kiírja, és megfigyelési résként
   rögzítjük;
2. MW4-re átmeneti megoldás: privát kimenet, publikálás csak kézzel, titokkereséssel;
3. a javítás mehet.

**2. kör, beadva:**
- Két fázis:
  - `prep`: mentés Result/ExecMainStatus + új, checksummal ellenőrzött archívum; hétcsomagos előfeltétel; audit előtte
    és utána; FCV `8.0` a mongod naplójából; conffile-őr; rögzített verziók;
  - `reboot`: külön lépés, friss tip, legalább 12 blokk tiszta sáv, tehát csak +19/+20/+21.
- Mért visszatérési idők: utolsó boot 3 perc 25 s, ebből 2 perc a `systemd-networkd-wait-online` timeoutja; a seed
  leállása 5 s, az indulása ~1 s. Költségvetés 10 perc, VNC-eszkaláció, számszerűsített maradék kockázat.
- A teljes szkript tesztje PATH-csonkokkal: 27 eset zöld; 10 mutánsból 9 harap, egy szándékosan rétegzett őr
  egyedül nem.
- Elfogadási szkript két mintával. Élő száraz futása a reboot előtt pontosan a várt hét hibát adta, és semmit nem
  írt.

**2. review-kör, CHANGES REQUESTED.**
- Lezárva: MW1, MW2, és MW4 az elfogadott átmeneti eljárásra. MW3 részben.
- A reviewer 27/27 tesztkeret-esetet, 8/8 verify-öntesztet és egy élő, írásmentes száraz futást (VERDICT FAIL (7))
  ismételt meg.
- Négy új P2:
  - MR2-1: túl korai vagy blokk nélküli párnál is PASS, és hibánál is exit 0;
  - MR2-2: a 100 blokkal lemaradt devnet2-t is elfogadja;
  - MR2-3: egy másik fájl checksum-sorával is továbbenged;
  - MR2-4: az FCV-kapu bármely eseményből vagy régi startup-sorból következtet.
- **Az én hibám is:** a mérési dokumentumban a `TimeoutStartUSec` és a `TimeoutStopUSec` fel volt cserélve, mert a
  `systemctl show -p A,B --value` a systemd sorrendjében ír.

**3. kör, beadva:**
- **Verify:** háromállapotú verdikt (ACCEPTED 0 / PENDING 2 / FAIL 1), `sample_ok`, tényfájlos kaputeszt 14 esettel és
  7 negatív kontrollal. A devnet2-t külön is méri: header, tip-kor, legfeljebb 2 blokk a seedtől, haladás a párban.
- **Checksum:** pontosan egy sor, pontosan az archívum neve, és az archívum saját sha256-ja.
- **FCV:** a futó mongod indulásakori `id 5853300` startup-bejegyzés és az azutáni FCV-események. Az élő
  `getParameter`-olvasásra a vizsgált olvasó felhasználó (`devnet_ro`) nem jogosult (mérve: „not authorized on
  admin”). Más jogosult felhasználót nem vizsgáltunk, és a rendelkezésre álló hitelesítő adatok között nincs ilyen.
  Erről tulajdonosi döntés kell.
- **Tesztkeret:** 37 eset és 14 mutáns, gépileg ellenőrzött kijelölt esetekkel.

A csomagok a repón kívül vannak:
- `D:\www\devnet .deftrack-review-artefacts\2026-09-14-maint-window\` (1. kör, benne a review `review\`
  alkönyvtára);
- `…\2026-09-14-maint-window-r2\`, `SHA256SUMS` sha256 `f93a267c3680f4b06ef6101ff977dfba3f1a16035ed3e9cc89916070815f130b`;
- `…\2026-09-14-maint-window-r3\` (3. kör), `SHA256SUMS` sha256 `5a567910192be5762ef2062110e1dc32c63fe295f22dacf28042a937fdd0628b`.

**3. review-kör, CHANGES REQUESTED, egy P2:**
- **Lezárva:** MR2-1, MR2-2, MR2-3 és MW3.
- **A reviewer ismételt futásai:** 37/37 és 14/14 mutáns; 14/14 verify-kaputeszt; 7 negatív kontroll; azonos minta
  ismétlése PENDING; élő száraz futás FAIL (7), exit 1.
- **MR3-1 (az MR2-4 maradéka):** a `t < start - 5` öt másodperccel a processz indulása elé engedte az FCV-bizonyítékot.
  A reviewer a teljes prepben reprodukálta (startup 4 s-mal az indulás előtt → exit 0, mentés, apt, marker).
- **A reviewer az FCV-bizonyítékról:** a javítás után ehhez az egyszeri, 8.0-n belüli patch-művelethez technikailag
  elfogadható, korlátozott helyettesítő bizonyíték, tulajdonosi elfogadással. Nem élő `getParameter`-olvasás.

**4. kör, beadva:**
- **FCV-kötés:** szigorú `t < start` és mikroszekundumos UTC indulási idő (`--timestamp=us+utc`). A másodperces
  bélyeg egy másodpercen belüli rést hagyna; mikroszekundum nélküli bélyeg → 12.
- **Új határesetek:** −4 s, −1 s, −69 ms (ugyanabban a másodpercben) → 12; +31 ms → 0.
- **Új mutánsok:** a tűrés visszaírása, a másodperces indulási idő, a formátumellenőrzés hiánya — mind a kijelölt
  eseteken harap. Összesen 42 eset és 17 mutáns.
- **A mutáns-futtató szigorítása:** a hibás `sed`, az üres vagy érvénytelen szkript és a 3 sornál nagyobb változás
  érvénytelen kontroll, és nem nulla kilépést ad.
- **Élő, csak olvasó futás** (csak az FCV-függvény): „FCV at the running mongod's startup 2026-09-11T04:41:23.143000Z
  (process started 2026-09-11T04:41:21.169185Z): 8.0; later FCV events: none”, rc 0.
- **Csomag:** `…\2026-09-14-maint-window-r4\`, `SHA256SUMS` sha256
  `55e8f71cb5578baac8a4752b324f97cd557eafee91d5fab652a395d292855053`.

**4. review-kör: APPROVED** a runbook szerinti végrehajtásra. Az MR3-1 és vele az MR2-4 lezárva; minden jegy
lezárva, új nincs. A reviewer ismételt futásai:
- 42/42 eset, 17/17 mutáns a kijelölt eseteken, 14/14 verify-kaputeszt;
- a saját FCV-reprodukciója most elutasít; a mikroszekundumos határ ellenpróbái: .169 elutasítás, .170 elfogadás
  a .169185-ös indulásnál.

Indítás előtt két dolgot kellett rögzíteni: a tulajdonosi FCV-döntést és a „mehet”-et. A futtatás a következő
szakaszban van.

## VPS karbantartási ablak – futtatás 2026-09-14 13:24–13:37Z

```text
Dátum / végrehajtó: 2026-09-14 / Claude Opus 5 (1M)
Engedély: a tulajdonos „mehet folytasd készre vpsre” (13:2xZ) — az ablak, az FCV-helyettesítő bizonyíték
  elfogadása (a runbook 0. pontja) és az, hogy közben nem fut más beavatkozás a VPS-en
Szkriptek: vps-maint.sh 0d9dfe64… (4. körben APPROVED); vps-maint-verify.sh az elfogadáshoz 8147a18c… (lent)
Hatókör: mentés, MongoDB 8.0.32 + Node 24.21.0, reboot a 6.8.0-139-es kernelre; alkalmazás-deploy nem történt
```

**0. lépés, csak olvasva (13:24Z):**
- tip 13314; a seed és a devnet2 hash-e egyezik; 171 peer;
- health `ok`; futó md5 `5c8fab67`/`c9898910`; mongod 8.0.29, node 24.19.0;
- failed unit: `cloud-init`, `systemd-networkd-wait-online`;
- flotta: `hosts=16 instances=160 same-chain=160 forked=0 unreachable=0`;
- futó frissítés nincs: az egyetlen `unattended-upgr` folyamat a boot óta várakozó
  `unattended-upgrade-shutdown --wait-for-signal`, az `apt-daily` unitok inaktívak.

**Végrehajtási eltérés a runbooktól — a szkript változatlan:**
- A szkript nem `bash -s`-sel, SSH-csatornáról olvasva futott. A pontosan review-zott fájl feltöltve a VPS-re
  (`/root/maintenance-20260914/vps-maint.sh`); a sha256-ja egyezett.
- `systemd-run --wait` tranziens unitként futott, így egy SSH-szakadás az apt közben nem állíthatta volna le. A
  kimenet a journalban is megvan.

**1. lépés, `prep` (13:27:38–13:28:12Z, 34,6 s, exit 0):**
- **Előfeltételek:** a hét csomag 8.0.29-en, a node 24.19.0-n, audit tiszta. Élő FCV-bizonyíték: „FCV at the running
  mongod's startup 2026-09-11T04:41:23.143000Z (process started 2026-09-11T04:41:21.169185Z): 8.0; later FCV events:
  none”.
- **Mentés:** `deftrack_devnet-20260914T132739Z.archive.gz`, 20 805 205 bájt; a saját sha256-ja egyezik a
  sidecarral, a manifest megvan.
- **apt:** 8 csomag frissítve; audit tiszta; a verziók a rögzítettek; a `mongod.conf` változatlan, új conffile-másolat
  nincs.
- **Utána:** a mongod (8.0.29) és az explorer (node 24.19.0) a régi processzen futott tovább, a health `ok` maradt.

**2. lépés, `reboot`:**
- A szkript 13:28:56Z-kor kérte, a 13316-os magasságon (+20): `blocks=13315`, `headers=13316`, tip-kor 182 s. A
  48-as ablakot (`llmq_60_75`, a 13316-nál nyílik) megjegyzésként rögzítette, a tulajdonosi döntés szerint
  megfigyelési rés.
- Az új boot 13:29:05Z-kor indult, az SSH 13:29:21Z-kor válaszolt. A `systemd-networkd-wait-online` ezúttal kb.
  10 s alatt végzett, nem timeoutolt, így minden unit 13:29:16–22Z között elindult.

**Kiesési határok** (nem pontos kiesés):

| Esemény | Idő (UTC) |
|---|---|
| A seed utolsó tipje a leállás előtt (13315) | 13:28:28 |
| `defcond-devnet` Stopping / Stopped | 13:28:57 |
| Az előző boot utolsó journal-bejegyzése | 13:28:58 |
| A mostani bootban Started | 13:29:16 |
| „Done loading” | 13:29:18 |
| Első tip (13316) | 13:29:26 |

- A 13316-os blokk header-ideje 13:28:26Z volt: a seed a headert már ismerte, a blokkot a reboot után kapcsolta be.
- A seed kiesése kb. 21 s, a Q60-sávon (+10…+18) kívül.
- Az explorer első két, átmeneti sora (13:29:19Z): warn „no authenticated masternode among the peers”, error
  „getbestchainlock: Unable to find any ChainLock”. Transzporthiba nem volt.

**Elfogadás — a review-zott verify egy élesben talált hibája, és a javítása:**
- **A hiba:** a 4. körben jóváhagyott verify (`24b6ec48…`) írásmentes futása `VERDICT FAIL (1)`-et adott, 26 PASS
  mellett. Egyetlen FAIL: „failed units 'cloud-init.service' differ from the known set …”. A reboot után a
  `wait-online` már nem bukott; az egyenlőségvizsgálat tehát eggyel **kevesebb** hibás unitot is bukásnak vett, a
  runbook szándéka („nincs új failed unit”) ellenére.
- **A javítás:** egyetlen logikai pont — egy failed unit csak akkor FAIL, ha nincs az ismert készletben — és három új
  kaputeszt-eset. A többi kód byte-azonos (`8147a18c…`).
  - kapu: 17/17;
  - negatív kontrollok: a régi egyenlőség visszaírva pontosan a „recovered” esetet buktatja, az „új unit nem hiba”
    mutáns pontosan a „new failed unit” esetet;
  - ShellCheck tiszta.
- **Utólagos, célzott független review kérve** (a futtatás előtt nem látta review). **Eredmény (R5): APPROVED.**
  - Jóváhagyva a verify-javítás, az ACCEPTED ítélet a mellékelt naplók szerint, és a `systemd-run` végrehajtási
    eltérés.
  - A reviewer futásai: kapu 17/17; mindkét negatív kontroll pontosan a megfelelő esetet buktatja; további 7
    névhatár- és 6 mintapár-próba sikeres.
  - Új hibajegy nincs.
  - Korlátok, amelyeket az APPROVED nem tesz bizonyítottá: a szabály unitnevet vet össze, hibaokot nem; a csomagból
    hiányzott a nyers mintapár és a helyszíni hash-kimenet.
  - Ez utóbbit a review után csak olvasva pótoltam: `…-r5-verify-fix\addendum-state-files\`, `SHA256SUMS`
    `f95aa63e…`. A végrehajtott szkript helyszíni sha256-ja `0d9dfe64…`; a két tárolt minta ugyanarról az új bootról
    szól (`14ebe597…`, a prep előtti `2a1c0653…`), mindkettőben `sample_ok=1`.

**Elfogadási minták a javított verify-jal:**

| Minta | Idő (UTC) | Verdikt | Exit | PASS |
|---|---|---|---|---|
| 1. | 13:31:50 | PENDING (first sample) | 2 | 26 |
| 2. | 13:37:06 | **ACCEPTED** | **0** | 31 |

- A seed és a devnet2 futó exe-hash-e változatlan; mongod `db version v8.0.32`, node `v24.21.0` a processzeken;
  csomagok a rögzített verzión, audit tiszta.
- A két node egyezik a 13313-as blokkon (teljes hash), egymástól 0 blokkra.
- A devnet2 minter a boot óta fut (`minter_running_since` 13:29:18Z, a naplóban „threadstakeminer thread start”
  13:29:18Z), 316 s alatt változatlan, hibamező üres.
- Mindkét node 2 blokkot haladt; az index nőtt; a ZMQ nőtt, `missed 0`; a health `ok`, `behind 0`.

**Utána, kívülről és a flottán:**
- `/`, `/rounds`, a hivatkozott JS/CSS és az `/api/v1/health` 200;
- flotta: 160/160 egy láncon, 0 fork;
- utána-pillanatkép: kernel `6.8.0-139-generic`, 172 peer, egy aktív tip, 3 mentés; failed unit csak a `cloud-init`.

**Bizonyítékok:** a repón kívül, `D:\www\devnet .deftrack-review-artefacts\2026-09-14-maint-window-r5-verify-fix\`
(a prep- és reboot-napló, a verify-futások, a pillanatképek, a verify-diff és kaputesztje), `SHA256SUMS` sha256
`f570bb7b22253635e8146db463512791e643802b6e39b6d5ab08a838b9b5461a`. A VPS-en megmaradt állapotfájlok:
`/root/maintenance-20260914/`.

```text
Napi státusz: ÉLESBEN, mérve — kernel 6.8.0-139, MongoDB 8.0.32, Node 24.21.0; verify ACCEPTED
Éles módosítás: MEGTÖRTÉNT (csomagfrissítés + reboot; alkalmazás változatlan, 65dcadf)
Független review: a futtatás előtt APPROVED (4. kör); a verify egypontos javítása utólag APPROVED (R5)
```

## J1 javító munkanap – a vezérlés nem küldhet parancsot más futamra

```text
Nap / dátum / implementáló: J1 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-12 @ 83b8710 (main)
Napi feladat és előfeltételei: a független 01–10. napi review R1, R2, R4
  találata. Előfeltétel: a review ellenpróbái reprodukálva — megvan.
Auditpontok: F01 (újranyitva), F02 (részben; R3 a J2-re marad)
```

**Először a piros, utána a javítás.** A review ellenpróbáit a saját gépen
lefuttattam, mielőtt egy sort is módosítottam volna: `8 failed, 1 passed`,
pontosan a jelentett bontásban. A C1 kontroll zöld, tehát a futtatás maga jó.

**R1 — futamváltás közben a régi futam Abort gombja még a régi futamra küldött.**
A kiválasztott kulcs azonnal az új futamra állt, a futamobjektum, a terve és a
bizonyítéka viszont maradt. Amíg az új futam betöltött, a panel a **régi** futam
Abort gombját mutatta az **új** futam kulcsa alatt — és az a gomb valódi abortot
küldött egy élő faultra, amit már senki nem nézett. Két rétegben javítva:

1. a dashboard **futamváltáskor azonnal elejti** a futamot, a tervét, a recovery
   bizonyítékát, a preflightját és az idővonalát — de csak *váltáskor*, mert a
   képernyőn lévő futam újraolvasása nem veheti el egy élő fault vezérlését;
2. a panel **nem rendereli és nem hajtja végre** azt a műveletet, amelynek a
   futama nem a kiválasztott. Minden gomb `run.runKey`-t nevez meg a kérésben;
   az a kártya, amelynek a futama nem a kiválasztott, ne is létezzen.

Szándékosan két réteg: a tévedés ára egy rossz futamra kézbesített abort.

**R2 — egy korábbi kérés késői hibája eltüntette a már betöltött új futamot.**
A betöltés **sikerága** ellenőrizte, melyik kiválasztáshoz tartozik; a hibaága
nem. Így az A futam lassú 503-a, ami akkor érkezett, amikor az operátor már a
B-n volt, kitörölte B futamát, tervét, bizonyítékát és idővonalát, és A hibáját
tette a helyükre. Helyette **kiválasztásonkénti generáció**: minden betöltés
elkapja, és emeli minden kiválasztásváltás, a törlés és a munkamenet vége is. A
kulcs önmagában nem tudja megkülönböztetni **ugyanannak a futamnak két kérését**,
ezért nem elég rá ellenőrizni. Amit nem szabad elrontani, és nem is romlott el:
**ugyanannak a futamnak a sikertelen státuszpollja továbbra is megtartja a
vezérlést** (`run-status.spec.ts` „a failed status read keeps the run and its
controls”).

**R4 — az indítási megerősítés átkerült egyik futamról a másikra.** A két
jelölőnégyzet csak új terv előkészítésekor nullázódott, máskor soha. Az A futam
indításának megerősítése után a B futam „Confirm and start” gombja már engedve
volt, anélkül hogy bárki bármit megerősített volna a B-ről. A megerősítés mostantól
**ahhoz a futamkulcshoz tartozik**, amelyikre adták — kulcshoz kötve, nem a futam
objektumhoz, mert azt a státuszpoll pár másodpercenként lecseréli, és az operátor
keze alól törölné ki a pipát.

**Érintett fájlok:** `client/src/components/dd-admin-shell.ts`,
`client/src/components/dd-simulation-control.ts`,
`client/e2e/run-selection.spec.ts` (+4 eset).

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód nem változott, authot,
CSRF-et, revision-ellenőrzést és szerveroldali idempotenciát nem érintettem.

**A tesztek a rendes kapuba kerültek.** A review próbái a `docs/` alatt nem
automatikus kapuk. A négy eset a kliens saját suite-jában van, tehát minden CI
push futtatja őket.

**Negatív kontrollok — négy, és mind a négy pontosan a saját tesztjén bukott:**

| Kivett őrszem | Ami elpirult | Ami zöld maradt |
|---|---|---|
| a dashboard futamváltáskori törlése | „a selection that is still loading…” (az idővonal-állítás) | a másik 12 |
| a panel kiválasztás-ellenőrzése | „a panel whose run is not the selected one…” | a másik 12 |
| a generáció a hibaágban | „a late failure for the previous run…” | a másik 12 |
| a futamonkénti megerősítés-nullázás | „a start confirmation does not travel…” | a másik 12 |

Az R1 két rétege külön-külön van kifeszítve: a dashboard oldalát az idővonal
állítása fogja meg (a panel őrszeme elrejti a gombokat, de az idővonal a
shellben van), a panel oldalát egy szándékosan **fehér dobozos** eset, amely
kézzel állítja szét a futamot és a kiválasztást. Ez utóbbi állapot a felületen
keresztül már nem érhető el — épp ezért kell hozzá fehér dobozos teszt, és épp
ezért maradna bizonyíték nélkül az egyik réteg, ha csak a review próbáira
hagyatkoznék.

**Egy hiba, amit a nap hozott elő, és nem a review:** ez a naplófájl maga
**valódi NUL bájtot** tartalmazott — a 2. napi bejegyzés, amely épp a
`router.ts`-be került NUL bájtról szól, backtickek közé egy igazi NUL-t írt. A
`file` „data”-t mondott rá, nem szöveget. Kicserélve az escape nevére. A javítás
első próbálkozása **újra beleírta**: a Bash-heredoc egy backslash-szintet lenyel,
így az escape valódi NUL-lá vált a Python-forrásban. Az önellenőrzés elbukott és
megállította — ezért kell minden ilyen szkriptbe bukni képes ellenőrzés.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + 139 kliens unit, typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **82** böngészőteszt (78 → 82) |
| Review-ellenpróbák | R1, R2, R4 és C1 zöld; R3, R5a, R5b, R6, R7 még piros (J2/J3) |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** R3 és R7 a **J2**, R5 és R6 a **J3**
csomagban. A K3 integrációs kör a J3 végén, a teljes elfogadási körrel együtt —
a J1 egyetlen szerveroldali sort sem érintett.

```text
Commit(ok), végső SHA: 4972341 (kód + tesztek), + ez a naplóbejegyzés
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## J2 javító munkanap – a bizonyíték kövesse a futamot, a kulcs a draftot

```text
Nap / dátum / implementáló: J2 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-12 @ f202651 (J1 után)
Napi feladat és előfeltételei: a review R3 és R7 találata. Előfeltétel: J1 — kész.
Auditpontok: F02 (R3), és R7, amely nem tartozik egyetlen auditponthoz sem
```

**R3 — a státuszpoll a futamot olvassa, és csak azt.** A recovery bizonyíték
egyetlenegyszer töltődött be, a kezdeti olvasáskor. Így az a futam, amelyik
magától ért `cooldown`-ba — lejáró lease, a szerver saját recoveryje —, az új
státusz mellett azt írta ki, hogy **„No recovery proof has been recorded for
this run yet”**. Ez pontosan az az egy dolog, amit egy faultot figyelő
operátornak nem szabad tévesen mondani. Az idővonalnak ugyanez volt a hibája, és
a **Refresh** egyiket sem javította: az öt dashboard-táblát olvasta újra, a
mellettük lévő futamot nem — vagyis az az egyetlen gomb, amit valaki *azért* nyom
meg, mert a panel elavultnak látszik, volt az, amelyik nem tudta felfrissíteni.

Mostantól a futam **mozgó részei** — idővonal és bizonyíték — újraolvasódnak,
valahányszor a státusz vagy a revision mozdul, minden operátori mutáció után, és
Refreshre. A **mentett terv nem**: az változatlan, és a „a terv egyszer olvasódik,
nem minden tickben” teszt zölden marad — ez az a korlát, amit a javításnak nem
volt szabad átlépnie.

**A sikertelen frissítés nem válasz.** Ha a bizonyíték-végpont hibázik, a panel
megtartja, amit tud, nem írja fölül „nincs rögzített bizonyíték”-kal: egy
**bizonyított** recoveryt hiányzóként jelenteni ugyanaz a hibaosztály, mint az
elérhetetlen bizonyítékot „all clear”-ként olvasni, csak a másik irányba. A
kódban ezért `undefined` = „ez a frissítés elbukott”, `null` = „a szerver azt
mondja, nincs bizonyíték”.

**R7 — a create idempotenciakulcs csak a draft seedjére volt scope-olva.** Egy
bizonytalan kimenetelű Prepare után a paraméter, a scenario, a network vagy a
mode szerkesztése **más bodyt küldött ugyanazzal a kulccsal**. A szerver a
kulcsot ahhoz a payloadhoz köti, amit elsőként látott, és minden mástól
`IDEMPOTENCY_CONFLICT`-tel elzárkózik — vagyis a **kijavított** draftot egyáltalán
nem lehetett létrehozni, amíg valaki újra nem töltötte az oldalt, és a panel a
visszautasítást úgy jelentette volna, mintha magával a javítással lenne baj.

A kulcs mostantól a **teljes elküldött kérés** azonosságához tartozik. Az új
`client/src/lib/draftIdentity.ts` kanonikus formája **szándékosan azonos a
szerverével** (`domain/simulationAudit.ts`, `domain/codeUnitOrder.ts`):
kulcsrendezés **code unit** szerint, nem locale szerint, `undefined` tagok
elhagyva. Ez nem stílus kérdése — ha a kliens szigorúbb lenne, új kulcsot küldene
oda, ahol a szerver replayt fogadott volna el; ha lazább, olyan kulcsot használna
újra, amit a szerver elutasít. A rövid ujjlenyomat nem kriptográfiai digest és
nem is akar az lenni: a panel saját retry-táblájában nevez meg egy scope-ot, az
érdemi összehasonlítást a szerver SHA-256-ja végzi ugyanezen a kanonikus formán.
Ütközés esetén a szerver `IDEMPOTENCY_CONFLICT`-et ad — **látható és elutasított**,
szemben azzal a hibával, amit lecserél: egy csendben elküldött rossz kulccsal.

**Érintett fájlok:** új `client/src/lib/draftIdentity.ts` (+ teszt, 12 eset);
módosítva `dd-admin-shell.ts`, `dd-simulation-control.ts`,
`client/e2e/run-status.spec.ts` (+6 eset).

**Szerződésváltozás / kompatibilitás:** nincs. Szerverkód nem változott. A
szerver fingerprint- és idempotencia-ellenőrzését nem gyengítettem — a kliens
mostantól **igazodik** hozzá, nem kerüli meg.

**Negatív kontrollok — öt, és kettő közülük elsőre NEM bukott:**

| Kivett őrszem | Ami elpirult |
|---|---|
| az átmenet utáni frissítés | „an automatic transition brings the evidence and the timeline with it” |
| a sikertelen frissítés megtartása | „a failed evidence refresh keeps what was proven” |
| a mutáció utáni frissítés | „a recovery the operator asks for shows the proof it produced” — **csak a teszt átirányítása után** |
| a draft-azonosságú kulcs | „an edited draft is a new create request, on the same seed” |
| a Refresh-ág | „Refresh re-reads the selection that is already on screen” — **csak az új teszt megírása után** |

A két bukás nélküli kontroll a nap érdemi tanulsága:

1. **A mutáció utáni frissítést a dashboard takarta el.** A `simulation-changed`
   esemény teljes dashboard-újratöltést indít, és az útközben frissítette a
   bizonyítékot is — vagyis a tesztem zöld maradt egy kivett javítással, mert nem
   azt az utat mérte, amit megnevezett. A teszt most **elveszi a dashboard öt
   tábláját** (a futam végpontjai válaszolnak, a lista nem), így csak a megnevezett
   út hozhatja be a bizonyítékot. Az eltakarást nem elég megérteni: a
   dashboard-útra **nem** szabad hagyatkozni, mert a `_loadDashboard` kilép, ha
   épp fut egy másik — ilyenkor a mutáció utáni frissítés nyom nélkül elveszne.
2. **A Refresh-ágat semmi nem feszítette ki.** A review a defektus leírásában
   megnevezi, de az elfogadási feltételei közt nem szerepel, és egyetlen meglévő
   teszt sem bukott tőle. Külön eset íródott rá, a státuszpolltól szándékosan
   elszigetelve: a futam revisionje nem mozdul, tehát a pollnak nincs mit
   észrevennie, és csak a Refresh hozhatja be a bizonyítékot.

**Parancsok, exit-kódok:**

| Kapu | Eredmény |
|---|---|
| K1 | mind exit 0 — 844 szerver + **151** kliens unit (139 → 151), typecheck, build, `git diff --check` tiszta |
| K2 | exit 0 — **88** böngészőteszt (82 → 88) |
| Review-ellenpróbák | R1, R2, R3, R4, R7 és C1 zöld; R5a, R5b, R6 még piros (J3) |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** R5 és R6 a **J3** csomagban, a teljes
elfogadási körrel (K3 integráció is) együtt. A J2 szerverkódot nem érintett, ezért
külön integrációs kört ma nem futtattam.

```text
Commit(ok), végső SHA: 4261e06 (kód + tesztek), + ez a naplóbejegyzés
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## J3 javító munkanap – a Fairness profilja és a registry létszáma, majd teljes elfogadási kör

```text
Nap / dátum / implementáló: J3 / 2026-09-12 / Claude Opus 5 (1M)
Kiinduló branch és SHA: web/review-fixes-2026-09-12 @ 423b64b (J2 után)
Napi feladat és előfeltételei: a review R5 és R6 találata, majd a teljes
  elfogadási kör. Előfeltétel: J1, J2 — kész.
Auditpontok: F05 (R5), F06 (R6)
```

**R5 — a profil feloldása egyszer történt meg, és mindkét válasz beragadt.** A
chain tip és a ChainLock-jelentés `_resolved === null` őrszem mögött olvasódott,
csakhogy a **„nem feloldható” sem null** — így a sikeres és a sikertelen válasz
egyformán beragadt az oldal élettartamára. Egyetlen 503 a ChainLock-jelentésen
azt jelentette, hogy **soha többé nem indult Fairness-lekérdezés**; egy az
aktiválási magasságot átlépő tip pedig a másik irányba ragadt be: az a link,
ami azért van, hogy kövesse a tipet, továbbra is arról a profilról kérdezett,
amelyik már nem ír alá. Mindkettőből csak teljes újratöltés vagy kézi
profilválasztás vezetett ki — egyiket sem tudja az olvasó, hogy meg kell tennie.

A pár mostantól **minden tickben** olvasódik. A profil-**registry** továbbra is
egyszer: az a cache indokolt, mert a profilok a binárissal változnak, nem a
tippel. Ez a pár viszont **maga a tip**.

**Az explicit választást ez nem érinti.** Az `llmq=<név>` és az `llmq=all` az
`_effective()`-ben dönt, a feloldás már csak a mellette lévő „· at the tip”
jelölőt határozza meg — ezért ilyenkor a kód **nem is várja meg**.

**R6 — a „jelenleg regisztrált” létszám nem a vizsgált ablak létszáma.** A
`currentRegisteredNodes` kihagyta azt a node-ot, amelynek nincs eligible köre az
ablakban, azzal az érveléssel, hogy különben új node-ból gyártanánk éhező hostot.
Az érvelés helyes, csak **más számokról szól**: a `neverSelected` és a
`roundsEligible` az a hely, ahová tartozik, és mindkettő továbbra is alkalmazza.
**Itt** alkalmazva viszont azt okozta, hogy a „hányan vannak regisztrálva”
kérdésre adott válasz attól függött, melyik ablakról és melyik profilról kérdez
valaki — vagyis egy tegnap regisztrált masternode hiányzott abból a számból,
ami a **mai** állapotot írja le. Ez a mező saját dokumentált szerződésével ment
szembe, ami kifejezetten a registryt mondja, nem a mintát.

A két oszlop szándékosan két különböző kérdés — ezért van belőlük kettő. Egy
host, amelyik 2 regisztráltat és 1 kiválasztottat mutat, **le van írva, nem
megvádolva**.

**A hibás meglévő unit elvárást javítottam, nem töröltem** (a review kifejezetten
ezt kérte): ugyanaz az eset, az indoklással mellette, és három új állítással —
a másik oszlop nem mozdult, az új node nincs a `neverSelected`-ben, és a régi
node `roundsEligible`-je változatlan.

**Érintett fájlok:** `client/src/components/dd-page-fairness.ts` (+4 E2E eset);
`server/src/domain/selectionFairness.ts` (+ javított unit elvárás);
`server/src/integration/fairnessSelection.integration.test.ts` (+1 eset, +1 host
a fixtúrában).

**Szerződésváltozás / kompatibilitás:** a `currentRegisteredNodes` **jelentése
nem változott** — a megvalósítás igazodott hozzá. A wire-formátum változatlan.

**Negatív kontrollok — kettő, és egyik elsőre csak félig bukott:**

| Kivett őrszem | Ami elpirult |
|---|---|
| a tickenkénti feloldás | R5a **és** R5b — de R5b csak a teszt javítása után |
| a registry-létszám eligibility-szűrése | a javított unit elvárás **és** az új HTTP-eset, plusz a redakciós eset hostszáma |

**A nap két saját hibája, mindkettő a tesztekben:**

1. **Az R5b tesztem versenyhelyzetet tartalmazott.** A „nem feloldható” felirat
   **akkor is** megjelenik, amíg a válasz még úton van, ezért a tesztem
   visszaállította a végpontot, mielőtt az 503-at egyáltalán feldolgozták volna —
   így a javítás nélkül is zöld maradt: az **első** olvasást mérte, nem az
   újrapróbálkozást. Most a hiba **saját indokára** vár a képernyőn
   („no ChainLock report”), nem időzítésre.
2. **Én okoztam egy flake-et, és nem retryval fedtem el.** A feloldás
   megvárásával minden szűrőkattintás után két körrel később indult a
   Fairness-kérés. Egy meglévő állítás közvetlenül a kattintás után olvasta ki a
   kéréslistát — eddig csak azért működött, mert gyors volt. A javítás **kettős**:
   az állítás mostantól megvárja a kérést, a kód pedig explicit profil mellett
   nem is várja meg a feloldást, mert az ott semmit nem dönt el. A teljes
   böngésző-suite ezután **háromszor egymás után** zöld.

**Parancsok, exit-kódok — teljes elfogadási kör:**

| Kapu | Eredmény |
|---|---|
| K1 typecheck | exit 0 |
| K1 unit | exit 0 — 844 szerver + 151 kliens |
| K1 build | exit 0 |
| K1 `git diff --check` | tiszta |
| K2 böngésző | exit 0 — **92** teszt (78 → 92 a három javító nap alatt), háromszor egymás után |
| K3 integráció | exit 0 — 14 fájl, **90** teszt (89 → 90), 8 skip (a Mongo nélküli tartalék ág) |
| Review-ellenpróbák | **9/9 zöld** (R1–R7 és a C1 kontroll) |

**Valódi laborfutam:** NEM FUTOTT.

**Nyitott probléma / következő lépés:** a review mind a hét találata lezárva, a
próbái a rendes kapuban futnak. Az eredeti munkaterv **11. napja** következik
(F11: a többi oldal szűrőinek URL-hez kötése). Változatlanul nyitott, nem ebből
a körből: F07 production-nginx fele (14. nap), F10, F12, F13, F14, és az
integrációs suite egy korábban feljegyzett, ma nem reprodukálódott flake-je.

```text
Commit(ok), végső SHA: 6913d1d (R5, kliens), e860556 (R6, szerver), + ez a napló
Végső git státusz: a saját munkám tiszta
Napi státusz: ELLENŐRZÖTT
Éles deploy: NEM TÖRTÉNT
```

## Auditpontok lezárási mátrixa

**Élesben, mérve 2026-09-14, a deploy után:** a VPS a `5237f80`-et futtatja. Az alábbi sorok „nincs
telepítve” jelzései ezzel lezárultak, és minden F- és V-javítás élesben van. Kivétel az F10 CSP-je, amely
továbbra is report-only — **ez is lezárult 2026-09-14 02:07:57Z-kor**, a CSP azóta enforce (lásd a „CSP
enforce 2026-09-14” bejegyzést). Részletek: „Deploy 2026-09-14” bejegyzés. Az alábbi 2026-09-13-i bekezdés és a
sorok szövege előzményként változatlan.

**Élesben, mérve 2026-09-13:** a VPS a `83b8710`-et futtatja (a #163 merge, 2026-09-12 16:17): ebben
az 1–10. nap (#162) benne van, a J1–J3 (#164, az R1–R7 review-javítások) és a 11–20. nap
**nincs**. Az F01, F02, F05 és F06 sorában a J-javítások tehát **csak kódban és tesztben** zártak.
A 14. napi nginx-fejlécek élnek. Részletesen: [átadási csomag](WEBSITE_HANDOVER_2026-09-13_HU.md), 3–4. pont.
A végső review (2026-09-13) V1–V7 javításai (J4–J6) szintén **csak kódban és tesztben** zártak; az
átadási csomag 14. pontja sorolja fel őket.

| Pont | Javító nap | Kód / commit | Ellenőrzés | Éles bizonyíték / korlát |
|---|---|---|---|---|
| F01 | 05–06, **J1**, **J4** | `8735d1d`, `5fd3307`, `4972341`, `96e6e30`, `451e3e8` | unit: `adminRunSelection.test.ts` 10 eset; E2E: 13 eset — a 9 eredeti plusz a review R1/R2/R4 ellenpróbái és a panel őrszemének fehér dobozos esete; J4: `run-status.spec.ts` +6 (V1), `admin.spec.ts` +3 (V3) | **A review újranyitotta** (R1, R2, R4): futamváltás közben a régi futamra ment volna az abort, késői hiba törölte az újat, a megerősítés átvándorolt. A J1 mindhármat lezárta, őrszemenként külön negatív kontrollal. **A végső review ismét újranyitotta** (V1: késői terv visszatekerte a futamot, a terv hibája elvitte az abortot; V3: belépés után nem töltődött be a dashboard). A J4 lezárta, 7 + 3 negatív kontrollal; nincs telepítve |
| F02 | 05–07, **J2** | `8735d1d`, `5fd3307`, `c1e3605`, `4261e06` | unit: `simulationRunState.test.ts`; E2E: 14 eset szabályozott órával — a 8 eredeti plusz automatikus átmenet, sikertelen bizonyítékfrissítés, operátori recovery, Refresh, és a két idempotencia-eset | **A review újranyitotta** (R3): a státuszpoll csak a futamot frissítette, a bizonyítékot és az idővonalat nem, a Refresh pedig a kiválasztást nem olvasta újra. A J2 lezárta; a mentett terv továbbra is egyszer olvasódik. **A végső review ismét újranyitotta** (V2: az egymást keresztező bizonyíték-frissítések közül az utolsó érkező nyert; V7: a kezdeti olvasás hibája „nincs bizonyíték” lett). A J4 lezárta (`2e2d56c`, `11bbe63`; +4 és +6 E2E, 5 és 7 negatív kontroll); nincs telepítve. **Az ismételt review W2-je**: a recovery- és history-olvasás 401-e nem zárta le a sessiont — a J7 lezárta (`6c94aa0`; +4 E2E, 5 negatív kontroll); nincs telepítve. **A harmadik review a W2-t részben fogadta el** (X1: a kezdeti terv- vagy idővonal-olvasás 503-a után egy másik olvasás 401-e elveszett) — a J8 lezárta (`d0f28fe`; +10 E2E, 6 negatív kontroll), a negyedik független review elfogadta; nincs telepítve |
| F03 | 03 | `c5c872c` | unit: `freshness.test.ts` 15 eset; E2E: 7 eset szabályozott órával | Kliensoldalon lezárva. A `HealthSnapshot` nem közöl megfigyelési időbélyeget, így a forrásidő jelzése a `behind` marad |
| F04 | 08 | `6c6fc96` | E2E: 8 eset (34 rekord végiglapozása, szűrő, betöltés/hiba/üres, részletváltás); HTTP: `experimentPaging.integration.test.ts` 7 eset | Kliensoldalon lezárva. A szerver eddig is helyesen lapozott és adta a valódi `total`-t; a kliens egyiket sem használta |
| F05 | 09, **J3** | `881df65`, `6913d1d` | E2E: 8 eset — a 4 eredeti plusz mozgó tip, átmeneti feloldási hiba utáni újrapróbálkozás, és az explicit profil + aggregát érinthetetlensége; HTTP: a szűrő tényleg szűkíti a mintát (2 / 1 / 3 kör) | **A review újranyitotta** (R5): a feloldás `_resolved === null` mögött ült, és a „nem feloldható” sem null, ezért mindkét válasz beragadt. A J3 lezárta; a profil-registry cache-e indokoltként megmaradt. **Az ismételt review W4-e**: tip-vezérelt profilváltásnál a régi profil adata az új jelölés alatt maradt — a J7 lezárta (`f2a4873`; +3 E2E, 4 negatív kontroll); nincs telepítve |
| F06 | 09, **J3** | `881df65`, `e860556` | unit: 4 eset a doménben, ebből egy dokumentált szerződéskorrekcióval; HTTP: 7/5 és 3/0 változatlanul, plusz egy az ablak után regisztrált host 1/0-val, amely nincs a `neverSelected`-ben; E2E: két oszlop, néma host, hiányzó mező `—` | **A review újranyitotta** (R6): a `currentRegisteredNodes` a történeti eligibility-vel szűrt, így nem a jelenlegi registry létszámát adta. A J3 lezárta; az eligibility a `neverSelected`-nél és a `roundsEligible`-nél maradt |
| F07 | 02, **14** | `db77551`, `5262482` | unit: 4 eset a `router.test.ts`-ben; E2E: 3 eset böngészőben; **élő nginx: `/round/%`, `/tx/%E0%A4%A`, `/block/%zz` mind 400**, a szabályos `/round/7%3A7416%3A0` 200 | **Lezárva.** A production nginx a kliens előtt visszautasít, tehát a hiba beírt URL-ből nem érhető el; a kliensoldali javítás az SPA-n belüli navigációra kell, és azt a böngészőtesztek fedik |
| F08 | 02 | `db77551` | unit: „names an unknown path…”; E2E: `/audit-nonexistent-20260911` | Kliensoldalon lezárva; a szerveroldali SPA fallback szándékosan változatlan |
| F09 | 04, **J6** | `127e53d`, `b7ee9f8` | unit: minden sablon átmegy a `parseScenarioRequest`-en; HTTP: `simulationScenarios.integration.test.ts`; E2E: 8 eset; J6: `scenario-forms.spec.ts` +5 (V5) | Kliens- és szerveroldalon lezárva. A valódi registry-alapú célpontválasztó a 16. nap; a `live` mód tényleges laborfutamát ez nem bizonyítja. **A végső review V5-je** a 15–16. napi szerkesztő hibája volt (a hibás Advanced JSON egy mezőszerkesztéstől elveszett); a J6 lezárta, 6 negatív kontrollal; nincs telepítve |
| F10 | 14, **20** | `5262482`, `694d5cc` | izolált nginx: 6 fejléc 5 válaszon, benne egy valódi 404, negatív kontrollal; böngésző: az **enforce** házirend tisztán fut a buildelt **és** a deployolt bundle-on; élő: a fejlécek `/`, `/rounds`, `/admin`, asset és ismeretlen útvonal valódi válaszán lemérve; 20. nap: `httpHardening.test.ts` — a szerver nem küld HSTS-t | **Élesen bekapcsolva** (tulajdonosi engedéllyel). A CSP **report-only**; az enforce-ra váltás egy fájlcsere, a bizonyíték megvan. A kettős HSTS a 20. napon kódban megszűnt (egy tulajdonos: az nginx), **de nincs telepítve** — élesben az `/api/` ma is kettőt küld |
| F11 | 10–11 | `700c420`, `b954e9b` | E2E: 22 eset — a 10. napi 10 a Rounds/Fairness/Experiments oldalra, plusz 12 a Vantage Points topicjára, a Staking ablakára és nézetére, a Blocks és a Transactions lapozójára, és egy arra, hogy vezérlő nélküli oldal nem kap paramétert | Kliensoldalon lezárva. A hét megnevezett oldalból négyen van ténylegesen vezérlő; PoSe, ChainLocks és Sentinel Layer szándékosan paraméter nélkül maradt, mert nincs mit kötni. **A végső review V4-e**: lekérdezés-váltáskor a régi adat az új lap, szűrő, ablak vagy téma alatt maradt. A J5 hét oldalon lezárta (`dc05f11`; `query-identity.spec.ts` +17, 9 negatív kontroll); nincs telepítve. **Az ismételt review a V4-et részben fogadta el** (W1: a Simulations lista pollhibája eltüntette az utolsó jó listát; W4 az F05 sorában) — a J7 lezárta (`35899d4`; +3 E2E, 3 negatív kontroll); nincs telepítve |
| F12 | 12, **18**, **20** | `1828831`, `fc4652d`, `611fdde` | E2E: 10 eset — egy h1 oldalanként, szekciók h2-ben, fókusz navigációkor és Backnél, fókusz megmaradása poll és szűrőváltás alatt, Back a szűrő fölött nem mozdítja, skip link kezelővel és láthatóan, teljes billentyűzetes útvonal, caption a táblázatában; 18. nap: pontosan egy h1 mind a 20 útvonalon négy állapotban, a fókusz megmarad a részletoldal címén adatérkezéskor; 20. nap: `aria-pressed` sweep minden toggle-csoporton | Kliensoldalon lezárva, **nincs telepítve**. Számított fókusz- és szerkezetmérés, nem képernyőolvasós tanúsítás; a staking nézetváltó `aria-pressed`-je a 20. napon pótolva |
| F13 | 13 | `5b8b5a7` | `npm audit` előtte/utána mérve: **3 moderate → 2**, a `body-parser` lekerült a listáról; `npm ci`, K1, K2, K3 mind exit 0 | **Részben — elfogadott maradék.** A body-parser útja lockfile-frissítéssel lezárva, manifest és override nélkül. A maradék kettő az express saját `qs@~6.15.1` pinje; a 4-es vonal nem lép le róla, az egyetlen felfelé út az express 5 (framework-major, a terv nem kéri). Nem elérhető kódút: `query parser` = `simple`, `urlencoded` nincs. **A 20. napon kiderült, hogy ez csak a fő szerverre volt igaz** — a labor-szerver nem állította a parsert. Közös `hardenHttpApp()` mindkettőnek (`694d5cc`), és az őrszem megvan: `httpHardening.test.ts` valódi kéréssel és a forrás sweepjével. **Nincs telepítve** (a VPS a 13. nap előtti lockfile-lal fut) |
| F14 | 12 | `1828831` | unit: a tényleges gombpár 4,5:1 mindkét témában + a régi kompozíció mérésként rögzítve; E2E: a gomb valódi számított szín-párja a lapon, mindkét témában | Lezárva. Saját `--btn-danger-bg`/`--btn-danger-fg` pár (7,29:1 sötét, 5,61:1 világos); a `--crit` szövegszínként változatlan, a keret is az maradt |
| R7 (nem audit) | **J2** | `4261e06` | unit: `draftIdentity.test.ts` 12 eset; E2E: változatlan retry ugyanaz a kulcs, megváltozott payload új kulcs, és egy draftszerkesztés nem nyúl a futam még tartozó kulcsához | Lezárva. A kliens kanonikus formája szándékosan azonos a szerverével, így a kettő nem tud másképp gondolkodni arról, mi „ugyanaz a kérés” |
| V6 (végső review, nem audit) | **J6** | `f119407` | unit: `simulations.test.ts` +1 (és 2 frissítve); E2E: valódi letöltés 503 mellett, +1 (és 2 frissítve) | Lezárva kódban és tesztben, 8 negatív kontrollal; **nincs telepítve**. Az export `schemaVersion` 2, `reportRead` mezővel: a nem létező és az olvashatatlan riport a fájlban is különbözik |

## Review checkpointok

- 07. nap: **elkészült**, lásd a checkpoint-összefoglalót a napi bejegyzések után.
- 14. nap: **elkészült**, lásd a 14. napi bejegyzés végén.
- 20. nap: **elkészült** — [átadási csomag](WEBSITE_HANDOVER_2026-09-13_HU.md) és a 20. napi bejegyzés.
- **Független review az 01–10. napról: 2026-09-12, hét igazolt találat**
  ([jelentés](WEBSITE_REVIEW_DAYS_01_10_2026-09-12_HU.md),
  [ellenpróbák](review-2026-09-12/regressions.spec.ts)). Mind a hét lezárva a
  J1–J3 javító munkanapokon; az ellenpróbák a rendes kapuban futnak.
- **Független végső review a teljes munkáról: 2026-09-13, hét igazolt találat (V1–V7)**
  ([jelentés](WEBSITE_FINAL_REVIEW_2026-09-13_HU.md),
  [ellenpróbák](review-2026-09-13/regressions.spec.ts)). A vizsgált állapot a
  `39e7f80` (#174 merge). Az ellenpróbák a mainen az implementáló gépén is
  reprodukálódtak: 7 bukott, a C1 kontroll zöld, ugyanazokkal a hibaüzenetekkel.
  A javítás a `web/review-fixes-2026-09-13` ágon folyik, találatonként külön commitban.
  **Mind a hét javítva kódban és tesztben** a J4–J6 munkanapokon (`96e6e30` V1, `2e2d56c` V2,
  `451e3e8` V3, `dc05f11` V4, `b7ee9f8` V5, `f119407` V6, `11bbe63` V7), a kapuban lévő
  saját tesztekkel és negatív kontrollokkal; a review ellenpróbái közül V1, V2, V3, V4, V6 és
  V7 zöld. A V5-próba a letiltott Count mezőbe gépelésen időtúllépésre fut — a reviewer a
  zárolt űrlapot előre elfogadta, és a locator igazítását megengedte; a szövegmegőrzést a
  `scenario-forms.spec.ts` állítja. **Független újra-review: még nem történt meg.**
- **Ismételt független review a J4–J6-ról: 2026-09-13, a `72fec82`-n** ([jelentés](WEBSITE_REVIEW_V1_V7_2026-09-13_HU.md),
  [hibajegyek és ellenpróbák](review-2026-09-13-followup/)). V1, V2, V3, V5, V6, V7 lezárva; V4 részben.
  Új P1 nincs; négy P2 hibajegy: W1 (Simulations lista pollhibája), W2 (recovery-401 nem zárja le a
  sessiont), W3 (a `ResponseGate` URL szerint azonosított olvasást — új harness-hiba), W4 (Fairness
  automatikus profilváltása). Az ellenpróbák a mainen az implementáló gépén is reprodukálódtak: W1–W4
  piros, C2 zöld. A javítás a `web/review-fixes-2026-09-13-2` ágon, a J7 munkanapon.
  **Mind a négy javítva kódban és tesztben** (`2bd3139` W3, `6c94aa0` W2, `35899d4` W1, `f2a4873` W4),
  plusz a megerősített tesztadósság (`c82db16`); a review öt ellenpróbája zöld. **Független újra-review:
  még nem történt meg.**
  A reviewer `client/test-results/` alatti trace-ei (`followup-review`, `negative-followup`,
  `negative-followup-editor`, `review-final` — 22 fájl) a repón kívül megőrizve:
  `D:\www\devnet .deftrack-review-artefacts\2026-09-13-followup\`, `SHA256SUMS` sha256
  `de50d0ac8fbda907df031a80b07819a8947679e0196c3d253fc517e41d47259a`; `sha256sum -c` a másolaton és az
  eredetin is teljes egyezés, negatív kontroll (egy átírt bájt) exit 1.
- **Harmadik független review a J7-ről: 2026-09-14, az `eb76773`-n** ([jelentés](WEBSITE_REVIEW_W1_W4_2026-09-14_HU.md),
  [hibajegyek és ellenpróbák](review-2026-09-14/)). W1, W4 és V4 lezárható; W3 a harness működésére
  lezárható; a régi pollteszt szigorítása indokolt (a 3/3 mérés reprodukálva). **W2 részben nyitott:**
  X1/P2 — a kezdeti history- vagy dry-run-olvasás 503-a után a recovery 401-e elvész, mert a
  `Promise.all` az első hibánál kilép. Új teszthiba: X2/P3 — a W3 negatív kontrolljában a dobó állítás
  után egy timer bezárt lapot hív. Új P1 nincs. Az implementáló gépén változtatás előtt reprodukálva: X1
  két ellenpróbája piros, C3 és C4 zöld; a W3 kontroll futásában egy „has been closed” hiba. A javítás
  ugyanazon az ágon (`web/review-fixes-2026-09-13-2`, #176), a J8 munkanapon.
  **Mindkettő javítva kódban és tesztben** (`d0f28fe` X1, `504b8cd` X2), negatív kontrollokkal; a review
  négy új ellenpróbája (X1 ×2, C3, C4) és öt korábbi ellenpróbája (W1–W4, C2) az `504b8cd`-n zöld.
  **Független újra-review: a negyedik review, lásd a következő pontot.**
  A reviewer `docs/review-2026-09-14/artifacts/` és `generated/` mappái (a review saját `.gitignore`-ja
  kizárja őket; 61 fájl) a repón kívül is megőrizve: `D:\www\devnet .deftrack-review-artefacts\2026-09-14\`,
  `SHA256SUMS` sha256 `f27855033ef9c19ab0e9f6752221822e93df6f6e3a7724c534af89e05c47cf8c`; `sha256sum -c`
  a másolaton és az eredetin is 61/61, negatív kontroll (egy átírt bájt, egy törölt fájl) exit 1.
- **Negyedik, célzott független review az X1–X2-ről: 2026-09-14, a `458b6d0`-n**
  ([jelentés](WEBSITE_REVIEW_X1_X2_2026-09-14_HU.md), [ellenpróbák és naplók](review-2026-09-14-x1-x2/)).
  **X1 és X2 lezárva; új hibajegy nincs.** A `_loadSelectedRun` catch-ágából kivett 401-ág a jelenlegi
  útvonalon valóban elérhetetlen. A J8 két kimondott mellékhatása elfogadható: a reviewer saját próbákkal mérte
  (a késleltetett üzenet mellett az abort engedélyezett; kettős 503-nál mindkét sorrendben a terv hibája
  látszik) — **3/3 zöld, de ezek a próbák nincsenek a rendes kapuban**. A reviewer kapui: K1 **1067** unit, K2
  **299/299 első futásra**, `ERR_NO_BUFFER_SPACE` nélkül; K3 **98** (8 kihagyott); CSP **4/4**; ellenpróbák 5/5
  és 4/4. Saját kontrolljai: a J8 mátrixa az `eb76773` shelljével 6 piros + 2 zöld (a J8 állítása szerint), az X2
  öntesztjei a régi harnessszel 2 piros, cleanup-hiba nélkül. A vizsgálat külön worktree-ben
  (`D:\www\deftrack-review-458b6d0`) futott; a mellékelt config erre az útvonalra mutat. Laborfutam: 0.
  Kimenetei (`artifacts/`, `generated/`, a review `.gitignore`-ja kizárja őket; 33 fájl) a repón kívül:
  `D:\www\devnet .deftrack-review-artefacts\2026-09-14-x1-x2\`, `SHA256SUMS` sha256
  `5474c3a49ae2a9ce5d557a34a27f3f048ff80346b8f9a853abeba6f2138e6bfc`; `sha256sum -c` a másolaton és az
  eredetin is 33/33, negatív kontroll (egy átírt bájt, egy törölt fájl) exit 1.
- **Független review a #181-ről (RPC keep-alive): 2026-09-14, a `65dcadf`-en**
  ([jelentés](WEBSITE_REVIEW_RPC_KEEPALIVE_2026-09-14_HU.md), [mellékletek](review-2026-09-14-rpc/)).
  - **APPROVED**, a karbantartási ablak utánra; a tulajdonos a telepítést az ablak előtt, külön engedélyezte.
  - Egy nem blokkoló P3: a 15 000 ms-os pool-defaultot egyik célzott teszt sem fedte. Ez a **#183** PR
    (`ded49b4`, nyitva, CI zöld).
  - A reviewer szerint az ok erősen alátámasztott, de nem socket-szinten bizonyított.
  - Kérése: a telepítés után a warn és az error sorokat külön kell számolni. Ez megtörtént, és a mechanizmus is mérve
    van (napló, „Deploy 2026-09-14 (#181)”).
  - A tizenkét git-ignore-olt futási napló a repón kívül: `D:\www\devnet .deftrack-review-artefacts\2026-09-14-rpc\`,
    `SHA256SUMS` sha256 `2d323dde3739ffb0992d35fa5a8948edddaea67376be63b54482c56037d72dfc`; `sha256sum -c` a
    másolaton és az eredetin is 12/12, negatív kontroll exit 1.
  - A review saját fájljai változatlanul kerülnek a repóba, egyedül a sorvégeket normálja LF-re a `.gitattributes`.
    A `run-own-default.py` fájl végén egy üres sor van, amelyre a `git diff --check` jelez; ahogy a negyedik review
    anyagánál, a bizonyítékhoz nem nyúltam.
- **Független review a VPS karbantartási ablakról: 2026-09-14, két kör, mindkettő CHANGES REQUESTED.**
  - Az 1. kör az MW1–MW4-et adta; a 2. kör az MW1-et, az MW2-t és az MW4-et (az elfogadott átmeneti eljárással)
    lezárta, az MW3-at részben.
  - A 2. kör négy új P2-t adott: MR2-1 (a verify döntése hiányos párbizonyítéknál is PASS és exit 0), MR2-2 (a
    devnet2 lemaradása nem mért), MR2-3 (a checksum nincs az archívumhoz kötve), MR2-4 (az FCV-kapu történeti
    naplóból következtetett).
  - A 3. kör lezárta az MR2-1…MR2-3-at és az MW3-at; egy P2 maradt (MR3-1, az FCV-időhatár).
  - A 4. kör **APPROVED** (MR3-1 és MR2-4 lezárva, új jegy nincs). Az ablak 2026-09-14-én 13:27–13:37Z között
    lefutott, a verify ACCEPTED (napló, „VPS karbantartási ablak – futtatás”).
  - A verify egyetlen, élesben talált hibájának javítása (a helyreállt ismert failed unitot is bukásnak vette)
    **utólagos célzott review-n APPROVED (R5)**, új jegy nélkül. Csomag: `…\2026-09-14-maint-window-r5-verify-fix\`,
    a review után pótolt nyers állapotfájlokkal (`addendum-state-files\`).
- **Megfigyelés a CI-ban (2026-09-14, #184):** a `pull_request` futás legelső e2e-tesztje
  (`accessibility.spec.ts:79`, „a page names itself in one h1, with its sections under it”) hideg indulás után
  638 ms-nál már látta az `Overview` h1-et, a h2-szekciókat még nem, és bukott. Ugyanannak a commitnak a `push` futása
  299/299, az újrafuttatás zöld volt. A teszt a szekciók megjelenését nem várja ki — időzítésérzékeny, **nincs rá
  jegy**.
- **A reviewer helyi trace-ei és hibaképei a repón kívül vannak megőrizve**, mert a
  böngésző-suite induláskor kiüríti a `client/test-results/` mappát, benne a
  jelentés által hivatkozott `client/test-results/review-final/`-t is:
  `D:\www\devnet .deftrack-review-artefacts\2026-09-13\` — 21 fájl (7 teszt
  `error-context.md`-je, 6 hibakép, 7 trace, `.last-run.json`) és egy `SHA256SUMS`.
  A `SHA256SUMS` sha256-ja
  `6e3c03440ef964a19fc6f674cc9915da0691a915d643e5ecc1533879f2e4756a`. A hash-eket az
  eredeti fájlokból számoltam; a `sha256sum -c SHA256SUMS` a másolaton és az eredetin
  is 21/21 OK. Negatív kontroll egy scratch-másolaton: egy átírt bájt és egy törölt
  fájl → `FAILED` és `FAILED open or read`, exit 1.

A blokkot, kihagyott tesztet és fennmaradó sérülékenységet ne töröld ki egy későbbi bejegyzéssel: lezáráskor hivatkozz a bizonyítékra, hogy az előzmény követhető maradjon.

## Deploy 2026-09-14 (#182, #183, #184, #185) – a C6a első rolljával, `65dcadf` → `0a27df0`

```text
Dátum / végrehajtó: 2026-09-14 15:44:21Z / Opus 5-munkamenet (a C6a rollt vivő ügynök)
Engedély: a C6a roll-ablak tulajdonosi jóváhagyása („roll mehet a flottára full”); az explorer deploy a roll részeként,
  legkésőbb a 13535-ös tip előtt
Hatókör: `deftrack-devnet` újraindítása a mergelt `0a27df0`-n (#182 formationEndHeight/isSchedulable, #183 RPC-pool
  teszt, #184 docs, #185 maint-window docs); a nodeokhoz és a mongodhoz nem nyúlt
```

**Mérve, `journalctl -u deftrack-devnet` (UTC, a szerver CEST-ben naplóz):** `SIGTERM received` 15:44:21.336Z, tip a
leállításkor 13370; az új processz 15:44:22.091Z-kor csatlakozott a Mongóhoz, a gyűjtők azonnal elindultak. Readiness
közvetlenül a restart után: `status ok`, `chainTip 13370`, `behind 0`, `rounds` formed 1162 / failed 21 / pending 98 /
impossible 35. A kiszolgált bundle `assets/index-CNPCV91P.js` — a kliens nem változott, csak a szerverkód.

```text
Éles módosítás: MEGTÖRTÉNT (szerverkód; a kliens-bundle változatlan)
```

## Deploy 2026-09-14 (#186) – a health-endpoint 5 perces blokk-köz utáni téves 503-a, `0a27df0` → `75ec3a3`

```text
Dátum / végrehajtó: 2026-09-14 17:50:05Z / Opus 5-munkamenet
Engedély: a C6a roll-ablak tulajdonosi jóváhagyása alatt, önálló javításként a #181 mérésnél talált, nem a #181
  okozta hiba nyomán (ld. a Deploy 2026-09-14 (#181) szakasz „Mellékesen talált” pontját)
Hatókör: `server/src/domain/readiness.ts`, `server/src/index.ts` — a tétlen tick mostantól a `heartbeatAt`-et is
  frissíti, a readiness abból számol; 3 fájl, 375+/12- sor a #182 rollal együtt beérkezett ágból
```

**Mérve:** `SIGTERM received` 17:50:05.402Z, tip a leállításkor 13419; readiness a restart után `status ok`,
`behind 0`, `rounds` formed 1168 / failed 22 / pending 97 / impossible 35. A korábbi téves 503-at az
`evaluateReadiness` `lastSyncedAt`-alapú tétlenség-számítása okozta (ld. #181 bejegyzés); külön mérés a javításra
ez a PR-hez nem tartozik, a mechanizmus ugyanaz, mint amit a #181 bejegyzés dokumentált.

```text
Éles módosítás: MEGTÖRTÉNT (szerverkód; a kliens-bundle változatlan)
```

## Deploy 2026-09-14 (#188) – devnet formációs vég 13488, a flotta-roll alatt, `75ec3a3` → `9751a65`

```text
Dátum / végrehajtó: 2026-09-14 19:10:57Z / Opus 5-munkamenet
Engedély: a C6a2 futtatás tulajdonosi időnyerési döntése — a #188 review nélkül megy ki, mert a Core #244 konszenzusa
  a 13488-as blokkban aktiválódik; független review utólag, retrospektíven APPROVED
Hatókör: `server/src/config/llmq.ts` (a `llmq_50_60`/`llmq_60_75` `formationEndHeight` 13536 → 13488, a Core #244
  aktiválási magasságával egyezően), `server/src/services/sync.activity.test.ts`; a nodeokhoz nem nyúlt
```

**Mérve:** `SIGTERM received` 19:10:57.884Z, tip a leállításkor 13450 — a flotta-roll ablakán belül (19:09:40–
19:27:16Z, 16/16 host); readiness a restart után `status ok`, `behind 0`, `rounds` formed 1170 / failed 22 /
pending 98 / impossible 35. A #187 (`test/sync-overlap-activity`) csak teszt volt, önálló deploy nem tartozott hozzá
— a hozzá tartozó tesztfájl-változás ebbe a rollba és a #186-éba lett felosztva.

```text
Éles módosítás: MEGTÖRTÉNT (szerverkód; a kliens-bundle változatlan)
```

## C6a lekapcsolás és a két futás lezárása – 2026-09-14/15

Két Experiments-futás vitte a C6a-t: `fleet-rollout-c6a-243-2026-09-14` (zárva 13439-en, a karbantartás miatt a
feladás előtt lement flotta-rollal indult) és `fleet-rollout-c6a-end13488-2026-09-14` (zárva **2026-09-15 08:57Z**,
`endHeight` **13781**). A befagyasztott outcome a 13439–13781-es ablakban: **19 formed / 3 failed / 1 pending, 0
büntetett**, ChainLock 343/343, dsl 12/15 (absent: 559, 560, 566); csak a mainneten is futó profilok 18 formed / 1
failed / 1 pending, 0 büntetett. Flotta 160/160 egy láncon 13781-en, mind `14583e7c`; seed `a7822e1b` és devnet2
`14583e7c` azonos tip-hash-sel. InstantSend a záráskor 3/3 lockolva (1400/1991/3210 ms), seeden és devnet2-n
`instantlock_internal=true` a megerősítés előtt.

**Független review (2026-09-15), F1–F5, egy mondatban:**
- **F1** — a roll a Q60-bázis +10-én, a staker-hostokkal kezdődött; a bázis 13440 végleges commitmentje csak
  memóriában élt, és elveszett a restarttal, tehát az a Q60-kör elveszett (mainnet-releváns).
- **F2** — ugyanez a mechanizmus a `llmq_50_60` 13440-es körét is elvitte, deklaráció nélkül.
- **F3** — két Sentinel-epocha (559, 566) magyarázat nélkül maradt ki, egyik sem esik egybe ismert beavatkozással.
- **F4** — a seed/devnet2 a flottánál korábban állt át, ami 18:47–19:27Z között érvénytelenítette az átadó
  visszaállítási ágát — a rollt ez nem érintette.
- **F5** (látens) — egy `dkgInterval-1`-nél záruló bányászati ablakú profil utolsó commitmentje olyan blokkban
  születhet, amit a `quorum listextended` egyetlen magasságon sem mutat meg; a jelenlegi két profilt nem érinti.

Részletek: a review — `D:\www\devnet .deftrack-review-artefacts\2026-09-15-c6a2-review\C6A2_REVIEW_2026-09-15_HU.md`
—, a zárás — `D:\www\devnet .deftrack-ops-handover\2026-09-15-c6a2-close\` (`close2-notes.txt`,
`experiment-after-close.json`, `instantsend-close.txt`, `s-close.log`, `SHA256SUMS`).

```text
Éles módosítás: NEM TÖRTÉNT ebben a bejegyzésben (a #244/#188 rollja a fenti három Deploy-szakaszban;
  ez a szakasz csak a lezárás és a review dokumentálása)
```

---

## Backlog — ami nem ennek a tervnek a része

A terv kifejezetten külön backlogba küldött tételei, hogy ne vesszenek el egy napi
bejegyzés nyitott pontjai között.

- **proTxHash-keresés (19. nap).** Egy 64 hex karakteres azonosító masternode
  proTxHash is lehet, de nincs publikus masternode-részletoldal, ahová a keresés
  vihetne. Addig a keresés nem irányít blokk- vagy tranzakcióoldalra, és a „no
  match" kimondja, hogy masternode-keresés még nincs. Előfeltétel: egy publikus
  masternode-részletútvonal, a publikus API host-cím-szabályával
  (`publicApi.integration.test.ts`: egyetlen publikus végpont sem ad ki host-címet).

---

## Idegen commit az ágon — a devnet-ügynök jegyzete, 2026-09-12

A `web/audit-2026-09-11` ágra a 7. nap (`3a4ae3b`) fölé felkerült egy **doc-only** commit,
`a42a50b`, amely **nem ehhez az audithoz tartozik**: a devnet-flotta aznapi binárisméréseit
és egy Sentinel-mérési csapdát ír be. Két fájlt érint, `CLAUDE.md` és `plan.md`, +46/−1,
kódot nem.

**Ami emiatt nem kell:** rebase nem szükséges — ugyanaz az ág, a commit előre került. A 8. nap
akkor még befejezetlen munkája (`client/src/components/dd-page-experiments.ts`,
`server/src/routes/v1/experiments.v1.routes.ts` módosítva, `client/e2e/experiments.spec.ts` és
`server/src/integration/experimentPaging.integration.test.ts` követetlenül) **érintetlen maradt**:
a commit kizárólag a két fenti doc-fájlt tartalmazza.

Ha az ág később PR-ként megy, ez a commit a diffben doc-változásként fog látszani, és nem a
web-audit eredménye.
