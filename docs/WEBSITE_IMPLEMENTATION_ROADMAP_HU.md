# Weboldaljavítás – 20 napos végrehajtási terv Terra / Opus számára

Készült: 2026-09-11. Alap: [weboldalaudit](WEBSITE_AUDIT_2026-09-11_HU.md), F01–F14.
Projekt: `D:\www\devnet .deftrack`. Auditált kiinduló commit: `bfe7357`.

Ez **megvalósítási terv**, az itt szereplő munkák még nem készültek el. A napok egymásra épülő munkacsomagok, nem dátumhoz kötött határidők. Egy nap szükség esetén két munkanapra bontható. Tervezési keret: 20 munkanap + 2–4 nap javítási tartalék. Ugyanazon feladaton egyszerre egy implementáló dolgozzon; Terra és Opus váltásakor a napló legyen az átadás alapja.

A sorrend célja, hogy kevés döntést kelljen menet közben kitalálni, a változtatások kis egységekben legyenek ellenőrizhetők, és a zöld unit tesztek mögött ne maradjon működésképtelen felület. Az ütemterv az explorer és a szimulátor webes felületének javítása; az éles devnet hibainjektálás bekapcsolása külön üzemeltetési feladat.

## 1. Munkaszabályok minden napra

1. Olvasd el ezt a részt, az adott napot, az érintett forrásfájlokat és teszteket. A sorhivatkozások az auditkori állapotra vonatkoznak: függvény vagy komponens neve alapján keresd meg őket.
2. Ellenőrizd az aktuális `git status --short` és commit állapotot. A másik munkából származó módosításokat őrizd meg. Nincs `reset --hard`, munkafa-takarítás vagy másik modell munkájának felülírása.
3. Egy nap = egy összefüggő változtatáscsomag, legfeljebb néhány célzott commit. Ne kezdj mellé refaktort, frameworkcserét vagy általános formázást. A megadott fájlkörön kívüli szükséges módosítást röviden indokold a naplóban; ez önmagában nem kér új jóváhagyást.
4. A meglévő Lit 3, TypeScript, Express, Mongoose és shared workspace marad. A kliens ne importáljon szerver-runtime modult; közös DTO csak infrastruktúrától független shared modulban legyen.
5. Az alkalmazás feliratai továbbra is angolul készüljenek, a fejlesztési dokumentáció magyarul. Ne legyen félig magyarra fordított felület.
6. A feladat által érintett viselkedési hibát először reprodukáld. Írj regressziós tesztet ott, ahol valódi viselkedést véd: versenyhelyzet, URL, lapozás, DTO, jogosultság, állapot-visszatöltés. Puszta CSS- vagy feliratszerkesztéshez nem kell tükörteszt. A meglévő tesztet csak az új, indokolt viselkedés miatt módosítsd, ne azért, hogy eltűnjön a piros jelzés.
7. Futtasd a változtatáshoz tartozó teszteket, majd a napi kapukat. Az exit-kód és a végső eredmény számít. `skipped`, `not run`, mockolt UI-futam és valódi laborfutam külön kategória.
8. Töltsd ki a [végrehajtási naplót](WEBSITE_IMPLEMENTATION_LOG_HU.md): módosított fájlok, commit, ellenőrzések, bizonyíték, nyitott hiba. Ellenőrzés nélkül ne legyen KÉSZ.
9. Meglévő, független hiba esetén rögzíts kiindulási bizonyítékot; új regresszióval ne lépj tovább függő feladatra. Egy blokkolt infrastruktúra-ellenőrzés mellett csak attól független kódmunkát folytass, a blokkot ne tüntesd el.

### Változatlan műszaki határok

- Core-forrás, wallet, blokklánc, konszenzusküszöbök, gyűjtők és korábbi mérési eredmények nem módosítandók e terv részeként.
- A szimulátor állapotgépe, lease, lock, idempotencia, CSRF, session és szerveroldali szerepkör-ellenőrzés marad a jelenlegi biztonsági határ. Ezek gyengítése nem UI-javítás.
- Live futtatás továbbra is kizárólag a meglévő, engedélyezett regtest-labor végrehajtójával. A `live + devnet` elutasítás marad. Nem adunk tetszőleges RPC- vagy shellmezőt a böngészőbe.
- Titok, RPC-jelszó, API-kulcs, valódi host-IP, walletadat nem kerül URL-be, localStorage-ba, tesztfixtúrába, screenshotba vagy publikus exportba.
- A jelen feladat tervkészítés. A későbbi kódolási megbízás a helyi fejlesztésre vonatkozzon; VPS-telepítés és valódi fault-futtatás külön, konkrét műveleti megbízás alapján történjen. Addig a kód és a telepítési csomag review-ra készítendő el.
- A régi `AUDIT_FIX_ROADMAP_HU.md` és `SIMULATOR_IMPLEMENTATION_ROADMAP_HU.md` nem írható át erre az új munkára. Az ottani kész állapotokat nem szabad újra nyitottként kezelni ellenőrzés nélkül.

## 2. Ellenőrzési kapuk

