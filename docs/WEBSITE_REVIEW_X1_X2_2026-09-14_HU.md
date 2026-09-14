# Negyedik, célzott független review — X1 és X2, PR #176

**Dátum:** 2026-09-14. **Alap:** `eb767738f022277ad984275fe53e527e78707261`. **Vizsgált commit:** `458b6d0ece1c86b78ea0c556c65a411eae76b24c`.

## 1. Megmaradt vagy új hibák

**A célzott review-ban új vagy megmaradt, hibajegyet igénylő működési hibát nem igazoltam. X1 és X2 lezárható a kód- és tesztelfogadási feltételekre.** Új hibajegy nem készült. A két J8-ban leírt mellékhatást külön is megmértem, és elfogadhatónak minősítem; az indoklás lent olvasható.

Ez nem valódi laborfutam-elfogadás, és nem végrehajtott kiadás. A teljes K2 eredményét a futtatási táblázat külön közli; a korábbi környezeti hibák történetét nem írja át.

## 2. Pontosan melyik fát vizsgáltam

A megadott fő munkakönyvtár a review kezdetén **`main@72fec82`** volt. A PR #176 viszont a kért `458b6d0`-n állt, nyitott állapotban. A fő munkafát nem váltottam át és nem írtam felül.

Külön, detached review-worktree készült: **`D:\www\deftrack-review-458b6d0`**. Minden alkalmazásvizsgálat és kapu ebből a commitból futott. A már telepített gyökér `node_modules` könyvtárat junctionön keresztül használtam; új függőségtelepítést nem végeztem. A vizsgált javító diff sem manifestet, sem lockfile-t, sem szerverkódot nem módosít. A K1 a shared csomagot is buildelte.

A saját dokumentumok, UTF-8 naplók és Playwright-kimenetek a fő repó **`docs/review-2026-09-14-x1-x2/`** könyvtárába kerültek. A trace-ek az itteni `artifacts/` alatt vannak; nem a kliens következő futás által kiürített eredménykönyvtárában.

A korábbi archiválás ellenőrzése: a megadott `D:\www\devnet .deftrack-review-artefacts\2026-09-14\SHA256SUMS` fájl SHA-256 értéke **egyezik** a közölt `f27855033ef9c19ab0e9f6752221822e93df6f6e3a7724c534af89e05c47cf8c` értékkel. Ez a manifest hash-ének ellenőrzése; nem állítom, hogy minden régi artifactot külön újrahash-eltem.

## 3. X1 — lezárva

**Kód:** `client/src/components/dd-admin-shell.ts:595–638`, különösen `:605–621`.

A terv és a history `Promise.allSettled` eredményei a recovery már eleve tipizált eredménye mellett megmaradnak. A döntés sorrendje helyes:

1. A betöltés még az aktuális kiválasztási generációhoz tartozik-e?
2. Van-e 401 a terv/history hibái között, vagy session-lejárat a recovery eredményében?
3. Csak ezután válik az eset nem-401 olvasási hibává vagy sikeres betöltéssé.

Így egy korábbi 503 nem tudja eltüntetni a későbbi 401-et, és a recovery korábban beérkezett 401-e sem veszhet el a társkérés későbbi hibája miatt.

| Elfogadási feltétel | Bizonyíték |
|---|---|
| Saját X1 history-503 és dry-run-503 próbák | A korábbi `docs/review-2026-09-14/extra.spec.ts` két X1 esete sikeres a javított fán. A válaszok sorrendjét gate és a törzs elolvasása szabályozza. |
| 401 előbb / társhiba később | `run-status.spec.ts:1186` nyolcesetes mátrixa: négy releváns hiba-/401-pár, mindkét érkezési sorrendben. A javítás előtti shell-lel pontosan a várt hat eset bukott, kettő sikeres maradt. |
| Kezdeti history-, dry-run-, recovery-401 | A mátrix mindhárom 401-forrást érinti; a korábbi önálló dry-run-401 és recovery-401 tesztek is a rendes kapuban maradtak. |
| Elhagyott futam késői 401-e, terv nélküli B | Saját C3 sikeres; a rendes kapuban `run-status.spec.ts:1252` külön ellenőrzi az A→B váltást a terv olvasási hibája előtt és után. |
| Nem-401 olvasási hiba és abort megőrzése | `run-status.spec.ts:1223` a history önálló hibáját és az abortot méri. A korábbi V1 tervhiba-esetek és az új saját mellékhatáspróba is megőrzi a pollból ismert futam abortját. |
| Nincs kezeletlen rejection | A nyolcesetes mátrix minden esete figyeli a `pageerror` eseményeket. A Promise-ok hibái kezelt eredménybe vagy a hívó catch ágába kerülnek; a saját X1 próbák is ellenőrzik az üres pageerror-listát. |
| Újraolvasás csak GET | Az ezt mérő `run-status.spec.ts:962` és a 401-es újraolvasást mérő `:1089` megmaradt; az X1 nem változtatott a gomb eseményén, endpointjain vagy a refresh végrehajtási útján. |

