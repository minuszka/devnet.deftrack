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

## Auditpontok lezárási mátrixa

| Pont | Javító nap | Kód / commit | Ellenőrzés | Éles bizonyíték / korlát |
|---|---|---|---|---|
| F01 | 05–06 | `8735d1d`, `5fd3307` | unit: `adminRunSelection.test.ts` 10 eset; E2E: 9 eset (F5, hibás kulcs, 404, A→B késői válasz, 401, draftszerkesztés) | Kliensoldalon lezárva. A vezérlés URL-ből visszatölthető, a mentett tervből; a recovery-bizonyíték új, redaktált végponton érhető el |
| F02 | 05–07 | Nyitott | — | — |
| F03 | 03 | `c5c872c` | unit: `freshness.test.ts` 15 eset; E2E: 7 eset szabályozott órával | Kliensoldalon lezárva. A `HealthSnapshot` nem közöl megfigyelési időbélyeget, így a forrásidő jelzése a `behind` marad |
| F04 | 08 | Nyitott | — | — |
| F05 | 09 | Nyitott | — | — |
| F06 | 09 | Nyitott | — | — |
| F07 | 02 | `db77551` | unit: 4 új eset a `router.test.ts`-ben; E2E: 3 eset böngészőben | **Részben.** A kliensoldali hiba javítva és mérve; dokumentumbetöltéskor ezek az URL-ek el sem jutnak a klienshez (dev szerver 404), a production nginx nem ellenőrzött → 14. nap |
| F08 | 02 | `db77551` | unit: „names an unknown path…”; E2E: `/audit-nonexistent-20260911` | Kliensoldalon lezárva; a szerveroldali SPA fallback szándékosan változatlan |
| F09 | 04 | `127e53d` | unit: minden sablon átmegy a `parseScenarioRequest`-en; HTTP: `simulationScenarios.integration.test.ts`; E2E: 8 eset | Kliens- és szerveroldalon lezárva. A valódi registry-alapú célpontválasztó a 16. nap; a `live` mód tényleges laborfutamát ez nem bizonyítja |
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