**K0 – kiindulás:** Node/npm verzió, lockfile, git állapot; tiszta külön checkoutban telepítés. Windows és WSL ne használja ugyanazt a `node_modules` könyvtárat. A `.node-version` jelenleg 24, a CI Node 22-t használ: mindkettőn való kompatibilitást tartsd meg, ne módosíts Node-verziót mellékesen. A korábbi `tsx`-hiba Windows platformfüggő esbuild-hiány volt.

**K1 – napi alapkapu**, repo gyökeréből, külön parancsként, sikertelenségnél állj meg:

```text
npm run build -w shared
npm run typecheck
npm test
npm run build
git diff --check
```

A shared build tiszta checkoutban a típusellenőrzés előtt kell. A korábbi 900 teszt tájékoztató baseline, nem elvárt fix darabszám.

**K2 – böngészős komponens/E2E kapu:** az 1. napon létrehozott `npm run test:e2e -w client`. A valódi alkalmazást renderelje helyi Vite mellett, szintetikus és típushelyes API-válaszokkal. Minden `/api/**` kérés legyen explicit mockolt vagy elutasított; ne essen át véletlenül a Vite proxyn valódi szerverre. Ennek eredménye UI-bizonyíték, nem backend- vagy Core-bizonyíték.

**K3 – HTTP/adatbázis kapu:** szerverroute, DTO vagy adataggregáció változásakor a célzott unit teszteken túl a releváns valós HTTP/integrációs teszt. MongoDB csak a `server/src/integration/mongo.ts` izolált, generált adatbázisával. `MONGODB_TEST_URI` hiányakor a teszt kihagyása nem siker; CI-ben vagy külön teszt-Mongóval kell bizonyítani. A `deftrack_devnet` soha nem tesztadatbázis.

**K4 – átadási kapu:** tiszta checkout, teljes CI, tényleges böngészős ellenőrzés, nyitott korlátok és baseline–HEAD diff. A 7., 14. és 20. napon checkpointcsomag készül; a végén külön review következik. A checkpoint nem jelent automatikus merge- vagy deployengedélyt.

## 3. Napi áttekintő

| Nap | Egyértelmű eredmény | Audit / függés |
|---|---|---|
| 01 | Reprodukálható fejlesztői és böngészős tesztkörnyezet | minden későbbi UI-kapu alapja |
| 02 | Hibás URL és nem létező oldal kulturált kezelése | F07, F08 |
| 03 | Valós adatfrissesség, hiba és elavult állapot | F03 |
| 04 | Érvényes scenario-alapértékek és világos futtatási módok | F09 |
| 05 | Admin futamlekérések pontos kliensszerződése | F01/F02 alapja |
| 06 | Futamvezérlés helyreállítása F5 és navigáció után | F01; 05 után |
| 07 | Egységes, frissülő futamállapot és recovery UX | F02; 06 után; checkpoint |
| 08 | Teljes kísérletlista lapozással | F04 |
| 09 | Helyes Fairness profilok és hostlétszámok | F05, F06 |
| 10 | URL-állapot DKG, Fairness és Experiments oldalakon | F11 alap; 08–09 után |
| 11 | URL-állapot a többi meglévő szűrőnél | F11; 10 után |
| 12 | Szemantikus címek, fókusz és olvasható veszélygomb | F12, F14 |
| 13 | Célzott függőségfrissítés | F13 |
| 14 | Ellenőrizhető nginx fejléc-konfiguráció | F10; checkpoint |
| 15 | Egyszerű szimulációk strukturált űrlapjai | 04–07 után |
| 16 | Összetett scenario-űrlapok és előnézet | 15 után |
| 17 | Publikus szimulációs eredményoldal és JSON-export | 05–07 után |
| 18 | Rendezett navigáció és mobilfelület | 10–12, 17 után |
| 19 | Célzott globális keresés, másolás, rövid módszertan | 02, 17–18 után |
| 20 | Teljes regresszió és átadás független review-ra | valamennyi szükséges nap után |

## 4. Napok részletes feladatai

### 01. nap – Kiindulás és valódi UI-teszt alap

**Fájlkör:** `client/package.json`, gyökér `package-lock.json`, új `client/playwright.config.ts`, `client/e2e/`, `.gitignore`, a CI minimális bővítése. Az új fájlnevek javasolt, létrehozandó fájlok.

**Lépések:**

1. K0/K1 baseline rögzítése; környezeti hibát válassz külön az alkalmazáshibától. A meglévő munkafában ne csinálj vak `npm ci`-t vagy lockfile-regenerálást.
2. Vegyél fel Playwright alapú böngészős tesztet a klienshez; a választott verzió Node-kompatibilitását és telepítését ellenőrizd. A böngésző/függőség a lockfile és CI alapján reprodukálható legyen.
3. A teszt a tényleges `dd-shell`/`dd-admin-shell` komponenseket renderelje. Szintetikus API fixture factory-k a tényleges válaszborítékot és DTO-kat adják. Lit nyitott shadow rootokra alkalmas role/label alapú locatorokat használj.
4. Kezdő teszt: Overview betöltés; admin 401 belépési felület; API-hiba látható kezelése. Ne másold a jelenlegi hibákat „jó” snapshotba.
5. Böngészős tesztek, trace és screenshot CI-artifactként; csak kitalált adatokkal. Explicit helyi baseURL, váratlan külső kérések tiltva a tesztharnessben.

