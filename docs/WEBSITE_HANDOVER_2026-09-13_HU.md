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
| F01 futamkiválasztás | 05–06. nap `8735d1d` `5fd3307`; J1 `4972341` | `run-selection.spec.ts` (13), `adminRunSelection.test.ts` (10) | igen | igen, a review ellenpróbáival | **részben** — a 05–06. napi változat; az R1/R2/R4 javítás nem | valódi laborfutamon nem mérve |
| F02 frissülő futamállapot | 05–07. nap `c1e3605`; J2 `4261e06` | `run-status.spec.ts` (14, szabályozott órával), `simulationRunState.test.ts` | igen | igen | **részben** — az R3 javítás nem | a mentett terv egyszer olvasódik; laborfutam nincs |
| F03 adatfrissesség | 03. nap `c5c872c` | `freshness.spec.ts` (7), `freshness.test.ts` (15) | igen | igen | igen | a `HealthSnapshot` nem közöl megfigyelési időbélyeget |
| F04 kísérletlista | 08. nap `6c6fc96` | `experiments.spec.ts` (8), `experimentPaging.integration.test.ts` (7) | igen | igen | igen | — |
| F05 Fairness profil | 09. nap `881df65`; J3 `6913d1d` | `fairness.spec.ts` (8), HTTP-szűrési teszt | igen | igen | **részben** — az R5 javítás nem | — |
| F06 registry-létszám | 09. nap `881df65`; J3 `e860556` | domain unit (4), `fairnessSelection.integration.test.ts` | igen | igen | **részben** — az R6 javítás nem | — |
| F07 hibás escape | 02. nap `db77551`; 14. nap `5262482` | `router.test.ts` (4), `router.spec.ts` (3); élő nginx: 400 | igen | igen | igen | — |
| F08 ismeretlen útvonal | 02. nap `db77551` | `router.test.ts`, `router.spec.ts` | igen | igen | igen | a szerveroldali SPA fallback szándékosan változatlan |
| F09 scenario-alapértékek | 04. nap `127e53d`; 15–16. nap `d7469ff` `e4c16d5` | `scenario-forms.spec.ts` (10), `complex-scenarios.spec.ts` (15), `scenarioFields.test.ts` (11), `simulationScenarios.integration.test.ts` | igen | igen | **részben** — a 04. nap igen, a 15–16. napi űrlapok nem | a `live` mód valódi laborfutama nincs |
| F10 biztonsági fejlécek | 14. nap `5262482`; 20. nap `694d5cc` (egy HSTS-tulajdonos) | izolált nginx-mérés (`verify-headers.sh`), `csp.spec.ts` (4), `httpHardening.test.ts` | igen | igen | **részben** — nginx-fejlécek élnek, CSP report-only; a helmet HSTS kivétele nem, ezért az `/api/` ma is két HSTS-t küld | az enforce-ra váltás nincs megtéve (9. pont) |
| F11 URL-szűrők | 10. nap `700c420`; 11. nap `b954e9b` | `query-state.spec.ts` (22) | igen | igen | **részben** — a 10. napi három oldal igen, a 11. napiak nem | PoSe, ChainLocks, Sentinel Layer szándékosan paraméter nélkül |
| F12 szemantika, fókusz | 12. nap `1828831`; 18. nap `fc4652d` (cím nélküli részletoldalak); 20. nap `611fdde` (`aria-pressed`) | `accessibility.spec.ts` (h1 minden útvonalon négy állapotban, fókusz, skip link, toggle-sweep), `navigation.spec.ts` (14) | igen | igen | nem | számított fókusz- és szerkezetmérés, nem képernyőolvasós tanúsítás |
| F13 függőségek | 13. nap `5b8b5a7`; 20. nap `694d5cc` | `npm audit` előtte/utána; `httpHardening.test.ts` (6: a lapos query-feldolgozás valódi kérésen, urlencoded nincs, forrás-sweep mindkét szerverre) | igen | igen | nem (a VPS a 13. nap előtti lockfile-lal fut) | **elfogadott maradék:** 2 moderate `qs` az express 4 saját pinje miatt. Az elfogadás feltevése (simple parser, nincs urlencoded) a 20. napon derült ki, hogy **csak a fő szerverre volt igaz**; a labor-szerverre (`labServer.ts`, alapból `127.0.0.1`) nem. Javítva és teszttel védve, de nincs telepítve |
| F14 kontraszt | 12. nap `1828831` | `contrast.test.ts`, `accessibility.spec.ts` (mindkét téma) | igen | igen | nem | — |
| R7 (review) draft-idempotencia | J2 `4261e06` | `draftIdentity.test.ts` (12), `run-status.spec.ts` | igen | igen | nem | — |

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
| A friss klón K2-je nem volt tiszta (2. pont) | **nyitott, figyelendő** | egy nem induló oldal és két navigációs időtúllépés, viselkedési hiba nélkül; ha a CI-ban is megjelenik, a dev szerver alatti tesztidőzítés a gyanúsított |

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

## 13. Amit a review-nak külön érdemes néznie

- **A 3. pont következménye.** Élesben az R1–R7 előtti kód fut; ha a review élő oldalon ellenőriz, azt méri.
- **A 20. napi `56e85f3`** hat oldal renderelési ágát változtatja (betöltött-e már egyszer); a „sikertelen frissítés megtartja az utolsó jó adatot" viselkedést teszt fedi, de érdemes egy lapozott oldalon (2. oldal hibája) is ránézni: ott a korábbi oldal sorai maradnak az új oldalszám alatt — ez a 3. napi döntés öröksége, nem új.
- **Két elavult-keresés őr** (19. nap): a teszt csak mindkettő kivételekor bukik; a második őr egy ablaka érvelés, nem bizonyíték (a kódkomment is így mondja).
- **A labor-szerver hardeningje** (`694d5cc`) a fő szerverével azonos függvény; a labor-szervert valódi laborban nem indítottam el.
