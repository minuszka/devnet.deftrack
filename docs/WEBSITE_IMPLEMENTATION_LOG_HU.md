# Weboldaljavítás – végrehajtási napló

Terv: [20 napos ütemterv](WEBSITE_IMPLEMENTATION_ROADMAP_HU.md).
Kezdeti állapot: **tervezett, implementáció még nem indult**. Ezt a fájlt az implementáló naponta frissítse.

Státuszok: TERVEZETT; FOLYAMATBAN; KÓD KÉSZ / ELLENŐRZÉS FÜGGŐ; ELLENŐRZÖTT; BLOKKOLT. A deploy külön mező, nem következik az ELLENŐRZÖTT státuszból.

| Nap | Rövid feladat | Státusz | Commit / bizonyíték |
|---|---|---|---|
| 01 | Baseline és UI-tesztek | ELLENŐRZÖTT | `web/audit-2026-09-11`; K1 zöld (820+80 unit), K2 zöld (8 böngészőteszt), két negatív kontroll pirosra vitte a suite-ot |
| 02 | Router | ELLENŐRZÖTT | `db77551`; K1 zöld (820+83 unit), K2 zöld (16 böngészőteszt); a javítás előtti viselkedés mérve |
| 03 | Adatfrissesség | ELLENŐRZÖTT | `c5c872c`; K1 zöld (820+98 unit), K2 zöld (23 böngészőteszt); negatív kontroll: a néma catch visszatéve 3 teszt pirosra vált |
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
  `router.ts`-be (` ` escape-nek szántam). A typecheck és a tesztek
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

## Auditpontok lezárási mátrixa

| Pont | Javító nap | Kód / commit | Ellenőrzés | Éles bizonyíték / korlát |
|---|---|---|---|---|
| F01 | 05–06 | Nyitott | — | — |
| F02 | 05–07 | Nyitott | — | — |
| F03 | 03 | `c5c872c` | unit: `freshness.test.ts` 15 eset; E2E: 7 eset szabályozott órával | Kliensoldalon lezárva. A `HealthSnapshot` nem közöl megfigyelési időbélyeget, így a forrásidő jelzése a `behind` marad |
| F04 | 08 | Nyitott | — | — |
| F05 | 09 | Nyitott | — | — |
| F06 | 09 | Nyitott | — | — |
| F07 | 02 | `db77551` | unit: 4 új eset a `router.test.ts`-ben; E2E: 3 eset böngészőben | **Részben.** A kliensoldali hiba javítva és mérve; dokumentumbetöltéskor ezek az URL-ek el sem jutnak a klienshez (dev szerver 404), a production nginx nem ellenőrzött → 14. nap |
| F08 | 02 | `db77551` | unit: „names an unknown path…”; E2E: `/audit-nonexistent-20260911` | Kliensoldalon lezárva; a szerveroldali SPA fallback szándékosan változatlan |
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