**Kész:** K1 + K2 zöld; egy szándékosan rossz HTTP-válasz vagy hiányzó célkomponens valóban megbuktatja a hozzá tartozó ellenőrzést. A meglévő szervert nem kellett elindítani a UI-tesztekhez. A setup javítása még nem az audit hibáinak javítása.

### 02. nap – Router és hibaoldalak

**Fájlkör:** `client/src/lib/router.ts`, `router.test.ts`, `dd-shell.ts`, új kis Not found komponens, kapcsolódó E2E.

**Lépések:**

1. A dekódolási hiba explicit route-eredményt adjon, ne kivételt. Ne nyeld el az alkalmazás összes hibáját globális üres catch-csel.
2. Ismeretlen útvonal külön hibaoldalra menjen; maradjon meg az URL és legyen Overview/visszalépés link.
3. A jelenlegi „unknown → Overview” teszt elvárt eredményét indokoltan cseréld az új szerződésre.
4. A `/admin` külön betöltési útját, `/rounds` listát és kódolt roundKey részletet őrizd meg. A route lista első eleme továbbra se legyen hibakezelési trükk.

**Kész:** K1 + K2; `/round/%`, `/tx/%E0%A4%A`, ismeretlen útvonal, `/round/7%3A7416%3A0`, trailing slash, Back/Forward ellenőrizve. A szerveroldali SPA fallback e napon nem módosul.

### 03. nap – Adatfrissesség

**Fájlkör:** `dd-shell.ts`, `dd-page-overview.ts`, szükség esetén kis `client/src/lib/freshness.ts`, tesztje és a meglévő `poll.ts` célzott bővítése.

**Rögzített viselkedés:** a kérés sikeressége és a hálózat egészsége két külön jelzés. Az utolsó sikeres adat maradhat. A legutóbbi kérés hibája azonnal legyen látható; 2 × konfigurált frissítési periódusnál öregebb adat stale. Kezdetben loading, első sikertelenségnél unavailable és Retry, nem végtelen skeleton. A timestamp az utolsó elfogadott sikeres válasz ideje, nem az utolsó próbálkozásé.

**Lépések:** ezt a szabályt a fejlécen és Overview-n vezessétek be; kapcsolatvesztéskor a „live” címke változzon. A hiányt jelző negatív hálózati számláló legyen `—`, de ne változzon meg globálisan a negatív számok formázása: egy delta vagy margin jogszerűen negatív. `success:true` health-válasz HTTP 503-mal lehet értelmes degraded adat, ne dobd el általános `response.ok` ellenőrzéssel.

**Kész:** K1 + K2; szabályozott órával success → hiba → stale → success, első kérési hiba, rejtett lap visszanyitása. Elavult válasz nem teheti ismét frissé az újabb hibás állapotot. Friss HTTP-válasz nem bizonyítja az összes observer frissességét: ha az adat DTO-ja közöl forrásidőt, az is maradjon látható.

### 04. nap – Scenario-alapértékek és módok

**Fájlkör:** `dd-simulation-control.ts`, kis kliensoldali presetmodul, `admin-api.ts`, szükség esetén az admin scenario-válasz szerződése és célzott tesztje. Forrásként olvasandó `scenarioRegistry.ts`, `simulationPolicy.ts`, `simulationAdmin.v1.routes.ts` és `buildLabExecutor()`.

**Lépések:**

1. A `dsl-fault` preset legyen `response-drop`, `count:1`, `epochs:1`. A többi preset is a tényleges sémát kövesse.
2. Paramétertesztben használj mesterséges, érvényes célpontazonosítókat. Különböztesd meg a helyes paramétersémát a valóban létező/engedélyezett targettől.
3. A `live + devnet` kombináció ne legyen indítható a felületen. A live szöveg mindenhol `Live · regtest lab`; a preview gomb ne állítson más módot, mint ami ki van választva.
4. Hiányzó executor esetén jelenjen meg a tényleges szerverkonfigurációból származó elérhetetlenség. Ha kell új capability mező, ugyanazt a konfigurációs döntést használja, mint az executor létrehozása; ne hostname-ből vagy környezeti tippből következtesd. Az elérhetőség még nem sikeres preflight.

**Kész:** K1 + K2, szervermódosításnál K3; a teljes registry minden scenario-jára van érvényes mintaparaméter és támogatott/tiltott mód teszt. Ismeretlen jövőbeli scenario ne kapjon automatikusan üres, „futtatható” űrlapot.

### 05. nap – Futamlekérések és típusos kliensállapot

**Fájlkör:** `client/src/lib/admin-api.ts`, új kis futamállapot-modul és tesztje; szerver/shared csak ténylegesen szükséges, visszafelé kompatibilis DTO-bővítéshez.

**Már létező API-k – ezeket használd, ne találj ki párhuzamos backendrendszert:**

