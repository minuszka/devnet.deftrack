# Az 01–10. nap független review-ja

**Dátum:** 2026-09-12. **Döntés:** javítás szükséges; az első tíz napot egészében még nem fogadom el lezártnak. A meglévő ellenőrzések zöldek, de hét további hibához reprodukálható ellenpélda van.

**Vizsgált állapot:** helyi `main`, `83b8710`. A GitHub szerint a [PR #162](https://github.com/minuszka/devnet.deftrack/pull/162) merge-elve: `f95b44a04f9d8f94b2bfaa10aaa108bddc4590af`, 2026-09-12 14:00:43 UTC. Az implementáció `700c420`-ig terjedő változásait az ütemtervvel és a napi naplóval vetettem össze; a helyi főág már a #163 DSL-headline módosítását is tartalmazza. Az attól származó három további E2E tesztet nem számolom a tíznapos implementáció saját eredményének.

Ez forráskód- és helyi tesztalapú review. A production telepített verziójának azonosságát nem igazolja. Valódi laborfutam, wallet RPC, lease vagy live-run lock működési próba nem történt. A production nginx hibás percent-escape kezelését sem vizsgáltam; az továbbra is a 14. napi feladat része. Ezeket nem tekintem az első tíz nap mulasztásának.

## Találatok

P1: a szimulátor további építése előtt javítandó vezérlési hiba. P2: a mostani elfogadás előtt javítandó működési vagy adatértelmezési hiba. Az R-azonosítók e review találatai, az F-azonosítók az eredeti audit pontjai.

| ID | Szint | Érintett nap / audit | Reprodukált eltérés |
|---|---|---|---|
| R1 | P1 | 06–07 / F01 | B kiválasztása után A Abort gombja még A-ra küldhet parancsot |
| R2 | P1 | 06–07 / F01 | A késői hibaválasza eltünteti a már betöltött B vezérlését |
| R4 | P1 | 06–07 / F01 | A indítási megerősítése bejelölve marad B-nél |
| R3 | P2 | 07 / F02 | Az új állapot mellett régi vagy hiányzó recovery bizonyíték marad |
| R5 | P2 | 09–10 / F05 | Az automatikus Fairness-profil és a feloldási hiba beragad |
| R6 | P2 | 09 / F06 | Az „aktuális regisztrált” hostlétszám történeti szűrést kap |
| R7 | P2 | 06–07 / idempotencia | Szerkesztett draft ugyanazt a create kulcsot kapja, mint az előző kérés |

### R1 — Futamváltás alatt a régi futamra lehet parancsot küldeni

**Hely:** `client/src/components/dd-admin-shell.ts:592`, valamint `client/src/components/dd-simulation-control.ts:430` és `:476`.

Az `_loadSelectedRun()` rögtön B-re állítja a kiválasztott kulcsot, de A objektumát és tervét a betöltés idejére megtartja. A gyermekkomponens megjelenítési és műveleti feltétele nem ellenőrzi, hogy `run.runKey === selectedRunKey`. A shell betöltési jelzője sem tiltja a gyermek gombját.

**Reprodukció:** A állapota `fault_active`. B mentett tervének válasza 1800 ms késleltetést kap. B kiválasztása után az elérhető Abort gombra kattintva a teszt ténylegesen egy `POST /api/v1/admin/simulations/runs/sim_aaaa…/abort` kérést rögzít, miközben az URL már B. Ez kizárólag a helyi mock végpontra ment.

**Javítás:** különítsd el a kiválasztás betöltését és a már hitelesen betöltött futamot. Különböző kulcsú objektum ne jelenhessen meg vezérelhető futamként; a mutáció belépési feltétele is ellenőrizze a futamazonosságot. B-re váltáskor az A-hoz tartozó terv, bizonyíték, preflight és timeline ne látszódjon B adataként. Ugyanazon futam sikertelen státuszfrissítése továbbra se vegye el annak meglévő vezérlését.

**Elfogadás:** R1 zöld; késleltetett B alatt nulla A-mutáció; betöltés után B megfelelő gombjai elérhetők. Ellenőrizd a listakattintást és az URL/history útvonalat is.

### R2 — Elavult kérés hibaága felülírja az új kiválasztást

**Hely:** `client/src/components/dd-admin-shell.ts:599`.

A sikerágban van kulcsellenőrzés, az `_loadSelectedRun()` `catch` és `finally` ágában nincs. Az előző kérés ezért törölheti a jelenlegi adatokat, hibát írhat az új futam mellé és módosíthatja annak betöltési állapotát.

**Reprodukció:** A `/dry-run` válasza 1200 ms után 503. Közben B sikeresen megjelenik. A hibája után az URL B marad, de a `.run-state` és a hozzá tartozó vezérlés eltűnik.

**Javítás:** kiválasztásonként növekvő kérésgenerációval védd a teljes betöltést, beleértve a siker-, hiba- és lezáróágat. Pusztán a kulcs összehasonlítása nem védi az A→B→A esetet. Kijelentkezés/kiválasztástörlés is érvénytelenítse a generációt. A hydration közben beérkező újabb pollt se írhassa vissza alacsonyabb revisionre a mentett terv válasza.

**Elfogadás:** R2 zöld; külön siker/404/503 késő válasz; A→B→A; kijelentkezés utáni válasz; hydration és újabb poll keresztezése. A felsorolt kiegészítő esetek javítási elfogadási feltételek, nem e review külön reprodukált találatai.

### R4 — A megerősítés nincs futamhoz kötve

**Hely:** `client/src/components/dd-simulation-control.ts:221`, `:354`, `:673`.

A `_startAcknowledged` és `_riskAcknowledged` mező új Prepare után visszaáll, meglévő futamok közötti váltáskor viszont nem. A módosított kiválasztási modell így egy másik tervre adott felhasználói megerősítést is továbbvisz.

**Reprodukció:** armed A-nál bejelölöm az „I confirm” mezőt; átváltok armed B-re. B `Confirm and start` gombja új bejelölés nélkül engedélyezett. A teszt nem indít futamot; a hibás engedélyezést ellenőrzi. Ez nem szerveroldali jogosultságmegkerülés, hanem a futamspecifikus felhasználói megerősítés elvesztése.

**Javítás:** a jóváhagyási állapotot kösd a betöltött futam és mentett terv azonosságához, és futamváltáskor töröld. Egy rutin poll ugyanarra a változatlan tervre ne törölje indokolatlanul a felhasználói állapotot.

**Elfogadás:** R4 zöld; külön risk- és start-checkbox teszt. A-ra visszatérve se legyen hallgatólagosan érvényes egy B-nél adott megerősítés.

### R3 — Recovery és timeline nem követi az automatikus állapotváltásokat

**Hely:** `client/src/components/dd-admin-shell.ts:466`, `:492`, `:518`, `:544`.

A státuszpoll csak `_selectedRun`-t frissíti. A recovery bizonyíték kizárólag a kezdeti `_loadHistory()` során töltődik be. Saját mutáció után a külön history-frissítés sem kér recoveryt; az automatikus átmeneteknél a history sem frissül. A dashboard Refresh ugyanarra a már betöltött kiválasztásra nem kényszerít teljes újraolvasást.

**Reprodukció:** kezdetben `fault_active`, recovery `null`. A szerver fixture később `cooldown`, revision 9, `allClear: true` bizonyítékot kínál. Az öt másodperces poll után a státusz már cooldown, de a felirat továbbra is „No recovery proof has been recorded”.

**Javítás:** releváns állapot/revision-változás és abort/recover mutáció után frissítsd a recoveryt és a timeline-t; terminal állapotba érkezéskor is legyen végső egyeztetés. A mentett tervet emiatt nem szükséges minden pollban újraolvasni. A külön olvasások kapjanak kiválasztás- és generációvédelmet. Sikertelen bizonyítékfrissítés ne jelentsen automatikusan „clear”-t vagy azt, hogy soha nem volt bizonyíték.

**Elfogadás:** R3 zöld; recovery null→clear, sikertelen→clear, saját recover utáni frissítés és automatikus terminal átmenet. A timeline-ban a szerver új eseménye is megjelenik.

### R5 — A Fairness-profil feloldása egyszer történik meg

**Hely:** `client/src/components/dd-page-fairness.ts:152`.

A chain tip és ChainLock metaadat csak `_resolved === null` mellett olvasódik. A sikeresen feloldott profil és a `{ known: false }` eredmény is nem-null, így mindkettő végleg beragad az adott komponenspéldányban. Az `_effective()` minden olvasáskor lefut, de ugyanazt a korábbi eredményt olvassa.

**Két reprodukció:**

- Profil nélküli `/fairness`, tip az aktiválási magasság alatt: V1. Tip az aktiválás fölé lép; 60 másodperc után a következő Fairness-kérés még V1-et kér V2 helyett.
- Első ChainLock kérés 503; később az endpoint helyreáll. A következő frissítéskor továbbra is nulla Fairness-adatkérés indul. Teljes újratöltés vagy kézi profilválasztás oldja fel.

**Javítás:** automatikus profilkövetésnél a dinamikus feloldási adatokat újítsd meg; átmeneti feloldási hiba legyen újrapróbálható. Az explicit `llmq=…` és `llmq=all` választás maradjon stabil, azt ne írja felül a chain tip. A profil-registry külön, indokolt cache-e megmaradhat.

**Elfogadás:** R5a és R5b zöld; explicit profil és aggregate változatlan a tip frissülésekor; feloldhatatlan profil továbbra sem indít néma összesítést.

### R6 — Az aktuális registry létszáma nem lehet a történeti eligibility létszáma

**Hely:** `server/src/domain/selectionFairness.ts:219`; hibás elvárást rögzítő meglévő teszt: `server/src/domain/selectionFairness.test.ts:180`.

A `currentRegisteredNodes` dokumentációja és a 09. nap 3. pontja a jelenlegi aktív registry hostlétszámát írja elő. A számolás mégis kihagyja azokat, amelyekre a vizsgált múltbeli ablakban nincs eligible round. Emiatt a „Registered nodes” szám nem a jelenlegi registryt jelenti, és a profil/időablak is befolyásolhatja.

**Reprodukció:** ugyanazon host két jelenleg regisztrált node-ja: egyik a 10., másik a 101. magasságtól. A vizsgált round magassága 100, egy kiválasztott node-dal. Eredmény: `nodes=1`, `currentRegisteredNodes=1`; a helyes aktuális létszám 2. A második node továbbra sem tartozhat a `neverSelected` listába, hiszen akkor még nem volt eligible.

**Javítás:** a jelenlegi registry létszámát a teljes átadott aktív registryből számold. Az eligibility-szűrés maradjon a történeti arányoknál és a `neverSelected` meghatározásánál. Ha külön eligible hostlétszám is kell, az más mező/jelentés; a jelenlegi mezőt ne nevezd át hallgatólagosan.

**Elfogadás:** R6 zöld; új node beleszámít a jelenlegi létszámba, de nem gyárt mesterséges starvationt. Az eredeti 7/5, nulla kiválasztás, redakció és vágás előtti összesítés tesztjei maradnak. A hibás meglévő unit elvárást dokumentált szerződéskorrekcióként módosítsd, ne egyszerűen töröld.

### R7 — Azonos seed mellett a megváltozott draft örökli a korábbi create kulcsát

**Hely:** `client/src/components/dd-simulation-control.ts:237` és `:346`. Szerveroldali következmény: `server/src/services/simulationControl.service.ts:387`, `server/src/services/simulationControlPersistence.service.ts:143`.

A create idempotenciakulcs scope-ja csak `draft:<seed>`. Hibás vagy bizonytalan kimenetelű Prepare után a paraméter, scenario, network vagy mode szerkesztése nem változtatja meg a kulcsot. A szerver ugyanakkor a teljes payloadhoz köti azt. A claim a draft-előkészítés előtt megtörténik, ezért egy utána fellépő hiba is hagyhat már lefoglalt kulcsot.

**Reprodukció:** első Prepare bizonytalan hibát kap; változatlan ismétlés ugyanazt a bodyt és kulcsot küldi, ami helyes. Ezután csak `count: 1`→`2` változik. A harmadik kérés bodyja más, a kulcsa változatlan. A böngészőteszt ezt a kimenő szerződéssértést bizonyítja. A már claimelt kulcsnál bekövetkező `IDEMPOTENCY_CONFLICT` a szerver kódjából következik; ezt ebben a review-ban nem külön valós HTTP-futammal mértem.

**Javítás:** a create-kulcs a teljes, elküldött draft azonosságához tartozzon. Azonos bizonytalan kérés retrya használja újra; megváltozott payload új kérés. A kulcs kiosztásakor fogd meg a request snapshotját, és annak scope-ját zárd le a válaszban. Az existing run+operation kulcsokat ne nullázd egy draftmező szerkesztése miatt.

**Elfogadás:** R7 zöld; változatlan retry ugyanaz, valóban eltérő payload más kulcs; a meglévő abort/recover retrytesztek is zöldek. Egészítsd ki a szerver claim/replay szerződésével, ne gyengítsd a szerver fingerprint-ellenőrzését.

## Ellenőrzések és bizonyítékok

| Ellenőrzés | Eredmény |
|---|---|
| GitHub PR #162 merge és CI-ellenőrzések | MERGED; a lekérdezett CI checkek sikeresek |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; szerver 844, kliens 139 teszt |
| `npm run build` | exit 0 |
| `npm run test:e2e -w client` | exit 0; 78/78 meglévő böngészőteszt |
| `MONGODB_TEST_URI=mongodb://127.0.0.1:27018` mellett `npm run test:integration` | exit 0; 14 fájl, 89 passed, 8 skipped |
| Review ellenpróbák, az alábbi külön konfigurációval | exit 1; 8 failed, 1 passed; a nyolc bukás hét találathoz tartozik |

A Mongo-próbák a teszthelper által generált külön adatbázisokat használták. A nyolc skip a Mongo nélkül futtatandó tartalék ellenőrzések ága; nem nyolc elmaradt laborfutam.

A review tesztjei a meglévő loopback-only E2E harnessre épülnek. **Nincs `test.fail`, skip vagy fordított elvárás az R-tesztekben:** a helyes működést kérik, ezért a jelenlegi hibás kódon pirosak. R6 tiszta domain-teszt ugyanebben a runnerben. A C1 a tényleges böngésző Back műveletével ellenőrzi az Experiments→Rounds→Back útvonalat; zöld, ezért a feltételezett cross-route filtervesztést nem jelentem hibaként.

Futtatás a repository gyökeréből:

```powershell
npx playwright test --config docs/review-2026-09-12/playwright.config.ts
```

- [Ellenpróbák](review-2026-09-12/regressions.spec.ts)
- [Külön Playwright-konfiguráció](review-2026-09-12/playwright.config.ts)
- [Teljes review-futtatás kimenete](review-2026-09-12/results.txt)
- Helyi trace-ek és hibaképek: `client/test-results/review-days-01-10/`. Ezek generált, gitből kizárt fájlok; az újrafuttatás újra létrehozza őket.

A meglévő suite-ban láttam `ResizeObserver loop completed with undelivered notifications` üzenetet is. A napló már korábbi alapállapoti jelenségként kezeli; nem számolom új 01–10. napi regressziónak. A későbbi UI/runtime elfogadásnál legyen rá explicit döntés.

A napi napló negatív kontrollokról szóló korrekcióit és a hozzájuk tartozó tesztállításokat is átnéztem. A javított projekcióteszt valóban a HTTP-választ ellenőrzi, a lapozásvizsgálat elválasztja a tie-breaker állítását a bizonyított eredménytől, a query teszt másik pathname-ről indul. A korábbi forrásmódosításos negatív kontrollokat nem játszottam újra; saját, implementációmódosítás nélküli ellenpéldákat készítettem. A jelenlegi zöld suite ténye és a korábban feljegyzett kontrollok nem fedik le az itt kimutatott eseteket.

## Auditpontok javasolt státusza

| Audit | Review után |
|---|---|
| F01 | Újranyitandó: R1, R2, R4 |
| F02 | Újranyitandó: R3 |
| F03 | A vállalt fejléc/Overview körben elfogadható; nem minden oldal frissességi auditja |
| F04 | A vállalt kísérletlapozási körben elfogadható |
| F05 | Újranyitandó: R5 |
| F06 | Újranyitandó: R6 |
| F07 | Kliensoldali javítás elfogadható; production nginx továbbra is nyitott, 14. nap |
| F08 | Elfogadható a vizsgált routing körben |
| F09 | Elfogadható a descriptor/preset/capability körben; nem labor-elfogadás |
| F11 | A 10. napi alapok tesztelve; a többi oldal bekötése a 11. nap feladata |

R7 külön idempotencia-regresszió, amely a 06–07. napi kliensmódosításhoz kapcsolódik. Az eredeti naplót a review nem írta át; a fenti státuszok a javító ág számára adott visszajelzés.

## Átadható javítási sorrend

A 11. nap önálló URL-bekötése külön branchen elindítható. Az admin és Fairness fájlok javításai külön commitok legyenek; a 15–17. napi szimulátoros továbbépítés és a 20. napi labor-elfogadás előtt a vezérlési hibák rendezése szükséges. A jelenlegi tíz nap teljes lezárásához mind a hét találat elfogadási feltétele kell.

| Javító munkanap | Kis lépések | Fájlkör | Kész feltétel |
|---|---|---|---|
| J1 | R1 → R2 → R4, külön ellenőrzött lépések | admin shell, simulation control, kiválasztás/revision helper, kapcsolódó tesztek | Nincs eltérő futamra küldhető parancs; nincs késői felülírás; megerősítés futamspecifikus |
| J2 | R3 → R7 | ugyanazon admin komponensek, szükség esetén kis draft-azonossági helper és tesztek | Recovery/timeline követi az átmenetet; retry és megváltozott kérés kulcsa helyes |
| J3 | R5 → R6 → teljes elfogadási kör | Fairness komponens, domain, releváns HTTP/unit/E2E tesztek, napló | Mind a 9 review próba zöld; régi kapuk zöldek; auditstátuszok bizonyítékkal frissítve |

Ezek sorrendi munkacsomagok, nem garantált időbecslések. Ha egy lépés nem fér bele, maradjon nyitott; a tesztelvárás nem lazítható a napi címke kedvéért.

**Másolható feladat az implementáló ügynöknek:**

```text
Olvasd el a docs/WEBSITE_REVIEW_DAYS_01_10_2026-09-12_HU.md fájlt.
A review alapja main@83b8710; azóta érkezett változásokat előbb azonosítsd.
Készíts külön javító branchet. J1, J2, J3 sorrendben dolgozz, kis commitokban.
Először reprodukáld az adott R-teszt piros eredményét, utána javíts.
Ne változtasd meg a teszt üzleti elvárását azért, hogy zöld legyen.
Az R6-nál megnevezett korábbi hibás unit elvárást a dokumentált szerződéshez
igazítsd, és indokold a naplóban.
Azonos futam sikertelen státuszpollja továbbra is tartsa meg a vezérlést.
Ne resetelj minden állapotot minden pollnál. Ne gyengíts authot, CSRF-et,
revision-ellenőrzést vagy szerveroldali idempotencia/fingerprint védelmet.
Ne indíts valódi faultot, ne módosíts Core-t, ne deployolj e javítás részeként.
A review próbákat illeszd be a normál CI-kapuba, vagy adj nekik explicit
CI-parancsot: pusztán a docs alá mentett teszt jelenleg nem automatikus kapu.
Minden munkacsomag végén releváns tesztek; a végén typecheck, unit, build,
teljes E2E és releváns valós HTTP/Mongo integrációs kör.
Átadás: commitok, találatonként javítás + teszt + tényleges exit-kód,
nyitott korlátok. A kész javító diffet új review-ra add vissza.
```

**A review munkaterületi változtatása:** csak ez a jelentés és a `docs/review-2026-09-12/` bizonyítékcsomag. Alkalmazáskódot nem javítottam; commit, push, merge és deploy nem történt.
