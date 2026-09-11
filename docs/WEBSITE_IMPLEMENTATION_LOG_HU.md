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