| Kérés az `/api/v1/admin/simulations` alatt | Jelenlegi eredmény a boríték `data` mezőjében |
|---|---|
| `GET /runs/:runKey` | `service.status()` → futamprojekció |
| `GET /runs/:runKey/dry-run` | `{run, plan}`; a mentett immutable tervet olvassa |
| `GET /runs/:runKey/history` | `{run, audit, artifacts}`; privát adat |
| `GET /runs?live=true` | nem terminális live futamok rövid listája, nem teljes archívum |
| `GET /lock` | a live lock külön állapota |

**Lépések:** olvasd vissza a tényleges projekciót, ne a mostani szűk kliensinterfészből következtess. Vedd fel a szükséges GET metódusokat és AbortSignal támogatást. Használd a már meglévő `state.revision` értéket a válaszok rendezéséhez; a projekcióból ténylegesen olvasd, ne generálj kliensverziót. A preflight/recovery részlet csak ha ténylegesen elérhető, különben unknown, nem kitalált passed/all-clear.

**Kész:** K1 és célzott kliens-/HTTP-szerződéstesztek; 401, 404, abort, hiányos adat és későn beérkező régebbi revision kezelése bizonyított. A publikus DTO-ba nem kerül admin artifact vagy privát registry. A meglévő műveletválaszok idempotenciája megmarad.

### 06. nap – Visszavehető futamvezérlés

**Fájlkör:** `dd-admin-shell.ts`, `dd-simulation-control.ts`, 05. napi kliensmodul, E2E.

**Rögzített állapotmodell:** a szerkeszthető új draft és a kiválasztott, perzisztált futam két külön állapot. Futamválasztás prioritása: explicit érvényes URL-ben kért `runKey`; ennek hiányában a korábbi kiválasztás; ennek hiányában egy aktív futam. Egy explicit, de 404-es kulcsnál hiba jelenjen meg, ne váltson másik futam vezérlésére csendben.

**Lépések:** `/admin?run=sim_…` visszatöltés a meglévő GET végpontokról. A mentett tervet töltsd be, ne új `POST /runs` kéréssel „állítsd helyre”. Futamlista-kattintás a vezérlést és az idővonalat is ugyanarra a kulcsra állítsa. Draftmező szerkesztése ne tüntesse el az aktív futam helyreállítási paneljét. Kijelentkezéskor privát állapot törlése, késő válaszok eldobása.

**Kész:** K1 + K2; F5, új lap ugyanazzal az URL-lel, hiányzó/hibás kulcs, A→B választás késő A-válasszal, 401, draftváltás aktív futam mellett. Az abort/recover mindig a látható kiválasztott futamhoz tartozik.

### 07. nap – Frissülő futamállapot és műveletversenyek

**Fájlkör:** 05–06. napi állapotmodul és két admin komponens; kapcsolódó E2E. Backend állapotgép módosítása nem része a napnak.

**Lépések:**

1. Egyetlen frissítési tulajdonos kezelje a kiválasztott futamot; a lista, vezérlés és idővonal ebből kapja a megfelelő adatot. A panel ne tartson külön, sosem frissülő `run` másolatot.
2. Látható lapon aktív futam státusza például 5 s-onként frissülhet; egyszerre legfeljebb egy státuszkérés. Terv csak kiválasztáskor/érdemi váltáskor kell, ne minden tickben.
3. Műveletválasz után azonnali állapotegyeztetés. Régebbi revision nem írhat felül újabbat, és polling nem nullázhat folyamatban lévő műveletet. Ugyanannak a bizonytalan kimenetelű kérésnek az ismétlése ugyanazt az idempotency kulcsot használja; másik futam/művelet külön kulcs.
4. Sessionvesztés állítsa le a privát pollingot és kezelést. Hálózati hiba ne törölje a kiválasztott kulcsot, és ne mutasson hamis sikert. A recovery művelet ne tűnjön el pusztán stale adat miatt; szerveroldali döntés és ismétlés maradjon.
5. A lease visszaszámláló megjelenítés, nem recovery-bizonyíték. `0` másodpercnél ne állítsd helyileg `allClear=true` értékre.

**Kész:** K1 + K2; `activation_pending → fault_active → observing → recovery → cooldown → completed` megjelenítése mockolt szerverállapottal; abort, recovery-hiba, dupla kattintás, lassú válasz, lapelrejtés és sessionlejárat. Nem minden állapotban van minden gomb: a meglévő szerverátmenetekhez igazodjon.

**Checkpoint 1:** F01–F03 és F09 állapota, trace-ek, auth/idempotencia megőrzésének bizonyítéka. Ha feloldatlan versenyhelyzet maradt, a 15–17. nap szimulátoros munkái ne épüljenek rá.

### 08. nap – Kísérletlista teljessége

**Fájlkör:** `dd-page-experiments.ts`, `api.ts` szükség esetén, `experiments.v1.routes.ts` csak stabil rendezéshez/szükséges queryhez, E2E és releváns route-teszt.