### A catch-ágból kivett 401-kezelés

**A jelenlegi végrehajtási útvonalon valóban elérhetetlenné vált.** A `_loadHistory()` a két lehetséges továbbdobás előtt megvizsgálja ugyanazokat a rejection okokat `endsSession`-nel (`:615–621`). Ha valamelyik 401, sessiont zár és visszatér. Ha a kiválasztás már elavult, még ez előtt visszatér. A recovery-401 külön eredményként ugyanitt lezárja a sessiont, nem továbbdobásként érkezik.

A `_loadSelectedRun()` catch ágába ezért a mostani kódból csak a már nem-401-nek minősített terv/history hiba jut. Az API request függvénye async; a kérések elutasításait a fenti gyűjtés kezeli. A törölt ág megtartása nem adna további védelmet ezen az útvonalon. Ez a jelenlegi szerkezetre vonatkozó megállapítás, nem általános engedmény arra, hogy később új API-olvasásból érkező 401-et el lehessen nyelni.

### J8 mellékhatás (a): a hibaüzenet később jelenik meg

**Elfogadható, nem nyitok rá hibajegyet.** Az összetartozó betöltés eredménye csak az utolsó olvasás lezárulásakor dönthető el teljesen; addig a nézet betöltést jelez. Ez nem igazol azonnali, első válasznál történő session-lezárást: a döntés most a teljes olvasáscsoportra vár.

Saját új próba: a terv már 503-at adott, az első recovery olvasást visszatartottam. A státuszpoll közben megadja az aktív futamot. **Az abort engedélyezett, a terv helye még „still being read”;** a recovery elengedése után **„could not be read”** jelenik meg, az abort továbbra is engedélyezett. A működés nem tünteti el az ismert futam menekülési vezérlőjét. Ez végesen késleltetett olvasásra adott bizonyíték, nem új hálózati határidő/timeout-garancia.

### J8 mellékhatás (b): két nem-401 hibánál a terv hibája nyer

**Elfogadható, nem nyitok rá hibajegyet.** A terv és history egy betöltés része; a felület ennek sikertelenségét jelzi, és egy determinisztikusan választott okot ad. Nem ígéri az összes párhuzamos diagnosztikai hiba felsorolását.

A hiányzó mérési bizonyítékot most két saját ellenpróbával pótoltam: **terv-503 előbb / history-503 később**, illetve fordítva. Mindkettőben a terv `plan-error-sentinel` üzenete jelenik meg, a session megmarad. A [mellékhatáspróbák](review-2026-09-14-x1-x2/effects.spec.ts) eredménye **3/3 zöld**. A rendes CI-kapuba ezek ebben a review-ban nem kerültek be, mert alkalmazás-/meglévő tesztmódosítást nem végeztem.

## 4. X2 — lezárva

**Kód:** `client/e2e/harness.spec.ts:164–177` és `:213–225`.

Az első teszt a release után **azonnal elmenti** a törzs pillanatnyi értékét, majd `finally`-ban megvárja az `allow` timeres művelet rendezését, és csak azután állít a korábban elmentett értéken. Így a hibás harness korai visszatérését nem tünteti el az utólagos várakozás, de a teszt lezárása sem fut a timer elé.

A második teszt sem gyengült: a `bodies` értékét az első release után menti el, és a második release rendezése után **ezen a mentett értéken** állít. A `page.evaluate()` eredménye a tesztfolyamatba átvitt pillanatkép, nem a lap később frissülő objektumára mutató élő referencia. A második válasz rendezése tehát nem töltheti ki utólag a már megfigyelt hiányzó első törzset.

