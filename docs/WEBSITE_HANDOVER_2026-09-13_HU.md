# Weboldal-javítások — átadási csomag a független review-hoz

Dátum: 2026-09-13. A 20 munkanapos terv ([roadmap](WEBSITE_IMPLEMENTATION_ROADMAP_HU.md))
20. napjának kimenete. A napi részletek, mérések és negatív kontrollok a
[végrehajtási naplóban](WEBSITE_IMPLEMENTATION_LOG_HU.md) vannak; ez a dokumentum
az, amiből egy reviewer elindulhat, és amiből látja, **mi nincs még bizonyítva**.

A szöveg három státuszt tart végig külön, mert egy auditpont nem attól van
élesben lezárva, hogy a kódja elkészült:

- **Kód kész** — a mainben van, CI zöld.
- **Ellenőrzött** — automatikus teszt fedi, negatív kontrollal (a teszt a javítás nélkül bukik).
- **Élesben** — a devnet VPS ténylegesen ezt futtatja. Mérve, lásd a 3. pontot.

---

## 1. Mit adunk át

| | |
|---|---|
| Alap (baseline) | `main` @ `1feca84617b27ebb8048430b3c01022d8b48f19d` — a munka előtti állapot, 2026-09-11 |
| HEAD | a `web/day20-regression-handover` ág utolsó commitja (ez a dokumentáció; az utolsó kód-commit `46ac9da`), PR #174; merge után a `main` |
| Weboldal-PR-ok | #162 (1–10. nap), #164 (J1–J3, a 2026-09-12-i review javításai), #165–#173 (11–19. nap), #174 (20. nap) |
| Terjedelem | az alap óta 82 commit, ebből 14 merge; `git diff --shortstat 1feca84..HEAD`: a dokumentációs commit előtt 149 fájl, +23 444 / −495 sor |

**Az alap–HEAD diffben benne van, de nem ennek a munkának a része** — a devnet-ügynök
párhuzamos munkája, ugyanabba a `main`-be. Ezeket a review-nak nem kell ennek a
tervnek a mércéjével mérnie, de a diffben látni fogja őket:

| PR / commit | Tárgy | Érintett fájlok |
|---|---|---|
| #160 (`eadb127`) | DSL epoch v2 | `client/src/components/dd-page-dsl.ts`, `ops/backfill-epoch-observed.cjs`, `server/src/{models/ServiceEpoch,routes/v1/dsl.v1.routes,services/rpc.service,services/sync.service}.ts`, `server/src/integration/sync.integration.test.ts`, `shared/src/index.ts` |
| #161 (`50db059`) | backfill gyűjteménynév | `ops/backfill-epoch-observed.cjs` |
| #163 (`83b8710`) | DSL „unjudged" főcím, flotta-roll szkriptek | `CLAUDE.md`, `client/e2e/dsl-no-verdict.spec.ts`, `client/src/components/dd-page-dsl.ts`, `ops/fleet-roll-dslv2*.sh`, `ops/seed-roll-dslv2.sh`, `server/src/routes/v1/dsl.v1.routes.ts`, `shared/src/index.ts` |
| `a42a50b` | doc-only: flottamérések, Sentinel-mérési csapda | `CLAUDE.md`, `plan.md` (a naplóban külön jegyzet: „Idegen commit az ágon") |

## 2. Hogyan reprodukálható

Tiszta, külön checkoutban (Windows és WSL ne ossza a `node_modules`-t). Helyben
Node 24, a CI Node 22-vel fut; mindkettőn zöld.

```text
git clone <repo> fresh && cd fresh && git checkout <HEAD>
npm ci
npm run build -w shared
npm run typecheck
npm test
npm run build
git diff --check
CI=1 npm run test:e2e -w client          # K2: böngészős, szintetikus API-val
MONGODB_TEST_URI=mongodb://127.0.0.1:27018 npm run test:integration   # K3: eldobható, auth nélküli mongod
CI=1 npm run test:csp -w client          # a buildelt kliens az enforce CSP alatt
npm run review:shots -w client           # képek, lásd a 12. pontot
```

A K3-hoz egy eldobható mongod kell (`CLAUDE.md`, „Local development environment"); a
`deftrack_devnet` soha nem tesztadatbázis, és a tesztsegéd az ilyen URI-t visszautasítja.

**A 20. napon egy friss klónban mérve** (a HEAD `cc304bd`-n, a dokumentáció commitja előtt):

| Kapu | Parancs | Eredmény |
|---|---|---|
| K0 | Node/npm, lockfile, git | Node v24.7.0, npm 11.5.1; `.node-version` 24; `package-lock.json` sha256 `2f72d372cf5d6dac7bc2e68a656971236a9791fe5cd163f80173f9a3177ffb78`; a munkafa a klón után és a build után is tiszta; `npm ci` exit 0 |
| K1 | `npm run build -w shared`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` | mind exit 0 — **864** szerver (92 fájl) + **202** kliens (18 fájl) unit teszt |
| K2 | `CI=1 npm run test:e2e -w client` | **nem tiszta.** 1. futás (5,4 perc): 230 zöld, 1 bukott — `accessibility.spec.ts` „the target table carries its caption": az oldal JavaScriptje 10 s alatt el sem indult (a futás naplójában ennél a tesztnél hiányzik a minden oldalbetöltéskor megjelenő Lit-figyelmeztetés); önmagában 8/8-szor zöld. 2. futás (25,3 perc — közben a másik checkoutban buildet és CSP-kaput futtattam): 229 zöld, 2 bukott, mindkettő navigációs időtúllépés a két nagy elrendezésmérésben. **Egyik futásban sem bukott viselkedési állítás.** Az első futás hibaképét a CSP-kapu törölte (ugyanaz a kimeneti mappa volt) — ezt a `46ac9da` javítja |
| K3 | `MONGODB_TEST_URI=mongodb://127.0.0.1:27018 npm run test:integration` | exit 0 — 15 fájl, 98 teszt (8 kihagyott: az adatbázis nélküli párdarabok); a futás végi szivárgás-ellenőrzés nem talált hátrahagyott adatbázist |
| CSP | `CI=1 npm run test:csp -w client` | exit 0 — 4 eset |
| audit | `npm audit --omit=dev` | 2 moderate (az elfogadott F13-maradék) |

A CI eredménye a PR-on: a #174 PR `Typecheck, test, build`, `Scripts, Dockerfile and units` és `Secret scan` jobjai (push és pull_request esemény); ez a tiszta környezetű K2 is.

## 3. Mi fut élesben — mérve, 2026-09-13

Csak olvasással, a VPS-en:

| | |
|---|---|
| Szerver és kliens | `/opt/devnet-deftrack/app` @ `83b8710` (a #163 merge), a szolgáltatás 2026-09-12 16:17 óta fut; a `/var/www/devnet.deftrack` bundle ugyanabból a buildből, 16:17 |
| Ebben benne van | #162 — az **1–10. nap** |
| Ebben nincs benne | #164 (**J1–J3, az R1–R7 review-javítások**), #165–#173 (11–19. nap), és a 20. nap |
| nginx | a 14. napi biztonsági fejlécek **élnek** (közvetlenül a host konfigurációjában, nem a repó deployjával): CSP **report-only**, HSTS 2 év, a négy korábbi fejléc; lásd a 9. pontot |

**Következmény, kimondva:** a 2026-09-12-i független review által talált hibák (R1–R7,
az F01/F02/F05/F06 újranyitása és a draft-idempotencia) **a VPS-en ma is megvannak**;
a javításuk a mainben van, tesztelve, de nincs telepítve. A 13. napi függőségjavítás
(body-parser) sincs kint. A deploy a terv szerint külön lépés (10. pont).

## 4. F01–F14 — újraellenőrzés

Minden sor: a javító commit(ok), az automatikus teszt, a böngészős/HTTP-bizonyíték, a
három státusz, és ami nincs bizonyítva. A részletes mérések és negatív kontrollok
napra bontva a naplóban.

| Pont | Javító commit | Automatikus teszt (böngésző / unit / HTTP) | Kód kész | Ellenőrzött | Élesben | Ami nincs bizonyítva / korlát |
|---|---|---|---|---|---|---|
| F01 futamkiválasztás | 05–06. nap `8735d1d` `5fd3307`; J1 `4972341`; J4 `96e6e30` (V1) `451e3e8` (V3) | `run-selection.spec.ts` (13), `adminRunSelection.test.ts` (10); J4: `run-status.spec.ts` V1-esetek (6), `admin.spec.ts` belépés (3) | igen | igen, mindkét review ellenpróbáival | **részben** — a 05–06. napi változat; az R1/R2/R4 és a V1/V3 javítás nem | valódi laborfutamon nem mérve |
| F02 frissülő futamállapot | 05–07. nap `c1e3605`; J2 `4261e06`; J4 `2e2d56c` (V2) `11bbe63` (V7); J7 `6c94aa0` (W2); J8 `d0f28fe` (X1) | `run-status.spec.ts` (14, szabályozott órával; J4: +4 V2, +6 V7; J7: +4 W2; J8: +10 X1), `simulationRunState.test.ts` | igen | igen | **részben** — az R3, a V2/V7, a W2 és az X1 javítás nem | a mentett terv egyszer olvasódik; laborfutam nincs |
| F03 adatfrissesség | 03. nap `c5c872c` | `freshness.spec.ts` (7), `freshness.test.ts` (15) | igen | igen | igen | a `HealthSnapshot` nem közöl megfigyelési időbélyeget |
| F04 kísérletlista | 08. nap `6c6fc96` | `experiments.spec.ts` (8), `experimentPaging.integration.test.ts` (7) | igen | igen | igen | — |
| F05 Fairness profil | 09. nap `881df65`; J3 `6913d1d`; J7 `f2a4873` (W4) | `fairness.spec.ts` (8; J7: +3 W4), HTTP-szűrési teszt | igen | igen | **részben** — az R5 és a W4 javítás nem | — |
| F06 registry-létszám | 09. nap `881df65`; J3 `e860556` | domain unit (4), `fairnessSelection.integration.test.ts` | igen | igen | **részben** — az R6 javítás nem | — |
| F07 hibás escape | 02. nap `db77551`; 14. nap `5262482` | `router.test.ts` (4), `router.spec.ts` (3); élő nginx: 400 | igen | igen | igen | — |
| F08 ismeretlen útvonal | 02. nap `db77551` | `router.test.ts`, `router.spec.ts` | igen | igen | igen | a szerveroldali SPA fallback szándékosan változatlan |
| F09 scenario-alapértékek | 04. nap `127e53d`; 15–16. nap `d7469ff` `e4c16d5`; J6 `b7ee9f8` (V5) | `scenario-forms.spec.ts` (10; J6: +5 V5), `complex-scenarios.spec.ts` (15), `scenarioFields.test.ts` (11), `simulationScenarios.integration.test.ts` | igen | igen | **részben** — a 04. nap igen, a 15–16. napi űrlapok és a V5 javítás nem | a `live` mód valódi laborfutama nincs; a review V5-próbája a zárolt mezőn időtúllépésre fut (elfogadott, 14. pont) |
| F10 biztonsági fejlécek | 14. nap `5262482`; 20. nap `694d5cc` (egy HSTS-tulajdonos) | izolált nginx-mérés (`verify-headers.sh`), `csp.spec.ts` (4), `httpHardening.test.ts` | igen | igen | **részben** — nginx-fejlécek élnek, CSP report-only; a helmet HSTS kivétele nem, ezért az `/api/` ma is két HSTS-t küld | az enforce-ra váltás nincs megtéve (9. pont) |
| F11 URL-szűrők | 10. nap `700c420`; 11. nap `b954e9b`; J5 `dc05f11` (V4); J7 `35899d4` (W1) | `query-state.spec.ts` (22); J5: `query-identity.spec.ts` (17); J7: `public-simulations.spec.ts` +3 (W1) | igen | igen | **részben** — a 10. napi három oldal igen, a 11. napiak, a V4 és a W1 javítás nem | PoSe, ChainLocks, Sentinel Layer szándékosan paraméter nélkül; a Fairness tip-vezérelt profilváltási rése mérve és javítva (W4, F05 sor) |
| F12 szemantika, fókusz | 12. nap `1828831`; 18. nap `fc4652d` (cím nélküli részletoldalak); 20. nap `611fdde` (`aria-pressed`) | `accessibility.spec.ts` (h1 minden útvonalon négy állapotban, fókusz, skip link, toggle-sweep), `navigation.spec.ts` (14) | igen | igen | nem | számított fókusz- és szerkezetmérés, nem képernyőolvasós tanúsítás |
| F13 függőségek | 13. nap `5b8b5a7`; 20. nap `694d5cc` | `npm audit` előtte/utána; `httpHardening.test.ts` (6: a lapos query-feldolgozás valódi kérésen, urlencoded nincs, forrás-sweep mindkét szerverre) | igen | igen | nem (a VPS a 13. nap előtti lockfile-lal fut) | **elfogadott maradék:** 2 moderate `qs` az express 4 saját pinje miatt. Az elfogadás feltevése (simple parser, nincs urlencoded) a 20. napon derült ki, hogy **csak a fő szerverre volt igaz**; a labor-szerverre (`labServer.ts`, alapból `127.0.0.1`) nem. Javítva és teszttel védve, de nincs telepítve |
| F14 kontraszt | 12. nap `1828831` | `contrast.test.ts`, `accessibility.spec.ts` (mindkét téma) | igen | igen | nem | — |
| R7 (review) draft-idempotencia | J2 `4261e06` | `draftIdentity.test.ts` (12), `run-status.spec.ts` | igen | igen | nem | — |
| V6 (végső review) export-besorolás | J6 `f119407` | `simulations.test.ts` (+1), `public-simulations.spec.ts` valódi letöltéssel (+1) | igen | igen | nem | — |

A 15–19. nap nem auditpont, hanem a terv termékfolyamata (űrlapok, publikus
szimulációs eredmények, navigáció és mobil, keresés és súgó); egyik sincs élesben.

## 5. A 20. nap célzott javításai

Új funkció nincs. Mindegyik a regressziós körben talált hiba, külön commitban, teszttel
és negatív kontrollal:

| Commit | Mit javít | Hogyan találtam |
|---|---|---|
| `694d5cc` | egy közös `hardenHttpApp()` a fő és a labor-szervernek (simple query parser, helmet **HSTS nélkül**, x-powered-by ki); tesztek, amelyekre az F13 elfogadása ténylegesen támaszkodik | a helmet-konfiguráció olvasásakor derült ki, hogy a labor-szerver nem állítja a parsert |
| `5d04fce` | az integrációs tesztek adatbázisai tényleg eltűnnek; egy futás, ami hagy egyet, **bukik** | 167 hátrahagyott adatbázis, mind üres gyűjtemény indexekkel |
| `611fdde` | `aria-pressed` a staking nézetváltón, és sweep minden toggle-csoportra | a 12. nap óta nyitott tétel |
| `ecea0ec` | a health-grafikon `ResizeObserver` hibája | a 18. napon mérve, a mainen is megvolt |
| `f8354e6` | a publikus mérési riport teljes mezőleltára rögzítve, két al-objektum név szerint | a 17. napi maradék |
| `56e85f3` | **egy sikertelen betöltés többé nem látszik üres rekordnak** (Blocks, Transactions, DKG Rounds, PoSe Watch, Operators, Overview), Fairness: „nem olvasható" ≠ „nincs" | minden publikus oldal 401/404/429/500 mögött |
| `a436d6b` | az admin panel nem folyik túl tableten és telefonon | az admin 360/390/768/1440 px-es mérése |
| `cc304bd` | review-képek igény szerint | — |

## 6. DTO- és szerződésváltozások

Mind **additív** vagy szűkítő (egy mező kevesebb kerül ki), törölt publikus mező nincs:

- **Publikus szimulációs futam** (17. nap, `2a2e791`): `state.lastTransition` és `dataQuality`
  név szerint másolva; egy `missingHeights` nélküli régi dokumentumon a mező `null` (azelőtt
  kimaradt a válaszból). Egy tárolt al-objektumba ültetett ismeretlen mező többé nem jelenik meg.
- **Publikus mérési riport** (17. és 20. nap): `anchor`, a `byProfile` sorok `rounds` mezője és
  a `hostGrouping` név szerint; a teljes kulcsleltár tesztben rögzítve.
- **Admin scenario-descriptor** (15–16. nap): új `fields` metaadat (`kind`, `target`, `maxWhen`),
  és `liveAppliesFaults`. Egy régebbi szerver ezeket nem küldi; a kliens ilyenkor nem talál ki semmit.
- **HTTP-fejléc** (20. nap): a szerver nem küld `Strict-Transport-Security`-t; az nginx küldi.
  **Telepítési sorrend:** a szerver deployja után az `/api/` egyetlen HSTS-t küld.
- **Publikus szimulációs export** (J6, `f119407`): a letölthető fájl `schemaVersion` 1 → **2**, új
  `reportRead` mezővel (`present` / `absent` / `unavailable`). A `report` `absent` és `unavailable`
  mellett is `null`; a kettőt a besorolás különbözteti meg. HTTP-státusz és szerverszöveg nem kerül a
  fájlba. Kliensoldali fájlformátum — a szerver publikus DTO-ja nem változott. Egy 1-es verziójú fájlból
  a különbség utólag nem állapítható meg.

## 7. Függőségek

- Új dev-függőség: `@playwright/test` **1.62.1** (pontos pin, 1. nap), a Chromiumot a verzió választja.
- Lockfile: `body-parser` 1.20.6 → 1.20.8 (13. nap). Futásidejű új függőség nincs.
- `npm audit`: 2 moderate — az elfogadott F13-maradék, a 13. nap óta változatlan

## 8. Nyitott hibák és elfogadott kockázatok

| Tétel | Státusz | Miért |
|---|---|---|
| A 11–20. nap és az R1–R7 javítás nincs élesben | **nyitott — deploy kell** | 10. pont |
| CSP report-only, nem enforce | nyitott, döntés | az enforce házirend a buildelt bundle-on tisztán fut (`csp.spec.ts`); a report-only értelme, hogy valós forgalmat is lásson |
| F13: 2 moderate `qs` | elfogadott | express 4 pin; a kódút mindkét szerveren teszttel zárva (5. pont) |
| A laborfutam nem futott | nyitott | 11. pont |
| A shell-bundle nőtt | tudomásul véve | 221 → 253 kB (gzip 49 → 58 kB) a 18–19. nap alatt; lazy loading nincs |
| Az előnézet nem mutat profilnevet | elfogadott | a mentett terv DTO-ja nem hordozza, nem találtam ki (16. nap) |
| proTxHash-keresés | backlog | nincs masternode-részletoldal (a napló „Backlog" szakasza) |
| Telefonon a fejléc ~370 px a menü előtt | tudomásul véve | a terv nem kéri a fejléc átrendezését |
| A táblázat-görgetési jelzés az adminban nincs | tudomásul véve | a 18. nap a publikus shellre szólt; az admin túlfolyása javítva (`a436d6b`), a jelzés nem |
| A 4 workeres skip-link flake (16. nap) | nem reprodukálódott | az azóta futtatott teljes suite-okban nem jelent meg; CI egy workerrel fut |
| A friss klón K2-je nem volt tiszta (2. pont) | **nyitott, figyelendő** | egy nem induló oldal és két navigációs időtúllépés, viselkedési hiba nélkül; ha a CI-ban is megjelenik, a dev szerver alatti tesztidőzítés a gyanúsított. **2026-09-13:** a 12 végigfutott helyi K2-ből 2-ben egy-egy üres oldal; a trace-ben mindkétszer `net::ERR_NO_BUFFER_SPACE` a `/src/main.ts` betöltésén. Ez tünet, nem gyökérok; a TIME_WAIT-hipotézist a mérés nem igazolta (14. pont). **2026-09-14:** a harmadik review teljes K2-jében egy bukás, a trace-ben `ERR_NO_BUFFER_SPACE` a `dd-page-rounds.ts` betöltésén. A J8 három teljes K2-jéből kettő nem volt tiszta (2, illetve 1 bukás, mindegyik trace-ében ugyanez), a harmadik igen; a TIME_WAIT-csúcs a tiszta futásban is ugyanakkora volt (1062, a hibásakban 1070 és 1045) (16. pont). A negyedik review teljes K2-je (külön worktree-ben) 299/299 volt, bukás nélkül; ez a korábbi hibákat nem cáfolja |
| A J4–J6 (V1–V7), a J7 (W1–W4) és a J8 (X1, X2) javítás nincs élesben | **nyitott — deploy kell, külön engedéllyel** | a független review-k mindet lezárták: a V1–V7-et a második (a V4-et részben) és a harmadik, a W1, W3, W4-et a harmadik, a W2-t (X1-gyel) és az X2-t a negyedik review; 14., 15. és 16. pont |
| Kezdeti olvasások: egy 503 elnyelte egy másik olvasás 401-ét | **lezárva kódban és tesztben (J8, `d0f28fe`); a negyedik review elfogadta** | a harmadik review X1-e, a W2 maradéka: a `Promise.all` az első hibánál kilépett; most mindhárom válaszra vár, és a kiválasztás-ellenőrzés után bármelyik 401 lezárja a sessiont |
| A W3 negatív kontrolljában egy időzítő bezárt lapot hívott | **lezárva (J8, `504b8cd`); a negyedik review elfogadta** | a harmadik review X2-e: teszthiba, nem alkalmazáshiba; a kontroll most csak a várt hibával bukik |
| Az X1 két mellékhatása nincs a rendes kapuban | tudomásul véve — a review elfogadta | a késleltetett terv-hibaüzenet melletti abort és a kettős 503-nál a terv hibája csak a negyedik review saját próbáiban van mérve (`docs/review-2026-09-14-x1-x2/effects.spec.ts`, 3/3), a rendes kapuban nem |
| Gyenge mintájú régi teszt | **lezárva kódban és tesztben (J7, `c82db16`)** | „a poll describing an older state cannot undo an action” a válasz feldolgozása előtt állított (J4 lelet, a review megerősítette). Mérve: a régi változat is 3/3 elkapta a hibát — konstrukciós, nem megfigyelt hiba volt; most megvárja a régi válasz elolvasását |
| Fairness: tip-vezérelt profilváltás | **lezárva kódban és tesztben (J7, `f2a4873`)** — előtte: nyitott, nem mérve | ha a tip átlép egy aktiválási magasságot és az új profil kérése hibázik, a régi profil adata az új „at the tip” gomb alatt maradhat — kódolvasásból; a review böngészőben reprodukálta (W4) |
| A `ResponseGate` URL szerinti olvasás-azonosítása | **lezárva (J7, `2bd3139`)** | a #175 saját harness-hibája (W3): a `release()` egy azonos URL-ű másik válasz olvasását is elfogadta; most válaszonkénti azonosító |
| A harness teardown-kori megszakítása | tudomásul véve | a teszt vége után visszatartott kérés megszakításának nincs saját tesztje a rendes kapuban; a teljes suite-ok csak azt mutatják, hogy semmit nem akaszt meg. **2026-09-14:** a harmadik review saját C4-e az `abandonHeld()` primitívet méri (zöld); a teljes fixture-életciklusra a review sem általánosítja |

## 9. nginx — beillesztés, jelenlegi állapot, rollback

A teljes eljárás: [NGINX_HEADERS_RUNBOOK_HU.md](NGINX_HEADERS_RUNBOOK_HU.md). A 14. napon
telepítve, a runbook szerint mentett vhosttal. A snippetek: `ops/nginx/security-headers.conf`,
`ops/nginx/csp-report-only.conf`, `ops/nginx/csp-enforce.conf`; izolált mérés:
`ops/nginx/verify-headers.sh` a `test-vhost.conf`-fal.

- **Enforce-ra váltás:** a `csp-enforce.conf` tartalma ugyanarra a snippet-névre, `nginx -t`,
  reload, majd az élő válaszok mérése a runbook szerint.
- **Rollback:** a runbookban rögzített vhost-mentés visszamásolása, `nginx -t`, reload.
- **Az `/api/` HSTS-e:** a szerver deployja után várhatóan egy fejléc marad (az nginxé). Ezt élesben
  mérni kell, mielőtt lezártnak számít.

## 10. Deploy — külön lépés, javasolt sorrend

A terv szerint a review után, külön döntéssel:

1. `ops/deploy.sh` a VPS-en a merge-elt `main`-ről (szerver + kliens; a szkript ellenőrzi, melyik bundle-t szolgálja ki a webroot).
2. Élő mérés: `/`, `/rounds`, `/admin`, egy asset, egy ismeretlen útvonal és az `/api/v1/health` fejlécei; az `/api/` alatt egy HSTS.
3. A 17–19. nap oldalai élesben (`/simulations`, `/search`, `/methodology`, `favicon.svg`).
4. Csak ezután, külön: a CSP enforce-ra váltása (9. pont).

## 11. Laborfutam

**NEM FUTOTT — nem futtatott labor-elfogadás.** Ehhez a megbízáshoz nincs külön engedélyezett
izolált regtest-laborfuttatás, és a terv tiltja a valódi hálózati faultot. A szimulátor UI-t
böngészős tesztek fedik szintetikus API-válaszokkal; ez **UI-bizonyíték, nem Core- vagy
laborbizonyíték**. A normál futam és a külön abort/recovery futam mérési és hostoldali
helyreállítási bizonyítéka hiányzik.

## 12. Képek és trace-ek

- `npm run review:shots -w client` → `client/review-shots/` (git nem követi): 17 kép, szintetikus
  fixtúrából, a hibás, betöltési, üres, elutasított, kijelentkezett és telefonos utakról is.
- Böngészős trace és hiba-képernyőkép: `client/test-results/` helyben; a CI csak **hibás** futásnál
  tölti fel artefaktumként (`client-browser-tests`, 7 nap).
- A 2026-09-12-i review ellenpróbái: [review-2026-09-12/](review-2026-09-12/).
- A **2026-09-13-i végső review** ([jelentés](WEBSITE_FINAL_REVIEW_2026-09-13_HU.md)) ellenpróbái:
  [review-2026-09-13/](review-2026-09-13/). A futásuk trace-ei és hibaképei a repón kívül vannak
  megőrizve: `D:\www\devnet .deftrack-review-artefacts\2026-09-13\`, 21 fájl és egy `SHA256SUMS`
  (sha256 `6e3c03440ef964a19fc6f674cc9915da0691a915d643e5ecc1533879f2e4756a`). Ellenőrzés:
  `sha256sum -c SHA256SUMS` a mappában. A jelentés eredetileg a `client/test-results/review-final/`
  mappára hivatkozik, de azt a böngésző-suite következő futása kiüríti.
- Az **ismételt review** ([jelentés](WEBSITE_REVIEW_V1_V7_2026-09-13_HU.md)) mellékletei:
  [review-2026-09-13-followup/](review-2026-09-13-followup/); a futásainak trace-ei a repón kívül:
  `D:\www\devnet .deftrack-review-artefacts\2026-09-13-followup\`, 22 fájl, `SHA256SUMS` sha256
  `de50d0ac8fbda907df031a80b07819a8947679e0196c3d253fc517e41d47259a`.
- A **harmadik review** ([jelentés](WEBSITE_REVIEW_W1_W4_2026-09-14_HU.md)) mellékletei:
  [review-2026-09-14/](review-2026-09-14/) (UTF-8 naplók); a kimenetei (`artifacts/`, `generated/`) a repón
  kívül: `D:\www\devnet .deftrack-review-artefacts\2026-09-14\`, 61 fájl, `SHA256SUMS` sha256
  `f27855033ef9c19ab0e9f6752221822e93df6f6e3a7724c534af89e05c47cf8c`.
- A **negyedik review** ([jelentés](WEBSITE_REVIEW_X1_X2_2026-09-14_HU.md)) mellékletei:
  [review-2026-09-14-x1-x2/](review-2026-09-14-x1-x2/) (UTF-8 naplók; a config és a mellékhatás-próbák a
  `D:\www\deftrack-review-458b6d0` review-worktree-re mutatnak). A kimenetei (`artifacts/`, `generated/`) a
  repón kívül: `D:\www\devnet .deftrack-review-artefacts\2026-09-14-x1-x2\`, 33 fájl, `SHA256SUMS` sha256
  `5474c3a49ae2a9ce5d557a34a27f3f048ff80346b8f9a853abeba6f2138e6bfc`.

## 13. Amit a review-nak külön érdemes néznie

- **A 3. pont következménye.** Élesben az R1–R7 előtti kód fut; ha a review élő oldalon ellenőriz, azt méri.
- **A 20. napi `56e85f3`** hat oldal renderelési ágát változtatja (betöltött-e már egyszer); a „sikertelen frissítés megtartja az utolsó jó adatot" viselkedést teszt fedi, de érdemes egy lapozott oldalon (2. oldal hibája) is ránézni: ott a korábbi oldal sorai maradnak az új oldalszám alatt — ez a 3. napi döntés öröksége, nem új. **2026-09-13:** a végső review ezt V4-ként igazolta; a J5 hét oldalon javította (14. pont).
- **Két elavult-keresés őr** (19. nap): a teszt csak mindkettő kivételekor bukik; a második őr egy ablaka érvelés, nem bizonyíték (a kódkomment is így mondja).
- **A labor-szerver hardeningje** (`694d5cc`) a fő szerverével azonos függvény; a labor-szervert valódi laborban nem indítottam el.

## 14. A végső review javításai — J4–J6 (2026-09-13)

A végső független review ([jelentés](WEBSITE_FINAL_REVIEW_2026-09-13_HU.md)) a `39e7f80`-on hét
megmaradt hibát igazolt. Mind a hét javítva van kódban és tesztben a `web/review-fixes-2026-09-13`
ágon; **egyik sincs élesben**, és a **független újra-review még nem történt meg**. A részletek, a
negatív kontrollok és a menet közbeni leletek a naplóban: J4, J5, J6.

| ID | Mit javít | Commit | Teszt (a rendes kapuban) | Negatív kontroll | A review ellenpróbája |
|---|---|---|---|---|---|
| — | visszatartott válaszok a harnessben: a teszt mondja ki a sorrendet, a `release()` az elolvasás után tér vissza | `e529b4e` | `harness.spec.ts` (+4) | 4 | — |
| V1 | késői terv nem tekerheti vissza a futamot; a terv olvasási hibája megtartja a futamot és az abortot, terv nélkül nincs preflight/élesítés/indítás | `96e6e30` | `run-status.spec.ts` (+6) | 7 | zöld |
| V2 | az idővonal és a bizonyíték olvasásai nem mehetnek visszafelé | `2e2d56c` | `run-status.spec.ts` (+4) | 5 | zöld |
| V7 | olvashatatlan bizonyíték nem „nincs rögzítve”; csak olvasó újraolvasás | `11bbe63` | `run-status.spec.ts` (+6; egy J2-teszt szigorítva) | 7 | zöld |
| V3 | sikeres belépés azonnal betölti a dashboardot | `451e3e8` | `admin.spec.ts` (+3) | 3 | zöld |
| V4 | az adat csak a saját lekérdezése alatt látszik — hét oldalon; a harness jelzi a megszakított kérést | `dc05f11` | `query-identity.spec.ts` (+17), `harness.spec.ts` (+1) | 9 + 2 | zöld |
| V5 | olvashatatlan Advanced JSON mellett zárolt szerkesztők, explicit eldobás | `b7ee9f8` | `scenario-forms.spec.ts` (+5) | 6 | időtúllépés a letiltott mezőn — a reviewer előre elfogadta |
| V6 | az export kimondja, elolvasta-e a riportot (`schemaVersion` 2) | `f119407` | `simulations.test.ts` (+1), `public-simulations.spec.ts` (+1) | 8 | zöld |
| — | a CSP-kapu saját HTML-riport mappája; a „Vite reload” mérve cáfolva | `ad033ba` | mérés (lásd a J6-ot) | a javítás előtti állapot mérése | — |

**Kapuk az ág végén (`ad033ba`):** K1 exit 0 — **864** szerver + **203** kliens unit; K2 **277** zöld;
K3 exit 0 — 15 fájl, **98** teszt, 8 kihagyott (a Mongo nélküli párdarabok); CSP **4**. A 12 végigfutott
helyi K2-ből kettőben egy-egy teszt környezeti hibával (`ERR_NO_BUFFER_SPACE`) bukott, és az újrafutás
tiszta volt; a projekt szabálya szerint ez nem siker, hanem nyitott tétel (8. pont).

**A reviewer bizonyítékai** a repón kívül, ellenőrizhetően megőrizve (12. pont).

**Oldal-leltár a V4-hez:** Blocks, Transactions, DKG Rounds, Experiments, Simulations lista, Staking és
Vantage points érintett volt és javítva; a Fairness a lekérdezés-váltásnál nem volt érintett; a PoSe
Watch és az Operators nem értelmezhető (nincs lekérdezés).

**Deploy:** a 10. pont sorrendje változatlan; a J4–J6 a 11–20. nappal és a J1–J3-mal együtt kerülne ki,
külön engedéllyel, a független újra-review után.

## 15. Az ismételt review hibajegyei — J7 (2026-09-13/14)

Az ismételt független review ([jelentés](WEBSITE_REVIEW_V1_V7_2026-09-13_HU.md)) a `72fec82`-n V1, V2, V3,
V5, V6 és V7 eredeti hibáját lezárta, a V4-et részben fogadta el, új P1-et nem talált, és négy P2
hibajegyet adott. Mind a négy javítva van kódban és tesztben a `web/review-fixes-2026-09-13-2` ágon;
**egyik sincs élesben**, és a **független újra-review még nem történt meg**. Részletek: napló, J7.

| ID | Mit javít | Commit | Teszt (a rendes kapuban) | Negatív kontroll | A review ellenpróbája |
|---|---|---|---|---|---|
| W3 | a `ResponseGate.release()` a saját válaszára vár, nem az URL egy újabb olvasására | `2bd3139` | `harness.spec.ts` (+2) | 1 — korai visszatéréssel bukik | zöld |
| W2 | a recovery- és history-olvasás 401-e lezárja a sessiont, a kiválasztás-ellenőrzés után | `6c94aa0` | `run-status.spec.ts` (+4) | 5 | zöld — a harmadik review részben fogadta el: X1, 16. pont |
| W1 | a Simulations lista azonos lapjának pollhibája megtartja a listát | `35899d4` | `public-simulations.spec.ts` (+3) | 3 | zöld |
| W4 | a Fairness adata az ablakhoz és a követett profilhoz kötve | `f2a4873` | `fairness.spec.ts` (+3) | 4 | zöld |
| — | a régi pollteszt megvárja a régi válasz elolvasását | `c82db16` | `run-status.spec.ts` (1 szigorítva) | 1 (3/3) | — |

**Kapuk az ág végén (`c82db16`):** K1 exit 0 — **864** szerver + **203** kliens unit; K2 **289** zöld,
első futásra; K3 exit 0 — 15 fájl, **98** teszt, 8 kihagyott (a Mongo nélküli párdarabok); CSP **4**;
a review öt ellenpróbája (W1–W4, C2) zöld.

**A review mellékletei** a repóban (`docs/review-2026-09-13-followup/`; a naplók a review által írt UTF-16
kódolásban, ezért a git binárisnak mutatja őket), a futásainak trace-ei a repón kívül (12. pont).

**Deploy:** a 10. pont sorrendje változatlan; a J4–J7 együtt kerülne ki, külön engedéllyel, a független
újra-review után. A review deploy-véleménye: a megfigyelő webfelület kiadása mérlegelhető; a live szimulátor
elfogadásához továbbra is valódi laborbizonyíték kell.

## 16. A harmadik review maradéka — J8 (2026-09-14)

A harmadik független review ([jelentés](WEBSITE_REVIEW_W1_W4_2026-09-14_HU.md)) az `eb76773`-n a W1-et, a W4-et
és a V4-et lezárhatónak, a W3-at a harness működésére lezárhatónak, a régi pollteszt szigorítását indokoltnak
találta. A W2-t részben fogadta el; egy P2 maradékot (X1) és egy P3 teszthibát (X2) adott, új P1-et nem.
Mindkettő javítva van kódban és tesztben ugyanazon az ágon (#176); **egyik sincs élesben**, és a **független
újra-review még nem történt meg**. Részletek: napló, J8.

| ID | Mit javít | Commit | Teszt (a rendes kapuban) | Negatív kontroll | A review ellenpróbája |
|---|---|---|---|---|---|
| X1 | a kezdeti terv-, idővonal- és bizonyíték-olvasás mindhárom válaszát megvárja; a kiválasztás-ellenőrzés után bármelyik 401 lezárja a sessiont, csak utána jelent olvasási hibát | `d0f28fe` | `run-status.spec.ts` (+10: 8 hibapár-sorrend eset, a review C3-a, az idővonal-hiba önmagában) | 6 | X1 ×2 zöld; C3 zöld |
| X2 | a W3 két öntesztje az értéket a `release()` után menti, a függő munka lezárása után állít | `504b8cd` | `harness.spec.ts` (2 teszt átírva) | a W3 kontrollja 3-3 ismétléssel: előtte 2 utólagos „has been closed”, utána 0 | — |

**Mellékhatás, kimondva:** a terv nélküli nézet üzenete a leglassabb kezdeti olvasás után jelenik meg, nem az
első hibánál; az abort addig is elérhető a pollból kapott futamon (a V1 tesztje ezt állítja). Ha a terv és az
idővonal is nem-401 hibával bukik, most rögzítetten a terv hibája látszik — erre nincs külön teszt.

**Kapuk az ág kódfején (`504b8cd`):** K1 exit 0 — **864** szerver + **203** kliens unit; K2 **299** zöld, első
futásra; K3 exit 0 — 15 fájl, **98** teszt, 8 kihagyott (a Mongo nélküli párdarabok); CSP **4**; a review
ellenpróbái: a korábbi öt **5/5**, az új négy **4/4**. A `d0f28fe` saját fáján két teljes K2 nem volt tiszta
(2 és 1 bukás, mindegyik trace-ében `ERR_NO_BUFFER_SPACE`, célzott újrafuttatás 3/3) — 8. pont.

**A review mellékletei** a repóban (`docs/review-2026-09-14/`, UTF-8 naplók); a kimenetei a repón kívül
(12. pont).

**Negyedik független review (2026-09-14, a `458b6d0`-n):** [jelentés](WEBSITE_REVIEW_X1_X2_2026-09-14_HU.md).
**X1 és X2 lezárva, új hibajegy nincs.** A catch-ágból kivett 401-ág a jelenlegi útvonalon valóban
elérhetetlen; a második W3-önteszt nem gyengült. A két mellékhatást a reviewer elfogadhatónak minősítette, és
saját próbákkal mérte (3/3), amelyek **nem részei a rendes kapunak** (8. pont). A reviewer kapui: K1 1067 unit,
K2 299/299 első futásra, K3 98 (8 kihagyott), CSP 4/4, ellenpróbák 5/5 és 4/4. Laborfutam: 0.

**Deploy:** a 10. pont sorrendje változatlan; a J4–J8 együtt kerülne ki, **külön tulajdonosi engedéllyel**. A
review-sorozat a negyedik kör után nem ad kiadást blokkoló hibajegyet. A live szimulátor engedélyezéséhez
továbbra is valódi laborbizonyíték kell; a megfigyelő webfelület kódelfogadása nem laborengedély.