**Lépések:** 25-ös szerveroldali lapozás, összes darabszám, következő/előző és státuszszűrés. Szűrőváltás lap 1-re állít. A lista egyetlen oldalát ne nevezd teljes archívumnak. Stabil szerverrendezésnél azonos `startedAt` mellé egyedi tie-breaker, például `runKey`. Betöltés/hiba/üres állapot külön; részletváltáskor ne maradjon másik futam részlete az új URL alatt.

**Kész:** K1 + K2, route-módosításnál K3; 0/1/25/26/34 rekordos szintetikus készlet, utolsó oldal, státuszváltás, hibás és késő válasz. Szöveges keresést ne imitálj csak a betöltött 25 soron; az e napi hatókörben elhagyható.

### 09. nap – Fairness korrekció

**Fájlkör:** `dd-page-fairness.ts`, `api.ts`, `fairness.v1.routes.ts`, `selectionFairness.ts`, releváns shared DTO és tesztek.

**Lépések:**

1. Profilválasztó a registryből; alapértelmezés a meglévő `primaryProfile` szabállyal feloldott aktuális profil. Ha az nem állapítható meg, kérjen explicit választást; ne váltson észrevétlen összesítésre. Legyen külön `All profiles · aggregate` opció.
2. A kérés vigye az `llmqName` értéket; a nézet és API eredmény összetartozását ellenőrizd. A Fairness képleteit és a konszenzust e javítás ne változtassa meg.
3. A meglévő `hosts[].nodes` jelentése kompatibilitásból maradjon kiválasztott node-ok száma, a UI neve legyen `Selected nodes`. Új, egyértelmű mező pl. `currentRegisteredNodes` számolja a route-ban olvasott aktuális aktív registry hostlétszámát. A két oszlop neve tegye világossá a jelenlegi registry és a történeti minta különbségét.
4. Olyan aktuális host is megjelenhet 0 kiválasztással, amelyet a minta nem érintett. Régi, ma már nem regisztrált hostnál ne találj ki történeti létszámot. Régi szerver új mező nélkül `—`, nem 0. A hostredakció minden új mezőnél maradjon.
5. A 200 elemre korlátozott `nodes` listából ne számolj teljes hálózati összesítést. Ha teljes invalid count kell, a szerver számolja a vágás előtt, külön aggregátumként.

**Kész:** K1 + K2 + K3; 7 regisztrált / 5 kiválasztott példa, 0 kiválasztott host, két eltérő profil, ismeretlen profil, 200-nál nagyobb szintetikus minta és redakció. Az éles 43,09% és 39,47% csak auditpillanatkép, nem beégetendő tesztelvárás.

### 10. nap – URL-szűrők alapja

**Fájlkör:** kis `client/src/lib/queryState.ts` és tesztje, router szükséges bővítése, DKG Rounds / Fairness / Experiments komponensek.

**Rögzített döntések:** URL-ben `page` 1-től számozva; API-ban `offset=(page-1)*limit`. Felhasználói lépés push, invalid/default query normalizálása replace. Polling nem ír historyt. Ismeretlen, negatív, NaN vagy túl nagy érték dokumentált alapértékre normalizálódik; a szerver `MAX_OFFSET` korlátját tartsd meg.

**Lépések:** az URL legyen az adott nézet szűrőállapotának forrása, a vezérlők ebből kapjanak értéket. Példák: `/rounds?llmq=llmq_defcon&status=failed&page=2`, `/fairness?llmq=llmq_defcon&rounds=50`, `/experiments?status=closed&page=2`. Az UI `llmq` és API `llmqName` közötti mapping egy helyen legyen. Csak egy hely indítsa a filterváltozás miatti lekérést.

**Kész:** K1 + K2; közvetlen megnyitás, F5, Back/Forward, invalid query, gyors egymás utáni váltások. Ne legyen dupla fetch vagy végtelen replace→popstate→replace ciklus. Admin útvonalak külön shelljét a publikus linkinterceptor ne nyelje el.

### 11. nap – A többi meglévő szűrő URL-je

**Fájlkör:** kizárólag a többi oldalon már létező időablak-, topic- és lapozóvezérlők; `queryState.ts` csak új, indokolt primitívvel.

**Lépések:** előbb készíts táblát az aktuális UI-vezérlőkről és azok API-paramétereiről. PoSe, ChainLocks, Staking, Vantage Points, Blocks, Transactions és Sentinel Layer meglévő vezérlőit kösd URL-hez; egy oldal–egy kis lépés sorrendben. Amelyik oldalon nincs vezérlő, ne találj ki hozzá újat a nap teljesítéséhez. Ne készíts általános, bonyolult router-frameworköt.

**Kész:** K1 + K2; minden ténylegesen létező szűrőtípushoz legalább egy refresh/history ellenőrzés; egy URL ugyanazt a témát, mintát és oldalt adja vissza. A 10. napi három oldal regressziótesztje is zöld.

### 12. nap – Szemantika, fókusz, kontraszt

**Fájlkör:** publikus oldalcímek, `dd-shell.ts`, shared stílusok, `dd-simulation-control.ts`, `contrast.test.ts`, E2E. A sok fájl itt ismétlődő, kis szemantikus változtatást jelent, nem teljes oldalrefaktort.