**Saját negatív kontroll:** a jelenlegi két öntesztet a régi, `72fec82` URL-számlálós harnessével futtattam. Mindkettő **Expected n=1 / Received undefined** miatt bukott. A teljes kontrollnaplóban nincs „Target page, context or browser has been closed”, `UnhandledPromiseRejection` vagy kezeletlen rejection. Nem timeout volt az elsődleges hiba. [Napló](review-2026-09-14-x1-x2/harness.txt).

A helyes harness a saját korábbi W3 ellenpróbát is teljesíti. A két rendes önteszt a teljes K2 része; a nyers JSON/törzs, a státusz és a response-id működését az X2 nem módosítja. A CSP-kapu is sikeres maradt.

## 5. Saját negatív kontrollok

A kontrollokhoz **nem írtam át alkalmazásfájlt**. Az X1 esetében egy read-only Vite load plugin szolgálta az `eb76773` shell-forrását, a tesztek és a harness a vizsgált állapotból maradtak. Az X2 esetében a régi harness és az új öntesztek importútvonalaiban igazított másolatok készültek a review `generated/` könyvtárába.

| Kontroll | Eredmény | Értelmezés |
|---|---|---|
| Új X1 mátrix + `eb76773` shell | **6 piros, 2 zöld** | Recovery-401 mindkét társhibával és mindkét sorrendben: négy bukás. History-/dry-run-401, amikor a társ 503 érkezik előbb: további kettő. Ha e két 401 érkezik előbb, a régi catch már lezárta a sessiont: két siker. Pontosan reprodukálja a J8 állítását. |
| Új W3 öntesztek + régi URL-számlálós harness | **2 piros** | Mindkettő korai visszatérésből eredő `undefined`, cleanup-hiba nélkül. |

Nem állítom, hogy a J8 minden egyes őrt külön eltávolító történelmi kontrollját újrafuttattam. A fenti két saját kontrollcsoport az X1 konkrét hibamátrixát és az X2 javított hibás ágát önállóan megkülönbözteti.

## 6. Kapuk és CI

| Futtatás | Eredmény | Bizonyíték típusa |
|---|---|---|
| K1 | shared build, typecheck, **864 + 203 = 1067 unit**, teljes build: exit 0 | Elkülönített, kijelölt commitból épülő kliens/szerver; meglévő függőségekkel |
| K2 | **299/299**, exit 0, első futásra, 5,9 perc | Valódi böngésző, szintetikus API-válaszok, egy worker, nincs retry |
| K3 | **98 sikeres, 8 kihagyott**, 15 fájl, exit 0 | Valódi HTTP/Mongo integráció, kizárólag `mongodb://127.0.0.1:27018` |
| CSP | **4/4**, exit 0 | Aktuálisan buildelt kliens, policy-negatív kontrollal |
| Korábbi W1–W4 és C2 | **5/5**, exit 0 | Saját korábbi ellenpróbák változtatás nélkül |
| X1 ×2, C3, C4 | **4/4**, exit 0 | Saját újabb ellenpróbák változtatás nélkül |
| J8 mellékhatások | **3/3**, exit 0 | Üzenetkésés + abort, kettős 503 két sorrendben |
| X1 baseline-kontroll | **6 elvárt bukás + 2 siker** | A J8 által előre jelzett különbség |
| X2 harness-kontroll | **2 elvárt bukás** | Korai visszatérés, másodlagos cleanup-hiba nélkül |

A K3 saját generált, eldobható tesztadatbázisokat használ; a `deftrack_devnet` nem volt tesztcél. A nyolc kihagyott eset az adatbázis nélküli tartalék ág, nem nyolc kihagyott laborfutam. **Valódi laborfutam: 0.** A UI-fixture és a HTTP/Mongo bizonyíték továbbra sem igazolja egy tényleges Core/fault/lease/lock/recovery futam működését.

