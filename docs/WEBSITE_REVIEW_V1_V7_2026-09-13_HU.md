# Ismételt független review — V1–V7, #175

2026-09-13. Alap: `39e7f80346f8ac7a14e7b82ebdae862c52fb3d16`. Vizsgált HEAD: `72fec824319aa8da9bd3cf33e64daa25326c705d` (#175, 11 commit + merge). A tényleges diffet és a jelenlegi kódot vizsgáltam; a J4–J6 napló és a handover nem szolgált önmagában bizonyítékként.

## 1. Megmaradt és új hibák — először a javítandók

**Nincs újonnan igazolt P1 alkalmazáshiba. Négy külön P2 hibajegy készült: három megmaradt alkalmazáshiba és egy új tesztharness-hiba.** A korábbi P1 futam-visszatekerés javítását elfogadom. A teljes csomagot még nem nevezném minden követelményében lezártnak.

| Jegy | Szint | Megállapítás és reprodukció | Eredet |
|---|---|---|---|
| [W1](review-2026-09-13-followup/W1-simulation-list.md) | P2 | Simulations lista sikeres betöltése → azonos URL/oldal következő pollja 503 → a már betöltött sorok eltűnnek. `dd-page-simulations.ts:262` minden hibánál csak a hibaüzenetet rendereli. | Örökölt viselkedés; a V4 pontosított adatmegőrzési feltétele továbbra sem teljesül ezen az oldalon. |
| [W2](review-2026-09-13-followup/W2-evidence-session.md) | P2 | A futam/terv/history válasza sikeres, a recovery GET 401 → az admin felület nyitva marad, bizonyíték-olvasási hibát mutat a session lezárása helyett. `dd-admin-shell.ts:77–81`. | Örökölt 401-elnyelés, a J4 új helperében is megmaradt; nem szerveroldali auth-megkerülés. |
| [W3](review-2026-09-13-followup/W3-response-gate.md) | P2, teszt | Egy visszatartott válasz törzsét a lap még nem olvasta, de ugyanannak az URL-nek egy másik válaszát már igen → a `ResponseGate.release()` visszatérhet. `harness.ts:430–435` URL szerinti darabszámmal azonosít választ. | **Új harness-hiba a javító diffben.** Nem az összes böngészőteszt érvénytelenítése. |
| [W4](review-2026-09-13-followup/W4-fairness-profile.md) | P2 | Fairness automatikus profilja aktiválási magasságot lép át, az új profil lekérdezése 503 → az új profil gombja kijelölt, alatta a korábbi profil táblái maradnak. `dd-page-fairness.ts:173–180`, `:237–285`. | Már nyitott, változatlan alkalmazáskód; a handover kódolvasásos gyanúját most böngészőben reprodukáltam. |

A W1/W2/W4 a #175 által újonnan bevezetett regressziónak **nem** minősül. A W4 régi adata a saját profilnevét továbbra is kiírja a statisztikán; a hiba a kijelölt aktuális profil és az alatta hagyott eredmény ellentmondása, nem a profilnév teljes eltüntetése.

Az új ellenpróbák eredménye: **4 bukott, 1 sikeres**. A sikeres C2 a terv nélküli futamváltást és az abort célpontját ellenőrzi. A négy bukás a kívánt viselkedést állítja, nincs `test.fail` vagy hibát sikerként elfogadó jelölés. [Forrás](review-2026-09-13-followup/followup.spec.ts), [futtatás](review-2026-09-13-followup/counterexamples.txt).

## 2. V1–V7 döntés és bizonyíték

| ID | Döntés | Konkrét kód és működési bizonyíték |
|---|---|---|
| V1 | **Lezárva** | `dd-admin-shell.ts:580–606`: a hydration `_acceptRun()`-t használ. `:844–874`: 503 nem törli az elfogadott futamot; a `/dry-run` 401 lezárja a sessiont. `dd-simulation-control.ts:751–755`, `:1171–1204`, `:1245–1290`: terv nélküli állapot + abort/recovery; nincs preflight/arm/start. A `run-status.spec.ts:530,561,598,636,679,698` esetek zöldek, a korábbi saját V1 is zöld. A :598 teszt tényleges mockolt abort POST-ot mér. |
| V2 | **Lezárva az eredeti állapot-/bizonyíték-visszaírásra** | `_detailRequests`, `_historyFrom`, `_recoveryFrom`, `_takeHistory()`/`_takeEvidence()` a `dd-admin-shell.ts:580–635`, `:723–738` helyeken. A rendes tesztben a két history/recovery válaszpár fordított és normál sorrendje, a kezdeti olvasás és a későbbi frissítés versenye is zöld (`run-status.spec.ts:820,848,871`). Saját V2 zöld. A W3 ettől külön harness-korlát. |
| V3 | **Lezárva** | `dd-admin-shell.ts:441–462`: külön `_sessionBusy`, a sikeres session után tényleges `_loadDashboard()`. `admin.spec.ts:77,97,120`: azonnali betöltés, dupla kattintás, elutasított belépés; mind zöld. Saját V3 zöld. |
| V4 | **Részben** | A kézi lap/szűrő/ablak/téma váltását hét oldalon helyesen kötik a betöltött lekérdezéshez. `query-identity.spec.ts` 17 esete és a saját V4 zöld. **Az azonos lekérdezés pollhibájára ígért adatmegőrzés nem igaz általánosan: W1.** A Fairness automatikus effektív profilváltása külön maradék: W4. |
| V5 | **Lezárva** | `dd-simulation-control.ts:337–359`, `:767`, `:847`, `:879`, `:919`, `:1020–1032`: scenario, szám, enum és target vezérlő zárolva; explicit eldobás az utolsó olvasható paraméterekre. `scenario-forms.spec.ts:128` a Network/Mode használata **után** `toHaveValue(unfinished)` állítást végez. :149/:159 enum és a fieldseten belüli valódi target input; :176 eldobás és visszaállítás. Mind zöld. |
| V6 | **Lezárva** | `simulations.ts:308–368`: schemaVersion **2**, `reportRead` = present/absent/unavailable; csak besorolás, nincs nyers hibaüzenet/HTTP-státusz. Unit kulcsleltár és három állapot, valamint `public-simulations.spec.ts:185,206,220` valódi fájlletöltések zöldek. Saját V6 zöld. |
| V7 | **Lezárva az eredeti 503/hiány-megkülönböztetésre** | `dd-admin-shell.ts:77–81`, `:622–635`, `:748–752`; `dd-simulation-control.ts:1094–1140`: külön loading/read/unavailable, külön csak olvasó gomb. `run-status.spec.ts:927,955,988,1026`: hiány/hiba, kizárólag GET, késői retry és újabb bizonyíték, kezdeti loading; mind zöld. Saját V7 zöld. **A helper 401-kezelése külön W2 hibajegy, nem lezárt session-kezelés.** |

A táblázat kód-/tesztlezárás, nem éles vagy labor-elfogadás.

### A pontosítások külön ellenőrzése

- **V1 terv nélkül és futamváltás:** a gyermek `_actionRun()` továbbra is ellenőrzi a runKey egyezését; a parent kiválasztásváltáskor törli az előző futamot/tervet, a régi hydration generációja érvénytelen. A külön **C2**: A tervére várunk, pollból A aktív; B-re váltunk, B pollja előtt nincs abort; B pollja után A késői 503-a nem törli B-t; kattintáskor A abort POST = 0, B abort POST = 1. A teljes meglévő R1–R2 kiválasztási tesztkör is zöld.
- **401:** a kért `/dry-run`-401 eset teljesül. Nem általánosítható minden adminolvasásra: W2.
- **V4 Staking:** `dd-page-staking.ts:307–315,331` a `blocks` ablakhoz köti a mintát. A `view` csak ugyanazon válasz helyi megjelenítése, ezért nem kell külön hálózati minta. **Vantage points:** `dd-page-peers.ts:104–110,142` a `topic` a kulcs. Mindkettő hibás és késleltetett váltása zöld. Az azonos témájú peers-poll hibájánál a korábbi adat marad.
- **Késői V4-válasz:** a teszt valóban megszakított fetch-et mér, majd azonnali cancelled hibát vár; nem nyel el várakozási időtúllépést. Ez nem bizonyítja önmagában a sequence guard minden, már feldolgozás alatt álló válaszra vonatkozó ágát; a `PollController` és az oldalak `run.stale` ellenőrzése külön kódban megvan.
- **V5:** az eldobás előtt látszik a „last parameters that could be read” magyarázat. A hibás szöveg kijavítása is helyreállítja a szerkeszthetőséget. A kiválasztott futam abortja hibás draft mellett is engedélyezett.
- **V7:** a read-again kérése GET history + GET recovery, nem a recovery-mutáció. Ugyanaz a sorszámozás védi, mint a többi detail-frissítést; a késői olvasó retry tesztje ezt külön méri.

## 3. A tesztek hitelessége és negatív kontrollok

Nem fogadtam el automatikusan a napló kontrollszámait. Saját, olvasási célú Vite-overlay segítségével a **jelenlegi teszteket és harness-t** futtattam a **39e7f80 érintett kliensforrásával**. A munkafa alkalmazáskódját nem írtam át.

**Hét kiválasztott rendes teszt mind megbukott** az eredeti hibás viselkedésen: V1, V2, V3, Blocks/V4, V5, a letöltött V6 export, V7. Nem buildhiba, unstubbed endpoint vagy környezeti indulási hiba volt. Példák: V1 `armed` a várt `fault_active` helyett; V6 hiányzó `reportRead`; V5 engedélyezett mező; V4 megmaradt régi sor. [Napló](review-2026-09-13-followup/negative-controls.txt).

**További két kontroll:** a régi panelen az enum és a target input zárolási tesztje külön is bukik. A target teszt valóban az engedélyezett/tiltott inputot méri, nem pusztán a fieldset attribútumát. [Napló](review-2026-09-13-followup/negative-editor-controls.txt). Az első, CLI-s szűrési kísérlet nem választott ki tesztet; az nem eredmény. A megőrzött napló a korrigált, két tényleges tesztet futtató köré.

Ezek reprezentatív, önálló baseline-kontrollok. **Nem állítom, hogy Opus minden egyes történelmi, egy őrt eltávolító mutációját újrajátszottam**, és a napló 7/5/7 stb. kontrollszámait nem minősítem saját futásnak.

Az ellenőrzött korábbi hibás tesztminták:

1. A V1 versenytesztek `pauseAt()`-tal állítják meg az órát; a következő poll nem javíthatja ki az állítás alatt a regressziót. A saját negatív kontroll ezt ténylegesen elbukta.
2. A „failed evidence refresh keeps what was proven” már megvárja a recovery olvasását (`run-status.spec.ts:346–369`), és utána ellenőrzi a bizonyítékot. Ebben az esetben az új URL-azonossági W3-ütközést nem reprodukáltam.
3. A query késői-válasz teszt explicit cancellation-t mér, nincs catch-be rejtett timeout.
4. A scenario enum és target zárolását tényleges külön tesztek mérik, saját negatív kontrollal is igazolva.
5. A régi „a poll describing an older state cannot undo an action” (`run-status.spec.ts:70`) továbbra is a kimenő kérés száma után állít. **A handover nyitott tesztadósság besorolása helyes.** Ezt ki kell egészíteni a régi poll feldolgozásának megvárásával; nem a működő revision-védelem bizonyított alkalmazáshibája.

### A harness határa

A JSON-observer az eredeti `Response.json()` Promise-t adja vissza; nem helyettesít API-adatot és nem fagyasztja meg az alkalmazást. A normál kapu 277 tesztje és a hét baseline-kontroll működött vele. A **W3 viszont cáfolja az általános ígéretét**, hogy minden release a saját válaszának olvasását várja meg: URL szerinti számláló nem kérésazonosító. A V2 rendezett tesztjeiben külön visszatartott válaszpárok és megállított óra mellett nem találtam ebből eredő hamis zöldet; a kontrollok a hibás alkalmazáskódot továbbra is felismerik.

A W3 ellenpróbában a saját válasz olvasását szándékosan 750 ms-ig visszatartjuk, miközben másik, azonos URL-ű választ elolvasunk. Ez a mesterséges kiváltó feltétel; nem „várjunk, hátha már feldolgozta” jellegű utólagos sleep. A korai release után a saját test még `undefined`. Javítás után a release kivárhatja az igazi olvasást, és az állítás zöld lehet.

## 4. Saját futtatások

| Kapu | Eredmény | Bizonyítékfajta |
|---|---|---|
| K1 | shared build, typecheck, **864 + 203 = 1067 unit**, teljes build: exit 0; `git diff --check` tiszta | Fordítás, unit, build; a meglévő checkoutban |
| K2 | **277/277**, exit 0, 1 worker, nincs retry, 5,8 perc | Böngésző, kizárólag UI-fixture/API-mock |
| K3 | **98 sikeres, 8 kihagyott**, 15 fájl, exit 0 | Valódi HTTP/Mongo integráció; `mongodb://127.0.0.1:27018`, generált eldobható tesztadatbázisok |
| CSP | **4/4**, exit 0, 6,1 s | Aktuálisan buildelt kliens, CSP negatív kontrollal; nem éles nginx-mérés |
| Korábbi saját ellenpróbák | **7/7**, exit 0: V1,V2,V3,V4,V6,V7 + C1 | UI-fixture és V6 export helper |
| V5 helyettesítő kapu | `scenario-forms.spec.ts` a 277-es körben zöld; pontos szövegmegőrzés és zárolás ellenőrizve | Az eredeti tiltott mezőbe gépelő V5 tudatosan kimaradt; nem nevezem zöldnek |
| Saját baseline-kontroll | **7/7 elvárt bukás**, majd **2/2 elvárt bukás** | Jelenlegi tesztek, javítás előtti kliens, olvasási overlay |
| Új ellenpróbák | **4 bukott + C2 sikeres** | W1–W4 külön reprodukció, terv nélküli futamváltás kontroll |

K2 port: 5393; saját ellenpróbák 5394; baseline-overlay 5395; korábbi ellenpróbák 5396. Mind loopback, a proxy zárt portra mutat, valódi labor API-t a böngészők nem értek el. Az új probe-k és a negatív kontrollok részben a K2 mellett futottak; a teljes K2 ettől még elsőre, retry nélkül zöld lett. A CSP a K2 befejezése után futott.

A Mongo-kör 8 kihagyott esete az adatbázis nélküli tartalék párdarab; nem 8 kihagyott laborfutam. A K3 nem pótolja a Core adapter, valódi lease/lock és regtest fault/recovery elfogadását. **Laborfutam: 0.** Friss klónos `npm ci`-t és éles ellenőrzést ebben a körben nem végeztem.

A CSP után is külön maradt a két HTML-riport: normál `client/playwright-report/index.html` 21:59:21-es, CSP `client/playwright-report-csp/index.html` 21:59:57-es fájl. A konfiguráció és a CI artifact-lista külön útvonalat használ. A korábbi jelentésem „Vite reloadot jelzett” kifejezése naplójelzést jelentett; ebből tényleges alkalmazás-újratöltést nem állítottam bizonyítottnak, és most sem. A handover pontosítása ezt helyesen szűkíti.

## 5. Nyitott tételek és deploy-hatás

| Tétel | Felülvizsgált besorolás |
|---|---|
| Labor/Core bekötés és valódi normál/abort/recovery futam nincs igazolva | **A live szimulátor engedélyezésének/üzemi elfogadásának blokkolója.** A csak megfigyelő webfelület telepítését önmagában nem tiltja. |
| W1 és W4 adat-azonosság/adatmegőrzés | P2 javítandó. A „V4 teljesen lezárva” elfogadást blokkolják; nem P1 sürgős üzemeltetési hiba. Külön elfogadott korlátozás nélkül ne nevezzük teljesen késznek. |
| W2 recovery-401 | A privát admin session-kezelésének maradéka; az adminfelület teljes elfogadása előtt javítandó. Nem bizonyított szerveroldali jogosultságmegkerülés. |
| W3 és a gyenge régi pollteszt | Tesztmegbízhatósági adósság. A W3 általánosítását javítani kell; nem teszi automatikusan érvénytelenné a mostani, kontrollokkal is alátámasztott V1/V2 eredményt. Önmagában nem runtime deploy-blokkoló. |
| Fairness „nyitott, nem mérve” | **Pontosítandó: most már mérve, W4.** |
| ERR_NO_BUFFER_SPACE / korábbi tiszta-klón flake | Helyesen nyitott környezeti/tesztfutási probléma. A mai 277-es körben nem jelentkezett. Ez nem bizonyítja a gyökérok megszűnését; TIME_WAIT-ot továbbra sem tekintem igazolt oknak. |
| CSP report-only | Külön üzemeltetési döntés; a buildelt policy ellenőrzése zöld. A kóddeploy és az enforce-ra váltás ne legyen összemosott elfogadás. |
| qs moderate maradék | A függőségek és a két szerver parser-hardeningje a vizsgált diffben nem változott. A friss audit: **2 moderate, 0 high, 0 critical**; JSON mellékelve. Az igazolt, nem használt parser-út melletti elfogadott maradék továbbra is indokolható. |
| Bundle/lazy loading, mobilfejléc, admin scroll-jelzés, profilnév nélküli DTO, proTxHash backlog | Nem találtam indokot átminősíteni őket blokkolóvá ebben a javító diffben. |
| Harness teardown külön teszt nélkül | Helyesen jelzett tesztlefedettségi korlát; a suite nem akadt meg. Nem állítom, hogy ez külön bizonyítva lett. |
| Nincs élesben a javítás | Hátralévő telepítési feladat, nem új kódhiba. **Az aktuális VPS SHA-ját most nem mértem újra.** |

**Deploy-vélemény:** a review nem ad feltétel nélküli „minden kész” elfogadást. A V1 P1 javítását érdemes előrevinni; a megfigyelő webfelület kiadása a fenti P2-k kifejezett elfogadásával mérlegelhető. A privát admin teljes átadásához W2, a V4 lezárásához W1/W4 még javítandó. A live labor engedélyezéséhez továbbra is külön valódi laborbizonyíték kell. Ez besorolás, nem végrehajtott deploy vagy engedélykérés.

## 6. Átadás és reprodukálhatóság

A javításokat négy külön jegy tartalmazza; javasolt sorrend **W2 → W3 → W1 → W4**. Minden jegy saját fájlkört és elfogadási feltételt ad. Nem szükséges Core-, konszenzus-, lease-, lock- vagy szerveroldali idempotencia-módosítás ezekhez a kliens-/harness-hibákhoz.

Parancsok a repó gyökeréből (PowerShell):

```powershell
$env:CI='1'
$env:DEVNET_E2E_PORT='5394'
npx playwright test --config docs/review-2026-09-13-followup/playwright.config.ts
# Elvárt jelenlegi eredmény: W1–W4 piros, C2 zöld.
$env:DEVNET_E2E_PORT='5395'
npx playwright test --config docs/review-2026-09-13-followup/negative.playwright.config.ts
# Szándékos baseline-futtatás: hét működési állítás piros.
```

A [mellékletkönyvtár](review-2026-09-13-followup/) tartalmazza a K1/K2/K3/CSP naplókat, az eredeti és új ellenpróbák eredményét, az overlay forrását, a negatív kontrollokat és az audit JSON-t. A `REVIEW_GREP` környezeti változóval külön választhatók az enum/target negatív kontrollok.

Alkalmazáskódot nem javítottam; commit, push, merge, deploy, wallet-művelet és valódi fault nem történt. A munkafa elején meglévő négy követetlen `ops/c2-*.sh` fájlt érintetlenül hagytam. A végső státuszban egy ötödik, más munkából érkezett `ops/c2-fleet-verify.sh` is megjelent; azt sem érintettem. A HEAD változatlanul `72fec82`. Csak a jelen review dokumentációját és reprodukcióit hoztam létre.