**Lépések:** egy h1 az aktív oldalon, logikus h2-k; caption kerüljön table-be. Navigálás után az új oldal címére helyezhető fókusz `tabindex=-1` használatával, a Lit render befejezését megvárva; polling és szűrőváltás ne rabolja el a fókuszt. Skip-to-content link a shadow DOM mellett is ténylegesen működjön. A danger gomb tényleges előtér/háttér párosítását javítsd legalább 4,5:1-re normál méretű szövegnél mindkét meglévő témában; a palettát ne rajzold át globálisan.

**Kész:** K1 + K2; billentyűzetes fő útvonal, fókusz látható és polling alatt megmarad, reduced motion, 200% zoom, danger gomb színpár ellenőrizve. Egy screenshot önmagában nem bizonyítja a fókuszt.

### 13. nap – Függőségek

**Fájlkör:** releváns package manifestek, lockfile, CI-kommentek csak ha az alapjuk megváltozott.

**Lépések:** friss `npm audit --json`; `npm explain qs` és telepített verziólánc rögzítése. A kompatibilis, legszűkebb szülőcsomag-frissítést válaszd. Ne használj `npm audit fix --force`, ne töröld a lockfile-t, és ne helyettesíts egy deklarált verziótartományt indokolatlan override-dal. A CI-ben dokumentált korábbi döntést ellenőrizd újra, ne a kommentet töröld ki a probléma helyett. Ha nincs kompatibilis javítás, pontos függőségi út és indokolt nyitott tétel maradjon; nem kell framework-major váltás.

**Kész:** tiszta checkoutból install + K1 + K2 + releváns K3; audit előtte/utána. A high/critical CI-kapu nem gyengül. F13 csak javított láncnál zárható; elfogadott fennmaradó moderate külön státusz, nem javított.

### 14. nap – nginx fejlécek előkészítése

**Fájlkör:** új `ops/nginx/` dokumentált fejléc-snippet/minta, hozzá tesztkonfiguráció és rövid `docs/` runbook. Az éles teljes vhost nincs a repóban: ne írj helyette kitalált production konfigurációt.

**Lépések:** CSP először report-only; HSTS a HTML belépési ponton is; meglévő X-Frame-Options, nosniff, noindex és asset-cache szabályok megőrzése. Ellenőrizd nginx `add_header` öröklését a locationökben és `always` viselkedését. CSP alatt a Lit stílusok, inline style attribútumok és dinamikus importok tényleges működését vizsgáld. HSTS preload vagy új domainkör nincs e feladatban.

**Kész:** K1 ahol alkalmazható; helyi, elkülönített nginx tesztben configellenőrzés, `/`, `/rounds`, `/admin`, asset és hibaválasz fejlécei; böngészőben nincs általuk okozott működési regresszió. Ha a nginx/böngésző nem elérhető, kód elkészült / runtime függő állapot, nem KÉSZ. Telepítési hely, beillesztés és rollback dokumentált; élő nginxet nem reloadol e nap önmagában.

**Checkpoint 2:** F04–F14 lefedettsége, nyitott környezeti/telepítési korlátok. F10 éles lezárásához később a tényleges HTML-válasz fejléceit is ellenőrizni kell.

### 15. nap – Egyszerű szimulátorűrlapok

**Fájlkör:** `dd-simulation-control.ts`, egy kis scenario-mező komponens/modul, 04. napi presetek és descriptor DTO szükséges bővítése, tesztek.

**Scenariók:** `mn-stop`, `staker-stop`, `quorum-member-outage`, `dsl-fault`.

**Lépések:** számmezők mértékegységgel; count, durationSeconds, phase, faultKind, epochs és feltételes param. A min/max/enum a tényleges szerversémát/policyt kövesse. A szükséges megjelenítési metaadatot az admin scenario-descriptor adhatja, de a szerver továbbra is mindent validál. A kliensből ne importáld a teljes server registryt. Ha egyszerű közös tiszta modulba emelsz limitet, az csak számok/típusok legyen, mellékhatás nélkül.

JSON marad Advanced nézetben. Egy kanonikus paraméterobjektumból renderelődjön az űrlap és a JSON; érvénytelen JSON ne vesszen el csendben és ne indítson futamot. Seed kapjon újragenerálás lehetőséget csak draftnál; futam-visszatöltés a mentett seedet mutassa.

**Kész:** K1 + K2, metaadat-API változásnál K3; mind a négy scenario helyes payloadja, határértékei és tiltott értékei. DSL delay faultnál param kötelező/megfelelő, nem-delay faultnál tiltott érték nem kerül továbbításra. A 6–7. napi recovery viselkedés megmarad.

### 16. nap – Összetett űrlapok és hatáselőnézet

**Fájlkör:** 15. napi modulok; privát targetadatok kliensbekötése; célzott E2E.

**Scenariók:** `host-outage`, `restart-flapping`, `network-degradation`, `node-isolation`, `clear-recover`.

