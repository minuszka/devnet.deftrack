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

| Pont | Javító nap | Kód / commit | Ellenőrzés | Éles bizonyíték / korlát |
|---|---|---|---|---|
| F01 | 05–06, **J1** | `8735d1d`, `5fd3307`, `4972341` | unit: `adminRunSelection.test.ts` 10 eset; E2E: 13 eset — a 9 eredeti plusz a review R1/R2/R4 ellenpróbái és a panel őrszemének fehér dobozos esete | **A review újranyitotta** (R1, R2, R4): futamváltás közben a régi futamra ment volna az abort, késői hiba törölte az újat, a megerősítés átvándorolt. A J1 mindhármat lezárta, őrszemenként külön negatív kontrollal |
| F02 | 05–07, **J2** | `8735d1d`, `5fd3307`, `c1e3605`, `4261e06` | unit: `simulationRunState.test.ts`; E2E: 14 eset szabályozott órával — a 8 eredeti plusz automatikus átmenet, sikertelen bizonyítékfrissítés, operátori recovery, Refresh, és a két idempotencia-eset | **A review újranyitotta** (R3): a státuszpoll csak a futamot frissítette, a bizonyítékot és az idővonalat nem, a Refresh pedig a kiválasztást nem olvasta újra. A J2 lezárta; a mentett terv továbbra is egyszer olvasódik |
| F03 | 03 | `c5c872c` | unit: `freshness.test.ts` 15 eset; E2E: 7 eset szabályozott órával | Kliensoldalon lezárva. A `HealthSnapshot` nem közöl megfigyelési időbélyeget, így a forrásidő jelzése a `behind` marad |
| F04 | 08 | `6c6fc96` | E2E: 8 eset (34 rekord végiglapozása, szűrő, betöltés/hiba/üres, részletváltás); HTTP: `experimentPaging.integration.test.ts` 7 eset | Kliensoldalon lezárva. A szerver eddig is helyesen lapozott és adta a valódi `total`-t; a kliens egyiket sem használta |
| F05 | 09, **J3** | `881df65`, `6913d1d` | E2E: 8 eset — a 4 eredeti plusz mozgó tip, átmeneti feloldási hiba utáni újrapróbálkozás, és az explicit profil + aggregát érinthetetlensége; HTTP: a szűrő tényleg szűkíti a mintát (2 / 1 / 3 kör) | **A review újranyitotta** (R5): a feloldás `_resolved === null` mögött ült, és a „nem feloldható” sem null, ezért mindkét válasz beragadt. A J3 lezárta; a profil-registry cache-e indokoltként megmaradt |
| F06 | 09, **J3** | `881df65`, `e860556` | unit: 4 eset a doménben, ebből egy dokumentált szerződéskorrekcióval; HTTP: 7/5 és 3/0 változatlanul, plusz egy az ablak után regisztrált host 1/0-val, amely nincs a `neverSelected`-ben; E2E: két oszlop, néma host, hiányzó mező `—` | **A review újranyitotta** (R6): a `currentRegisteredNodes` a történeti eligibility-vel szűrt, így nem a jelenlegi registry létszámát adta. A J3 lezárta; az eligibility a `neverSelected`-nél és a `roundsEligible`-nél maradt |
| F07 | 02 | `db77551` | unit: 4 új eset a `router.test.ts`-ben; E2E: 3 eset böngészőben | **Részben.** A kliensoldali hiba javítva és mérve; dokumentumbetöltéskor ezek az URL-ek el sem jutnak a klienshez (dev szerver 404), a production nginx nem ellenőrzött → 14. nap |
| F08 | 02 | `db77551` | unit: „names an unknown path…”; E2E: `/audit-nonexistent-20260911` | Kliensoldalon lezárva; a szerveroldali SPA fallback szándékosan változatlan |
| F09 | 04 | `127e53d` | unit: minden sablon átmegy a `parseScenarioRequest`-en; HTTP: `simulationScenarios.integration.test.ts`; E2E: 8 eset | Kliens- és szerveroldalon lezárva. A valódi registry-alapú célpontválasztó a 16. nap; a `live` mód tényleges laborfutamát ez nem bizonyítja |
| F10 | 14 | Nyitott | — | — |
| F11 | 10–11 | Nyitott | — | — |
| F12 | 12 | Nyitott | — | — |
| F13 | 13 | Nyitott | — | — |
| F14 | 12 | Nyitott | — | — |
| R7 (nem audit) | **J2** | `4261e06` | unit: `draftIdentity.test.ts` 12 eset; E2E: változatlan retry ugyanaz a kulcs, megváltozott payload új kulcs, és egy draftszerkesztés nem nyúl a futam még tartozó kulcsához | Lezárva. A kliens kanonikus formája szándékosan azonos a szerverével, így a kettő nem tud másképp gondolkodni arról, mi „ugyanaz a kérés” |

## Review checkpointok

- 07. nap: **elkészült**, lásd a checkpoint-összefoglalót a napi bejegyzések után.
- 14. nap: még nem készült el.
- 20. nap: még nem készült el.
- **Független review az 01–10. napról: 2026-09-12, hét igazolt találat**
  ([jelentés](WEBSITE_REVIEW_DAYS_01_10_2026-09-12_HU.md),
  [ellenpróbák](review-2026-09-12/regressions.spec.ts)). Mind a hét lezárva a
  J1–J3 javító munkanapokon; az ellenpróbák a rendes kapuban futnak.
- Független végső review a teljes munkáról: még nem történt meg.

A blokkot, kihagyott tesztet és fennmaradó sérülékenységet ne töröld ki egy későbbi bejegyzéssel: lezáráskor hivatkozz a bizonyítékra, hogy az előzmény követhető maradjon.

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