A [PR #176](https://github.com/minuszka/devnet.deftrack/pull/176) ellenőrzött HEAD-je `458b6d0`; a review alatt **OPEN**, nincs merge-commit. **Mind a hat GitHub CI-check SUCCESS:** push és pull_request eseményenként Typecheck/test/build, Scripts/Dockerfile/units és Secret scan. [PR-es CI](https://github.com/minuszka/devnet.deftrack/actions/runs/34790343755), [push CI](https://github.com/minuszka/devnet.deftrack/actions/runs/34790342240), [mentett API-eredmény](review-2026-09-14-x1-x2/github-pr176.json).

A mai teljes K2-ben nem volt bukott teszt vagy ERR_NO_BUFFER_SPACE-re utaló hibakimenet. Így most nincs ilyen bukáshoz tartozó trace-erőforrás, amelyet meg lehetne nevezni. A korábbi körök dokumentált erőforráshibáit ez nem cáfolja.

## 7. Elfogadás és határok

**X1 és X2 kód-/tesztlezárását elfogadom.** Ezzel a célzott review-sorozat ezen két maradéka nem ad további kiadást blokkoló hibajegyet. A korábbi V4/W1/W4 lezárását a javító diff nem nyitotta újra. A kiadás üzemeltetési lépéseit és az aktuális VPS-állapotot ebben a körben nem ellenőriztem újra.

A valódi labor-elfogadás hiánya változatlanul **a live szimulátor üzemi engedélyezésének korlátja**. A megfigyelő webfelület kódelfogadása nem jelent laborengedélyezést. A korábbi ERR_NO_BUFFER_SPACE környezeti hibatörténetet egy új sikeres futás sem törli; annak gyökérokáról itt nem teszek új állítást.

## 8. Reprodukció és fájlok

A megőrzött review-worktree: `D:\www\deftrack-review-458b6d0`. A tesztconfig erre a pontos helyi fára mutat. Ha ezt a worktree-t később eltávolítják, ugyanitt a `458b6d0` commitból kell újra létrehozni vagy a configban átállítani az útvonalát.

Parancsok a fő repó gyökeréből:

```powershell
$env:CI='1'
$env:DEVNET_E2E_PORT='5594'
$env:REVIEW_MODE='old'       # korábbi 5 ellenpróba
npx playwright test --config docs/review-2026-09-14-x1-x2/playwright.config.ts
$env:REVIEW_MODE='extra'     # X1, C3, C4: 4 eset
npx playwright test --config docs/review-2026-09-14-x1-x2/playwright.config.ts
$env:REVIEW_MODE='effects'   # a két mellékhatás: 3 eset
npx playwright test --config docs/review-2026-09-14-x1-x2/playwright.config.ts
node docs/review-2026-09-14-x1-x2/prepare-controls.mjs
$env:REVIEW_MODE='harness'   # szándékos régi harness: 2 piros
npx playwright test --config docs/review-2026-09-14-x1-x2/playwright.config.ts
$env:REVIEW_MODE='baseline'  # szándékos eb76773 shell: 6 piros, 2 zöld
npx playwright test --config docs/review-2026-09-14-x1-x2/playwright.config.ts
```

A K1 parancsai a review-worktree-ben: `npm run build -w shared`, `npm run typecheck`, `npm test`, `npm run build`. K2: `CI=1`, `DEVNET_E2E_PORT=5593`, `npm run test:e2e -w client -- --output "D:/www/devnet .deftrack/docs/review-2026-09-14-x1-x2/artifacts/k2" --reporter=list`. K3: `MONGODB_TEST_URI=mongodb://127.0.0.1:27018`, `npm run test:integration`. CSP: `npm run test:csp -w client -- --output "D:/www/devnet .deftrack/docs/review-2026-09-14-x1-x2/artifacts/csp" --reporter=list`.

A [mellékletkönyvtár](review-2026-09-14-x1-x2/) tartalmazza a UTF-8 naplókat, a configot, a read-only overlay-t, a kontrollgenerátort és a mellékhatások specjét. Az artifacts/generated könyvtárak helyben megmaradnak, de a `.gitignore` kizárja őket a véletlen commitból.

Nem történt alkalmazáskód-módosítás, commit, push, merge, deploy, VPS-írás, wallet-művelet vagy fault. Az `ops/c2-*.sh` fájlokhoz nem nyúltam. A review-worktree alkalmazásforrása változatlan, a fő munkafa ágát és forrását nem módosítottam.