**Lépések:** valódi registryválasztó az `anchorTargetId`/`targetIds` helyére; hálózat, szerep, enabled és maintenance állapot szerint jelzett választhatóság. Ne tegyél automatikusan seeddé vagy stakerré egy célpontot a neve alapján. Flapping ciklus/perc, hálózati késés/jitter/loss mértékegysége egyértelmű; szerepfüggő korlátokat a backenddel együtt ellenőrizd.

A preview a szerver által előállított mentett tervből mutassa az érintett hostok/node-ok számát, profilt, DKG/signing margint, akciókat és időket. Ismeretlen margin `unknown`, nem 0. A `clear-recover` saját szerverpolicyja szerint jelenjen meg; ne erőltesd rá az általános fault-időtartamot vagy ígérj nem támogatott live módot.

**Kész:** K1 + K2; mind az öt scenario teljes űrlap→preview útja, üres registry, letiltott target, eltérő hálózat, túl sok staker, rossz JSON. Módosított targetkészlet új previewt igényel, de a már futó kísérlet vezérlését nem törli.

### 17. nap – Publikus szimulációs eredmények

**Fájlkör:** `router.ts`, `api.ts`, új publikus szimulációs lista/részlet komponens, szükséges tiszta DTO-k, E2E; szerver csak a meglévő publikus válaszok indokolt bővítéséhez.

**Lépések:** `/simulations` és `/simulations/:runKey` nézet a már létező `/api/v1/simulations`, `/:runKey` és `/:runKey/report` API-kra. Az Experiments külön modell marad, nem migráljuk vagy keverjük össze. Lista lapozással; részleten scenario, mód, hálózat, státusz, tényleges mérési ablak és elérhető eredmény/minőségadatok. Csak létező publikus mezőket jeleníts meg: hiányzó mező nem található ki a privát adatokból.

Riport nélküli 404 lehet még nem elkészült/nem elérhető mérés; ez különbözik a nem létező run 404-től. `not-evaluable`/hiányos mérés nem siker, száraz futás nem élő hálózati bizonyíték. A Core adapter hivatkozása előzetes modellanyag, ne címkézd aktuális predikciónak. JSON-export kizárólag a publikus allowlist DTO-ból, `schemaVersion` és lekérés ideje kíséretében; admin history/artifact soha.

**Kész:** K1 + K2, route/DTO változásnál K3; 0/26 futam, folyamatban, mérésre váró, eltérés, nem értékelhető, sikertelen és befejezett példa. Publikus payload/export ne tartalmazzon beültetett privát sentinel mezőt. A navigációból és közvetlen URL-lel is elérhető.

### 18. nap – Navigáció és mobil

**Fájlkör:** shell, router megjelenítési metaadatai, shared stílusok, csak a tényleges overflow-t okozó oldalak, E2E.

**Rögzített csoportok:** Overview önálló; Network alatt DKG Rounds, PoSe Watch, Masternodes, ChainLocks, Sentinel Layer, Staking, Vantage Points, Operators, Fairness; Blockchain alatt Blocks/Transactions; Experiments alatt Experiments/Simulations. Az eredeti pathok maradnak. A csoport nem rejtett authhatár, `/admin` külön felület.

**Lépések:** egyszerű csoportos navigáció, mobilon kinyitható csoportok; aktív csoport és oldal világos. Brand link vissza a főoldalra. A főoldal felső részén adatfrissesség, hálózati állapot, aktuális profil és aktív kísérlet; hosszú módszertan összecsukható. Ne keverj újra profilokat a helyspórolásért. Valós táblázat vízszintesen görgethető, ne törd meg az oszlop–érték kapcsolatot CSS-sel.

**Kész:** K1 + K2; 360/390/768/1440 px és 200% zoom, betöltés/üres/hiba/hosszú azonosító állapot. Az egész dokumentum ne görgessen vízszintesen; a kijelölt táblázatkonténer görgethet, látható jelzéssel. Billentyűzet és skip link megmarad. A light téma bekapcsológomb opcionális, nem e nap teljesítésének feltétele.

### 19. nap – Célzott keresés és használati segítség

**Fájlkör:** kis globális keresőkomponens, típusfelismerő helper/teszt, meglévő publikus API-k, shell, rövid módszertani oldal vagy komponens. Nincs általános teljes szöveges index e napon.

**Első kiadás támogatása:** blokkmagasság, blokkhash, txid, ismert experiment runKey és `sim_…` runKey. Egy 64 hex karakteres azonosítóról ne döntsd el pusztán a formátuma alapján, hogy blokk vagy tx: kérdezd le a meglévő publikus végpontokat, és több találatot külön jeleníts meg. 404 = nincs ilyen találat; 401/429/500/timeout = nem lehetett ellenőrizni, nem „nincs találat”.

Keresés explicit submitra történjen, ne billentyűnként több nehéz kérés. A régebbi keresés válasza nem írhatja felül az újabbat. Másolásgomb a teljes azonosítót másolja és jelezze a clipboard-hibát is. Rövid DKG/PoSe/DSL/HHI/Gini magyarázat a tényleges metrikák alapján, minta és megfigyelési korlát feltüntetésével. Saját egyszerű favicon meglévő grafikai nyelven; ne tervezz új arculatot.

