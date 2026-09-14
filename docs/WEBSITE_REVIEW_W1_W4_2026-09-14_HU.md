# Független review — W1–W4 és a pollteszt szigorítása, PR #176

**2026-09-14.** Alap: `72fec824319aa8da9bd3cf33e64daa25326c705d`. Vizsgált HEAD: `eb767738f022277ad984275fe53e527e78707261`, `web/review-fixes-2026-09-13-2`, hét commit. A [PR #176](https://github.com/minuszka/devnet.deftrack/pull/176) az utolsó ellenőrzéskor **OPEN**, nincs merge-commit. A J7 naplót és a handover 15. pontját állításként ellenőriztem, a kódot és a tényleges diffet önállóan olvastam.

## 1. Megmaradt és új hibák

| Jegy | Szint | Reprodukció, ok és javaslat |
|---|---|---|
| [X1 — elvesző recovery-401](review-2026-09-14/X1-initial-401-lost.md) | **P2, W2 maradéka** | Kezdeti history **vagy** dry-run 503, majd recovery 401 → a privát felület nem vált session-lejáratra. A `_loadHistory()` `Promise.all`-ja az első hibával elutasítódik, a recovery `sessionEnded` vizsgálata kimarad (`dd-admin-shell.ts:597–610`). Két szabályozott ellenpróba reprodukálja. Minden kérés eredményét megőrző, a kiválasztási őr után 401-et kezelő megoldás kell. |
| [X2 — hibás tesztlezárás](review-2026-09-14/X2-harness-test-cleanup.md) | **P3, új teszthiba** | A W3 első negatív kontrollja helyesen bukik a korai release miatt, de a dobó állítás után elmaradó `await allow` miatt a timer már bezárt lapot hív (`harness.spec.ts:156–169`). A pillanatnyi eredményt a cleanup előtt kell rögzíteni, az állítást rendezett cleanup után elvégezni. |

**P1-et vagy új alkalmazásoldali regressziót nem igazoltam.** X1 a korábban már hibás session-kezelés összetett, megmaradt esete; X2 a J7 új tesztjének hibás ága. Egyikből sem következik szerveroldali jogosultságmegkerülés vagy valódi faultindítás.

Az új [extra ellenpróbák](review-2026-09-14/extra.spec.ts): két X1 eset piros, két kontroll zöld. A korábbi [W1–W4 + C2 ellenpróbák](review-2026-09-13-followup/followup.spec.ts) **5/5 zöldek**. A külön hibajegyek a szűk fájlkört és az elfogadási feltételeket is megadják.

## 2. W1–W4 döntés

| ID | Döntés | Konkrét bizonyíték |
|---|---|---|
| **W1** | **Lezárva** | `dd-page-simulations.ts:261–282`: a hiba és a lekérdezéshez tartozó lista együtt renderelhető; adat nélkül csak a hiba. `public-simulations.spec.ts:86,100,111`: azonos lap pollhibája mellett sor + darabszám, első hiba mellett sem üres rekord, sem „Loading”, következő jó pollnál új sorok és eltűnő hiba. Mind sikeres; saját W1 zöld, a hibás baseline-on az adatmegőrzési teszt piros. |
| **W2** | **Részben** | A normál kezdeti recovery-401 és a refresh history/recovery-401 a generációs őr **után** session-lejárat lesz (`dd-admin-shell.ts:604–610,745–766`). Az újraolvasó gomb is ezen az ágon megy. `run-status.spec.ts:1075,1089,1112,1138` és saját W2 zöldek; az 503/GET korábbi V7 tesztek is sikeresek. **X1:** kezdeti párhuzamos hibák kombinációja még elnyeli a 401-et. |
| **W3** | **Lezárva a harness működésére** | `harness.ts:198–217,238–250,296–322,462–472`: válaszonként növekvő azonosító, a konkrét Response fejlécéből olvasott azonosító, a release a sajátjára vár. A jelenlegi két új önteszt és a saját W3 zöld. A régi harness-szel mindkettő tényleges **korai visszatéréssel** piros; a két azonos URL-ű, fordítva olvasott válasz esetében is. A negatív kontroll első tesztjének cleanup-maradéka külön X2. |
| **W4** | **Lezárva** | `dd-page-fairness.ts:187–192,250–252,262–264`: az adatkulcs az ablak és az effektív profil; kizárólag egyezéskor renderel. `fairness.spec.ts:272,285,300`: hibás és késleltetett tip-váltás, azonos profil hibája melletti adatmegőrzés. Saját W4 is zöld; a régi komponenssel a tip-váltási hibateszt piros. |

**V4 most lezárható a meghatározott webes követelményekre.** A W1 és W4 maradékot javították. A hét kézzel lapozható/szűrhető nézet 17 query-identity próbája külön is sikeres; Staking és Vantage points is benne van. Az eredmény nem éles vagy labor-elfogadás.

## 3. Kiemelt kölcsönhatások és pontosítások

### W2, session és futamváltás

Az új 401-kezelés előtt a kezdeti ág generációt, a refresh ág generációt **és** runKey-t ellenőriz. A `_endSession()` emeli a generációt és törli a privát kiválasztást. A már működő V1 dry-run-401, R1/R2, terv nélküli abort és a read-again csak GET feltételei a teljes körben sikeresek.

Külön saját **C3**: A kezdeti recovery-401-e visszatartva, közben B-re váltunk, B tervét szintén visszatartjuk; B pollból ismert és terv nélkül aktív. A késői A-401 elolvasása után B, a Sign out és B abortja megmarad. Ez nem csak a korábbi refresh-401 teszt újrafuttatása: a kezdeti olvasást és a terv nélküli új futamot együtt vizsgálja.

A recovery- és history-frissítés elutasításai kezelt eredménnyé válnak, nem nyers, fire-and-forget rejectionként távoznak. A két X1 próbában a 401 elolvasása után a figyelt `pageerror` lista is üres; a rossz eredmény az elvesztett session-minősítés. **A „minden kezdeti 401 kezelve” állítás az X1 miatt túl erős.**

### W4 és az R5 feloldási szabály

A javítás nem írja át az R5 feloldását. Profil nélküli URL-nél továbbra is megvárja az aktuális feloldást a lekérdezés előtt; explicit profilnál a háttérben feloldott „at the tip” jelölő nem változtatja meg a követett profilt. Az aggregát külön explicit választás marad. A kulcsot a kérés indításakor rögzíti, a választ `run.stale` ellenőrzés után fogadja el.

A meglévő Fairness tesztek a feloldási hiba utáni újrapróbálást, az aktiválási váltást és az explicit profil megtartását is mérik. A query-state tesztek ellenőrzik az URL-ablakot/profilt és a Back visszatérését a tip-követésre. A mai teljes K2-ben ezek sikeresek. Az új W4-próbák az eddig hiányzó, **sikertelen/késleltetett** profilváltást adják hozzá.

### W3 fejléc, cancellation, teardown és CSP

A sorszám egy AppHarness-példányban nő, és a response fejléce hordozza; két azonos URL nem jelent azonos azonosítót. A JSON törzse, státusza és az eredeti `Response.json()` Promise változatlan. Az alkalmazás forrásában nincs az `x-harness-response-id` fejlécet olvasó kód; ezt az observer használja. A fejléc csak mockolt API-válaszokra kerül, production-kódba nem.

A release előtti cancelled ellenőrzés és a `ResponseGate.abandon()` logikája nem változott. A cancellation és paused-clock öntesztek sikeresek. A külön saját **C4** meghívja a teardown által is használt `abandonHeld()`-et: a held queue kiürül, a fetch elutasítódik, a visszatartott törzs nem jut a lapra. Ez a primitív működését méri; nem állítom, hogy minden hibás teszt-fixture teardown útját lefedi — X2 éppen egy ilyen külön rés.

A buildelt kliens **4/4 CSP-próbája** sikeres az új harness mellett, beleértve az admin chunkot, a publikus exportot és a tényleges policy-enforcement negatív kontrollját. Nem találtam a fejlécből eredő új alkalmazásviselkedést vagy CSP-hibát. A mockos suite továbbra sem valódi szerver-/laborbizonyíték.

## 4. A pollteszt szigorításának önálló ellenőrzése

Az `acceptsRunUpdate()` revision-őrét kizárólag egy olvasási célú Vite-overlay-ben cseréltem `return true`-ra. A munkafa alkalmazáskódját nem írtam át. A régi tesztet `git show 72fec82:client/e2e/run-status.spec.ts` alapján, a jelenlegi harness mellett futtattam. A teszt törzse változatlan, csak a másolat importútvonalai igazodtak a review könyvtárhoz.

| Teszt / kód | Saját eredmény |
|---|---|
| Régi pollteszt + hibás revision-szabály | **3/3 piros**; `aborting` helyett `fault_active` |
| Új pollteszt + ugyanaz a hibás revision-szabály | **3/3 piros**, ugyanazon állításon |
| Új pollteszt + helyes kód | **3/3 zöld**; a teljes K2-ben is sikeres |

**A napló 3/3 állítását reprodukáltam.** A korábbi teszt gyengesége konstrukciós volt, nem a most vagy korábban bizonyított hamis zöld. A `c82db16` szigorítása indokolt: a teszt most az óra léptetése előtt elmenti az olvasások számát, utána legalább egy új, régi státuszt hordozó pollválasz JSON-olvasását várja meg (`run-status.spec.ts:91–99`). Mivel ebben a próbában az ezen az URL-en érkező pollok mind a régi revisiont adják, a feltétel az ellenőrizni kívánt válasz feldolgozását köti az állításhoz.

## 5. Tesztek és negatív kontrollok hitelessége

- **W1 szelektor:** a darabszámot a `.card-head .page-sub`-on állítja, nem a két elemre illeszkedő általános `.page-sub`-on (`public-simulations.spec.ts:97`). A javított teszt sikeres.
- **W1 kezdeti hiba:** külön állítja, hogy nincs „No simulation run…” és nincs „Loading” (`:100–108`). Nem pusztán sorhiányt mér.
- **W4 hibafelirat:** a „Could not be loaded, so what exists is unknown.” szöveget külön láthatósági állítás méri (`fairness.spec.ts:282`). Nem csak a régi táblák hiányát.
- **W3:** a két új önteszt törzset ellenőriz közvetlenül a release után; nincs ezt később kijavító polled assertion. A régi harness mindkettőnél `undefined`-ot ad: **nem timeout** a kontroll elsődleges hibája. Az első kontroll utólagos hibája az X2-ben pontosan elkülönítve.
- **W2:** a négy új rendes teszt valós fixture-válaszok és kézi kapuk alapján működik; a kezdeti 401, gombos 401 és timeline-refresh 401 régi klienssel külön-külön elbukik. A kombinált kezdeti hibákat nem fedték le — ezek az X1 új ellenpróbái.

Saját kontrollok: **5 kiválasztott alkalmazásteszt a 72fec82 érintett komponenseivel mind piros**, két W3 önteszt a régi harness-szel piros, a pollteszt régi/új változatával további 3+3 revision-kontroll piros. Nem állítom, hogy a J7 minden egyes történelmi, egy őrt eltávolító kontrollját megismételtem; a saját futtatások a mellékelt forrással és naplókkal reprodukálhatók.

## 6. Futtatások és GitHub CI

| Kapu | Saját eredmény | Mit bizonyít |
|---|---|---|
| K1 | shared build, typecheck, **864 szerver + 203 kliens = 1067 unit**, teljes build: exit 0; `git diff --check` tiszta | A meglévő checkout fordítása és unit-/build-kapuja |
| K2, teljes | **288 sikeres + 1 bukás**, exit 1; nincs automatikus retry | A bukás a DKG Rounds kezdeti modulbetöltésében történt, nem a lapváltási üzleti állításon |
| K2 trace-vizsgálat | `dd-page-rounds.ts`: **net::ERR_NO_BUFFER_SPACE**, console és network bejegyzés egyaránt | A jelzett ismert helyi környezeti hiba; nem feltételezés |
| Célzott query-identity újrafuttatás | **17/17**, exit 0, 14 s | A hibásan induló eset és a teljes érintett query-identity fájl most végigfutott; az első teljes kör ettől nem lett zöld |
| K3 | **98 sikeres, 8 kihagyott**, 15 fájl, exit 0 | Valódi HTTP/Mongo integráció, elkülönített `127.0.0.1:27018`, generált eldobható tesztadatbázisok |
| CSP | **4/4**, exit 0, 7,2 s | Aktuálisan buildelt kliens és a policy; nem éles nginx-mérés |
| Korábbi saját W1–W4/C2 | **5/5**, exit 0 | UI-fixture, valamint a harness saját válaszának azonosítása |
| Új X1/C3/C4 | **2 piros + 2 zöld** | A kombinált hibák és a két külön kontroll |
| Negatív kontrollok | **5 + 2 + 3 + 3 elvárt bukás**, új pollteszt helyes kóddal **3 siker** | Konkrét viselkedési megkülönböztetés; az X2 másodlagos hibája nyíltan jelezve |

A K2 mellett a review-kör egy részében más helyi ellenőrzések is futottak. Ebből nem vezetem le a pufferhiba gyökérokát; a TIME_WAIT-hipotézist sem igazolja ez a mérés. Nem futtattam újra az egész 289-es kört, csak az érintett 17-es fájlt; a teljes helyi futást továbbra is hibásként adom át.

A PR státuszát **GitHubon, `gh pr view 176`-tal** ellenőriztem. A review elején a két fő job még futott, később mind a **hat check SUCCESS** lett: push és pull_request eseményenként Typecheck/test/build, Scripts/Dockerfile/units, Secret scan. A PR továbbra is nyitott, HEAD `eb76773`. [PR-es CI-futás](https://github.com/minuszka/devnet.deftrack/actions/runs/34785556374), [push CI-futás](https://github.com/minuszka/devnet.deftrack/actions/runs/34785540977), [mentett API-eredmény](review-2026-09-14/github-pr176.json).

**Laborfutam: 0.** A K3 8 kihagyott esete a Mongo nélküli tartalék párdarab, nem nyolc kihagyott labor-elfogadás. A UI-mock, a valódi HTTP/Mongo és a tényleges Core/labor három külön bizonyítékszint marad. Friss klónos `npm ci`-t helyben nem végeztem; a GitHub workflow külön tiszta telepítést használ.

## 7. Nyitott tételek és deploy-besorolás

| Tétel | Frissített döntés |
|---|---|
| W1, W4, V4 | **Lezárható a kód-/webes tesztkövetelményekre.** |
| W3 | **A működési hiba lezárható.** A teszt cleanupja külön X2/P3. |
| W2 | **Részben nyitott, X1/P2.** A privát admin teljes session-kezelési elfogadásához még javítandó. |
| Régi pollteszt | **Lezárható.** A J7 3/3 mérése helyesnek bizonyult; a szigorítás a konstrukciót javítja. |
| ERR_NO_BUFFER_SPACE | **Nyitott, most ismét mérve.** A handover besorolása helyes, a környezeti tünet nem megszűnt. A trace-ben most nem main.ts, hanem dd-page-rounds.ts érintett. |
| Harness teardown | A held-kérés megszakítási primitívjére most van külön sikeres C4. A teljes fixture-életciklus hiánytalan bizonyítására ezt nem általánosítom; X2 külön nyitott marad. |
| Nincs élesben a javítás | Hátralévő kiadási feladat; most sem deployoltam, és a VPS SHA-ját nem mértem újra. |
| Valódi labor/Core/lease/lock elfogadás nincs | **Live szimulátor engedélyezésének és üzemi elfogadásának blokkolója.** Nem váltható ki a zöld UI- vagy HTTP/Mongo kapuval. |
| CSP report-only, elfogadott qs-maradék | A J7 nem változtatja meg ezt a korábbi üzemeltetési/függőségi döntést. A buildelt CSP zöld, a GitHub audit-kapu is sikeres; helyben új npm auditot ebben a körben nem futtattam. |
| Bundle, mobilfejléc, admin scroll-jelzés, profilnév nélküli DTO, proTxHash backlog | Nem találtam a J7 diffben okot blokkolóvá minősítésre. |

**Deploy-vélemény:** nincs igazolt új P1 alkalmazásregresszió, a megfigyelő webfelület V4 maradékai lezárultak. Feltétel nélküli admin-elfogadást X1 javítása előtt nem adok. X2 nem runtime deploy-blokkoló. A csak megfigyelő webfelület kiadása nem azonos a live szimulátor engedélyezésével; utóbbihoz továbbra is valódi laborbizonyíték szükséges. A helyi teljes K2 hibáját a kiadási jegyzőkönyvben a sikeres GitHub CI és a célzott újrafuttatás mellett is meg kell őrizni.

## 8. Átadott fájlok és futtatás

A [review könyvtár](review-2026-09-14/) UTF-8 naplókat, két külön hibajegyet, a saját ellenpróbákat, a kontrollmásolatok generátorát és az olvasási Vite-overlay-t tartalmazza. **Minden saját Playwright-kimenet a `docs/review-2026-09-14/artifacts/` alatt van**, nem a `client/test-results/` alatt. Az artifacts és a generált kontrollmásolatok helyben megmaradnak, `.gitignore` kizárja őket a véletlen commitból.

```powershell
$env:CI='1'
$env:REVIEW_MUTATION='none'
$env:DEVNET_E2E_PORT='5494'
$env:REVIEW_MODE='probes'
npx playwright test --config docs/review-2026-09-14/playwright.config.ts
# Korábbi ellenpróbák: 5 zöld.
$env:REVIEW_MODE='extra'
npx playwright test --config docs/review-2026-09-14/playwright.config.ts
# X1: 2 piros; C3/C4: 2 zöld.
```

A kontrollokhoz előbb `node docs/review-2026-09-14/prepare-controls.mjs`; a configban a `baseline`, `harness`, `debt-old`, `debt-new` módok olvashatók. `REVIEW_MUTATION=baseline` csak a három érintett komponenst szolgálja a 72fec82-ből; `revision` csak a revision-őrt kapcsolja ki a kiszolgált másolatban; `none` a vizsgált kód. A mód/mutáció szerint külön artifact-könyvtár készül.

Alkalmazásjavítás, commit, push, merge, éles módosítás, wallet-művelet vagy fault nem történt. Az öt már meglévő követetlen `ops/c2-*.sh` fájlt nem érintettem. A review a kijelölt SHA-t vizsgálta; csak saját dokumentációt és reprodukciót írt.