**Kész:** K1 + K2; üres/whitespace, magasság, hash-találat, több találat, nincs találat, timeout, másolás. `proTxHash` keresés itt még nem kész: nincs hozzá kész dedikált részletútvonal, ezt külön backlogban kell vezetni, nem block/tx oldalra irányítani.

### 20. nap – Regresszió és review-csomag

**Fájlkör:** szükséges célzott javítások, tesztek, napló és átadási dokumentáció. Nincs új funkció.

**Lépések:**

1. Friss, tiszta checkoutban K0–K4; teljes CI eredmény, nem csak helyi node_modules-on futó teszt.
2. Újraellenőrzés F01–F14 szerint. Minden sorhoz: javító commit, automatizált teszt, böngészős/API-bizonyíték és fennmaradó korlát. A jelentésben külön legyen kód kész, ellenőrzött, illetve élesben telepített.
3. A fő publikus oldalak és admin panel desktop/mobil útjai; hibás API, 401/404/429/500, lassú/késő válasz, F5/Back/Forward. Ne csak a happy pathról legyen kép.
4. Ha van külön erre engedélyezett izolált regtest-labor, a meglévő operations dokumentáció szerint egy kis, már támogatott futam normál végigfutása és egy külön abort/recovery futam. Mérési eredmény és hostoldali helyreállítás bizonyítéka is kell. Ha nincs ilyen engedély/környezet, ezt **nem futtatott labor-elfogadásként** jelöld; a UI/mockteszt nem helyettesíti.
5. Átadási csomag: baseline/HEAD SHA, commitlista, tesztösszesítő, F01–F14 mátrix, screenshot/trace fájlok helye, DTO-változások, új függőségek, nyitott hibák, nginx beillesztés/rollback. Ne legyen benne secret vagy teljes privát history dump.

**Kész:** a független reviewer egyértelműen reprodukálni tudja a módosításokat és látja, mi nincs még bizonyítva. A review során talált hibákra külön javító commitok, majd érintett tesztek és végső kapu; utána ismételt review. A deploy csak külön lépés.

## 5. Könnyen elkövethető hibák – gyors ellenőrzőlista

| Csapda | Helyes megoldás |
|---|---|
| F5 után új futam létrehozása a régi helyett | Létező GET run + immutable plan; ugyanaz a runKey |
| Régi poll felülír egy friss start/abort választ | Revision + kiválasztás/kérés generáció, egy frissítési tulajdonos |
| Bármely formváltozás törli a recovery panelt | Draft és kiválasztott futam külön állapot |
| GET status vagy history sikeréből „preflight passed” következik | Csak valódi preflight bizonyítékból; külön unknown |
| Egyszerű időzítő kliensoldalon befejezettnek mondja a recoveryt | Szerverállapot és helyreállítási bizonyíték |
| Minden negatív szám `—` lesz | Csak az adott számláló hiányt jelző értéke; delta/margin megmarad |
| A betöltött listából számolt érték teljes hálózati összesítésnek látszik | Teljes aggregátum a szerveren; minta/limit egyértelmű |
| 64 hex karakter automatikusan txid | Többféle publikus találat vizsgálata |
| Kliensvalidátor váltja ki a szervervalidátort | Kliens a használhatóságért, szerver a tényleges döntésért |
| UI zöld tesztet valódi Core-futamként jelentik | UI, HTTP/Mongo és laborbizonyíték külön |
| Az új frontend csak az új backenddel tud renderelni | Additív DTO; hiányzó új mező unknown és dokumentált telepítési sorrend |
| CSP csak az API-válaszon szerepel | HTML dokumentum és nginx locationök külön vizsgálata |
| A tesztminta elkéri az élő API-t | Helyi, szintetikus fixture és nem mockolt API-kérések tiltása |
| Kód elkészült = auditpont élesben lezárva | Kód, teszt, runtime és deploy külön státusz |

## 6. Tudatosan későbbre hagyott funkciók

Ezek nem titokban hiányzó részei a 20 napnak: külön tervezendő következő kör.

- Éles devnet remote chaos bekapcsolása, flotta- és hostműveletek, Core-módosítások.
- Teljes `proTxHash` keresés és masternode-részletoldal, címkeresés.
- Minden táblázatra kiterjedő CSV-export és új szerveroldali szöveges keresés; első körben a szimulációs publikus JSON-export készül.
- Nagy mintákra cursor pagination és teljesítmény-optimalizálás csak mérés alapján.
- Új baseline-statisztika és automatikus összehasonlítás ott, ahol nincs már megbízható szerveroldali metrika.
- Teljes témaváltó, többnyelvűség, új arculat.

## 7. Átadás a modellnek

A bemásolható napi indító- és review-prompt itt van: [WEBSITE_MODEL_PROMPTS_HU.md](WEBSITE_MODEL_PROMPTS_HU.md). A napok állapotát itt vezesd: [WEBSITE_IMPLEMENTATION_LOG_HU.md](WEBSITE_IMPLEMENTATION_LOG_HU.md).

A review nem az implementáló önértékelése: a befejezett változtatásokat az audit megállapításai, a diff és a tényleges működés alapján külön kell visszaellenőrizni.
