# devnet.deftrack.xyz – weboldal- és szimulátoraudit

Dátum: 2026-09-11. Vizsgált oldal: https://devnet.deftrack.xyz/.
Explorer checkout: `bfe7357`. Core referencia: WSL Ubuntu `/home/stejn/DEFCON`, `f572a7fd8b`.

## Értékelés és hatókör

Az explorer műszaki alapja jó: sok lényeges domain-szabály tesztelt, a publikus és admin API elkülönül, a publikus hostadatok maszkoltak, a főoldal már külön kezeli a ChainLock-aláíró profilt. A professzionális használat legnagyobb akadálya jelenleg az adatok értelmezhetősége és frissességének jelzése, a listák teljessége és a szimulátor kezelhetősége. Nem teljes újratervezés kell, hanem ezek rendezése egy következetes felületen.

Elvégzett ellenőrzés:

- Élő, kizárólag olvasó HTTP/API-lekérések a publikus funkciókhoz; anonim adminhozzáférés ellenőrzése.
- A kliens útvonalkezelésének, oldalainak, stílusainak, admin- és szimulátorvezérlésének forrásvizsgálata; kapcsolódó szerverroute-ok és adatfeldolgozás célzott ellenőrzése.
- `npm run typecheck`: sikeres mindhárom workspace-ben.
- `npm test`: **820 szerveroldali + 80 kliensoldali teszt sikeres**, 98 tesztfájl.
- `npm run build`: sikeres.
- Az élő `index-C3vfIDvO.js`, `dd-shell-NJw7Ue5L.js`, `dd-admin-shell-Bhf_iHre.js` bájtra azonos a helyi builddel. Ez a kliensre bizonyított egyezés; a teljes futó szerverforrás azonosságát nem bizonyítja.
- `npm audit --json`: 3 moderate érintett csomag, 0 high, 0 critical; javítás elérhető.
- Hibás URL-ek reprodukálása a tényleges routerfüggvénnyel; szimulátor-alapértékek ellenőrzése a tényleges szerveroldali sémával; veszélygomb színkontrasztjának számítása.
- A megadott Core-forrás elérhető; Q60 és regtest profilok célzott visszaellenőrzése megtörtént.

Korlátok: nem volt csatlakoztatott böngésző, ezért nincs friss képernyőkép, kattintásos/mobil/billentyűzetes vizsgálat vagy Lighthouse-mérés. A megjelenési javaslatok kódalapúak. A szimulátort nem indítottam el, és az adatbázisos integrációs teszteket nem futtattam. Ez nem teljes Core-konszenzus- vagy behatolási audit. Az alkalmazáskódot, a walletet és az élő szolgáltatásokat nem módosítottam.

A korábbi `AUDIT_2026-09-05_HU.md` hasznos előzmény, de a régi hibajegyzék nem tekinthető automatikusan aktuálisnak. Több ott jelzett hiányosság javítása már látható a mostani kódban.

## Ellenőrzött hibák és javítási sorrend

P1: a megbízható üzemeltetéshez vagy a szimulátor bekötése előtt szükséges. P2: következő javítási kör. P3: finomítás.

### F01 · P1 · A szimulátor futó tesztjének vezérlése elveszhet

**Bizonyíték:** `client/src/components/dd-simulation-control.ts:91,146,158,258`; `dd-admin-shell.ts:308,330,438`.

A vezérelt futam kizárólag a komponens `_prepared` memóriájában él. Oldalfrissítéskor ez null lesz. A futamlistából történő kiválasztás csak az auditidővonalat tölti be; nem adja vissza a futamot a vezérlőpanelnek. Még a scenario/mód/paraméter mezők szerkesztése is törli `_prepared` értékét. A mezők csak kérés közben tiltottak, futó teszt mellett nem.

**Következmény:** egy később bekötött élő futamnál a felhasználó elveszítheti az adott futam Abort & recover gombját. A backend és a hostoldali automatikus helyreállítás ettől még működhet; a hiba a böngészős hozzáférés elvesztése, nem bizonyított recovery-hiba.

**Javítás:** az aktív futam kiválasztása és betöltése legyen szerverállapotból helyreállítható. A kiválasztott `runKey` kerülhet az URL-be; titkok ne kerüljenek oda. Legyen a draftkészítőtől független aktív-futam panel állandó abort/recovery műveletekkel.

**Elfogadás:** elindított laborfutam után F5, lapbezárás/újranyitás és másik futam kiválasztása mellett is elérhető ugyanannak a futamnak a vezérlése.

### F02 · P1 · A szimulátor állapotkijelzése nem követi a szervert

**Bizonyíték:** `dd-simulation-control.ts:146,212,229,248,265,282,299`; `dd-admin-shell.ts:438`.

A panel másodpercenként csak a helyi órát frissíti. A `_prepared.run` állapotot kizárólag a felhasználó saját műveleteinek válaszai írják át. Az admin dashboard külön frissíti a listát és az idővonalat, de ezt nem továbbítja a vezérlőpanelnek.

**Következmény:** a lista már recovery/completed állapotot mutathat, miközben a panel még egy korábbi állapotot és lejáró lease-t jelez. Ez automatizált szimulációnál megtévesztő.

**Javítás:** közös, szerverről frissülő futamállapot pollinggal vagy eseményfolyammal; utolsó sikeres frissítés és kapcsolatvesztés kijelzése. A gombok engedélyezése is ebből az állapotból történjen.

**Elfogadás:** szerveroldali automatikus állapotváltás külön kattintás nélkül megjelenik, az eltérő panelek ugyanazt az állapotverziót mutatják.

### F03 · P1 · A fejléc régi adatot továbbra is élőnek mutathat

**Bizonyíték:** `client/src/components/dd-shell.ts:236` és `:251`; az Overview is feltétel nélkül írja a „live · refreshes every 30 s” szöveget (`dd-page-overview.ts:481`).

A health-kérés hibáját a fejléc elnyeli, és megtartja a régi adatokat. Nincs utolsó sikeres frissítési idő vagy stale/offline állapot. Első betöltési hiba után a fejléc skeletonja tartósan megmaradhat. Egy adatokat vizsgáló eszközben a hálózat pillanatnyi egészsége és a megfigyelés elérhetősége külön fogalom.

**Javítás:** `Frissítve: …`, adatkor és külön friss/stale/offline állapot. A legutolsó számok maradhatnak, de elavultságuk legyen egyértelmű. Az API hibajelző `-1` értékeit se jelenítse meg valós hálózati darabszámként.

**Elfogadás:** a health-végpont elérhetetlensége után a korábbi „ok” legkésőbb két frissítési cikluson belül elavultként látszik.

### F04 · P2 · A kísérletlista elrejti a régebbi rekordokat – élőben igazolt

**Bizonyíték:** `dd-page-experiments.ts:110`; `server/src/routes/v1/experiments.v1.routes.ts:23`.

Az élő `/api/v1/experiments` válasza **34 összes rekordot, 25 visszaadott elemet** tartalmazott. A kliens csak az `items` mezőt használja; nincs lapozás és összes darabszám. Így 9 régebbi kísérlet nem érhető el a listából, bár közvetlen URL-lel továbbra is elérhető lehet.

**Javítás:** szerveroldali lapozás, „1–25 / 34” számláló, státusz- és szövegszűrés. Betöltés alatt ne a „No experiment recorded yet” üres állapot jelenjen meg.

**Elfogadás:** a 34. rekord is elérhető a felületről, és a betöltés/hiba/üres találat külön állapot.

### F05 · P2 · A Fairness profilokat kever, a felület nem mondja meg, melyikről beszél

**Bizonyíték:** `client/src/lib/api.ts` → `selectionFairness`; `dd-page-fairness.ts:72`; `server/src/routes/v1/fairness.v1.routes.ts:16,42,86`.

A szerver támogatja az `llmqName` szűrőt, de a kliens nem küldi és nincs profilválasztó. A 20 körös élő mintában az összesített várható kiválasztás **43,09%**, a kizárólag `llmq_defcon` profilra számított érték **39,47%** volt. Mindkét szám értelmezhető a saját mintájára, de a képernyő nem teszi egyértelművé az összesített nézetet, és nem ad hozzáférést a Q60-hoz önállóan.

**Javítás:** alapértelmezett aktuális profil, látható profilnév és választható összesítés. A mintaszám és a vizsgált magasságintervallum mindig maradjon mellette.

**Elfogadás:** a kiválasztott profil URL-lel megosztható; a kijelzett adat kizárólag annak köréből készül.

### F06 · P2 · A Fairness hosttáblája mást számol, mint amit az oszlop neve ígér

**Bizonyíték:** `server/src/domain/selectionFairness.ts:178,191`; `dd-page-fairness.ts` „By host / Masternodes” oszlop.

A `nodes` szám csak a mintában legalább egyszer kiválasztott node-okat tartalmazza. Az élő ellenőrzéskor a `host-e05a397b22` a masternode-listában **7**, a Fairness „Masternodes” oszlopában **5** node-ot mutatott. A másik kettő nem eltűnt, csak nem választották ki.

**Javítás:** külön `Registered/eligible nodes` és `Selected nodes` oszlop; a teljes hostlétszám a registryből, a kiválasztottak száma a mintából származzon.

**Elfogadás:** egy ismert 7 node-os host 5 kiválasztott node mellett 7 / 5 értékeket mutat, és nem állítja, hogy csak 5 node-ja van.

### F07 · P2 · Hibásan kódolt URL megakaszthatja az oldal inicializálását

**Bizonyíték:** `client/src/lib/router.ts:84`; `dd-shell.ts:30`.

A `decodeURIComponent` nincs hibakezelésben. A tényleges routerfüggvénnyel végzett reprodukcióban `/round/%` és `/tx/%E0%A4%A` egyaránt `URIError: URI malformed` kivételt dobott. A shell már a példányosításkor meghívja ezt a függvényt.

**Javítás:** védett dekódolás és kontrollált hibás-link oldal, visszalépési/keresési lehetőséggel.

**Elfogadás:** hibás escape-szekvencia sem szakítja meg a shell létrehozását; szabályos részletoldalak változatlanul működnek.

### F08 · P2 · Ismeretlen útvonalra észrevétlenül a főoldal jelenik meg

**Bizonyíték:** `client/src/lib/router.ts:89`; élő GET `/audit-nonexistent-20260911` → 200, SPA HTML; helyi routereredmény → Overview.

A szerver SPA fallbackje önmagában szokásos, de a kliens sem jelez nem található oldalt. Hibás vagy elavult link után a felhasználó nem érti, miért a főoldalra jutott.

**Javítás:** explicit Not found nézet, megőrzött URL-lel és hasznos visszautakkal. Szükség esetén szerveroldali 404-kezelés az ismert útvonalminták alapján.

### F09 · P2 · A DSL-szimuláció alapértékei érvénytelenek

**Bizonyíték:** `dd-simulation-control.ts:23,180`; `server/src/simulator/scenarioRegistry.ts:189`.

A szerver kínál `dsl-fault` forgatókönyvet, a kliens alapértéktáblája viszont nem. Kiválasztáskor `{}` kerül a JSON-mezőbe. A tényleges sémával ellenőrizve hiányzik a kötelező `faultKind`, `count` és `epochs`.

**Javítás:** érvényes alapérték, például `{"faultKind":"response-drop","count":1,"epochs":1}`; hosszabb távon a scenario-sémából generált mezők és minták. A host/target placeholder is valódi regisztrált célpontválasztóra cserélendő.

**Elfogadás:** minden felkínált scenario alapértéke átmegy a saját paramétersémáján; a tényleges célpontok és preflight ettől még külön ellenőrizendők.

### F10 · P2 · Az oldal HTML-válaszán hiányzik a CSP és a HSTS fejléc

**Bizonyíték:** élő `/`, `/rounds`, `/admin` válaszok: nincs `Content-Security-Policy` és `Strict-Transport-Security`; `/api/v1/health` válaszán mindkettő jelen van. `X-Frame-Options: DENY` és `X-Content-Type-Options: nosniff` a HTML-en is megvan.

Az Express Helmet beállítása nem kerül automatikusan a nginx által kiszolgált HTML-re. Az API válaszának CSP-je nem védi az oldal dokumentumát. Az API későbbi HSTS-válasza sem egyenértékű azzal, hogy a HTML belépési pont is következetesen küldi.

**Javítás:** a HTML/statikus kiszolgálásnál is beállított fejlécek; CSP bevezetése előbb report-only módban, a Lit stílusok és dinamikus importok ellenőrzésével. Ne kerüljön fel vakon egy a felületet eltörő szabályzat.

**Besorolás:** védelmi hiányosság, nem igazolt XSS vagy feltört hozzáférés.

### F11 · P2 · A szűrt nézetek nem oszthatók meg megbízhatóan

**Bizonyíték:** `dd-page-rounds.ts` `_status`, `_llmq`, `_offset`; a többi időablak-választó is komponensállapotot használ. Nincs ezeket helyreállító queryparaméter-kezelés.

Egy probléma kivizsgálásakor kiválasztott profil, státusz, időablak és oldalszám elvész frissítéskor vagy a link továbbadásakor.

**Javítás:** például `/rounds?llmq=llmq_defcon&status=failed&page=2`; állapotvisszaállítás Back/Forward és újratöltés esetén. A megosztott link a vizsgálati kontextust is vigye.

### F12 · P2 · Hiányos szemantikus oldalcímek és fókuszkezelés

**Bizonyíték:** a publikus oldalak fő címei `<div class="page-title">` elemek. A shell navigációnál görget és dokumentumcímet állít, de nem helyezi a fókuszt az új oldal címére.

Ez főleg billentyűzetes és képernyőolvasós navigációnál fontos. Pozitívum: már vannak fókuszgyűrűk, táblázat-captionök, `scope` attribútumok és csökkentett mozgásra reagáló stílusok.

**Javítás:** oldalonként szemantikus `h1`, szekcióknál `h2`, tartalomra ugrás és tudatos SPA-fókuszkezelés. A szimulátor target táblájának captionje jelenleg a table-n kívül van (`dd-simulation-control.ts:379`), azt is át kell helyezni.

### F13 · P2 · Három moderate függőségi találat maradt

**Bizonyíték:** az audit során futtatott `npm audit --json`: `qs`, `body-parser`, `express`; `fixAvailable: true`. A qs-hez két advisory kapcsolódik:

- https://github.com/advisories/GHSA-x5fp-wj9c-mxmx
- https://github.com/advisories/GHSA-4mjr-xmp4-gh2g

A szerver már `simple` query parsert használ és JSON bodyt fogad, ezért a találat önmagában nem bizonyítja, hogy ezeken a publikus útvonalakon kihasználható a probléma. A függőségi tartozás ettől még fennáll.

**Javítás:** célzott, lockfile-ban rögzített frissítés, majd build és releváns tesztek; automatikus frissítési PR-ek. Az audit alatt csomagverziót nem változtattam.

### F14 · P3 · A veszélygomb kontrasztját nem fedi a meglévő palettateszt

**Bizonyíték:** `dd-simulation-control.ts:132`: fehér szöveg, sötét témában `#e66767` háttér. Számított kontraszt: **3,23:1**. A palettateszt az alapszíneket vizsgálja a felületszíneken, ezt a fordított gombkombinációt nem.

**Javítás:** megfelelően sötét gombháttér fehér felirattal vagy sötét felirat a jelenlegi háttéren; a tényleges gombpárosítások ellenőrzése is kerüljön be. Ez számított színellenőrzés, nem teljes akadálymentességi tanúsítás.

## Szimulátor: mi van készen, és mi szükséges a bekötéshez?

A publikus `/api/v1/simulations` az auditkor 0 futamot adott. Az `/experiments` külön adatmodell, 34 kísérlettel. A publikus router és API-kliens jelenleg nem ad külön szimulációs eredményoldalt. Ezt a felhasználó által jelzett, még el nem készült bekötés részeként kezelem.

A háttérben létezik scenario-registry, paramétervalidálás, előellenőrzés, auditnapló, perzisztens futamállapot, live lock, mérési és recovery réteg. A vezérlő API a live módot jelenleg **regtestre korlátozza**. A UI ugyanakkor külön választhatóvá teszi a `devnet` és `live` opciókat, vagyis felkínál olyan kombinációt, amelyet a szerver helyesen elutasít. A megoldás a felület képességalapú tiltása és egyértelmű magyarázata, nem a szerveroldali korlát kivétele.

A bekötés előtt javasolt termékfolyamat:

1. **Környezet:** konkrét hálózat, kapcsolatállapot, Core-verzió/build-azonosító és elérhető műveletek. A leválasztott szimulátor ezt jól láthatóan mondja ki.
2. **Forgatókönyv:** érthető cím, cél és kitöltött mezők. JSON csak választható haladó nézetben.
3. **Hatáselőnézet:** érintett node-ok és hostok, aktuális profil, túlélő tagszám, DKG/signing tartalék, időtartam és automatikus helyreállítás ideje.
4. **Előellenőrzés:** minden blokkoló okhoz konkrét javítási út. A hiányos mérési lefedettség legyen látható.
5. **Futtatás:** az indítás egyértelmű megerősítése után szerverről frissülő lépések: baseline → fault → observation → recovery → cooldown → result.
6. **Eredmény:** várakozás és mérés egymás mellett; siker/eltérés/nem kiértékelhető külön. A „nincs adat” nem jelenthet sikeres tesztet.
7. **Megosztás:** publikus, kitakart eredményoldal, verziózott JSON/CSV exporttal, reprodukcióhoz szükséges konfigurációval és futamazonosítóval.

Legalább a reload/reconnect, dupla start, időtúllépés, automatikus recovery, késő válasz, elégtelen mérési adat és oldalfrissítés után indított abort teljes folyamatát végig kell próbálni izolált laborban. A 900 zöld unit teszt ezt a kattintásos, végponttól végpontig tartó működést nem helyettesíti.

## A Core wallet útvonal szerepe

A `\\wsl$\Ubuntu\home\stejn\DEFCON` elérhető és hasznos **Core-forrásreferencia**. Nem böngészőből beírható walletkapcsolat, és önmagában nem igazolja, hogy az ott buildelt bináris fut a teszthálózaton.

A mostani forrás `src/llmq/params.h` állományában a Q60 `size/minSize/threshold` értéke **60/44/41**, a kis regtest profilé **3/2/2**. Ezek megfelelnek az explorer releváns registry-bejegyzéseinek. Az élő health válasz Core-verzióként **22.1.5**-öt jelentett; ez nem bizonyítja önmagában a WSL commit és a futó bináris azonosságát.

A `coreSimulatorAdapter.ts` jelenleg korábban előállított Core-native eredményekre hivatkozó adapter: nem olvassa a walletet, és nem futtatja újra a valószínűségi modellt. A `modeled` jelölésből ezért a felület ne sugalljon frissen kiszámolt, konkrét hálózatra érvényes előrejelzést.

A helyes integráció a privát végrehajtón keresztül menjen a kijelölt regtest/devnet daemon RPC-jéhez, ellenőrzött hálózatazonossággal, rögzített builddel és külön tesztkörnyezettel. A weboldalnak walletfájlra vagy privát kulcsokra nincs szüksége.

## Hogyan lenne professzionálisabb az oldal?

Az alábbiak tervezési javaslatok a jelenlegi komponensek és stílusok alapján; a végső tördelést böngészőben kell ellenőrizni.

| Terület | Javaslat | Haszon |
|---|---|---|
| Navigáció | A 13 egyenrangú menüpont helyett 4 csoport: Áttekintés; Hálózat; Blokklánc; Kísérletek. A masternode/PoSe/staking/peer részletek csoporton belül. | Könnyebben megtalálható a feladat; mobilon kevesebb vízszintes pásztázás. |
| Főoldal | Első sorban hálózati állapot, adatfrissesség, aktív profil, aktuális incidens/futam. A hosszú módszertani szövegek kinyithatók. | Gyorsan eldönthető, kell-e beavatkozni. |
| Keresés | Globális blokk-magasság / blokkhash / txid / proTxHash / runKey keresés. | Az explorer alapvető vizsgálati útja közvetlen lesz. |
| Fogalmak | Rövid, használható súgó a DKG, PoSe, DSL, HHI, Gini és kvórumküszöb mellé; külön „Hogyan mérjük?” oldal. | Nem kell a forráskódot ismerni a mutatók értelmezéséhez. |
| Táblázatok | Következetes rendezés, szűrés, lapozás, másolásgomb, teljes azonosítók elérése és export. | A felület diagnosztikai munkaeszközként is használható. |
| Mérési eredmények | Profil, minta, megfigyelési ablak, forrás, lefedettség és adatkor az érték mellett. | A szám jelentése nem marad rejtve egy lábjegyzetben. |
| Mobil | Csoportos navigáció, kulcsértékekből álló kártyák, jelzett vízszintes táblagörgetés; 360/390/768 px és 200% zoom ellenőrzése. | Telefonról is követhető egy incidens. |
| Állapotok | Egységes betöltés / üres / hiba / elavult / leválasztott minták, újrapróbálás és frissítési idő. | A hiányzó adat nem tűnik normál nulla értéknek. |
| Szimulátor | Emberi mezők, kész presetek, folyamatos állapotsor, látható aktív futam és visszavehető vezérlés. | A JSON-konfigurátor helyett érthető munkafolyamat. |
| Megosztás | URL-ben tárolt szűrők, futameredmény-permalink és összehasonlítható baseline riport. | Egy hibajegyhez ugyanaz a nézet nyitható meg. |
| Arculati részletek | Kattintható márkanév, saját favicon, egységes státuszcímkék; opcionális témaváltó, mert a light paletta már létezik. | Befejezettebb, következetesebb benyomás. |

Az oldal `noindex` beállítása devnetnél ésszerű, nem javaslom automatikusan eltávolítani. A kis tömörített kliensméret is megtartandó: a publikus shell ~40 kB gzip, a közös modul ~10 kB gzip. A mért HTTP-idők egy része első kapcsolódáskor több másodperc, más válaszok néhány tíz milliszekundum alatt érkeztek; ebből kontrollált böngészős mérés nélkül nem állapítható meg tartós frontend-teljesítményhiba.

## Javasolt munkasorrend

1. **Bizalom és vezérelhetőség:** F01–F03; futam-visszatöltés, szerverállapot követése, elavult adatok jelzése.
2. **Adat- és navigációs hibák:** F04–F09; teljes kísérletlista, korrekt Fairness, robusztus router, érvényes scenario-alapértékek.
3. **Használhatóság és védelem:** F10–F14; HTML-fejlécek, megosztható szűrők, szemantika, függőségek, gombkontraszt.
4. **Szimulátor termékesítése:** strukturált űrlapok, képességállapotok, publikus eredményoldal, ismételhető labor-elfogadási futamok.
5. **Böngészős vizuális ellenőrzés:** asztali/mobil tördelés, billentyűzet, zoom, lassú hálózat és hibás API; ezt a jelen audit nem helyettesíti.

## Egyéb fejlesztői környezeti észrevétel

A kiegészítő próbánál a `node --import tsx` hiányzó `@esbuild/win32-x64` csomag miatt leállt. A router reprodukciót ezután a telepített TypeScript fordítóval, módosítás nélkül elvégeztem. A hiba helyi fejlesztői környezeti probléma, nem az élő oldal hibája; a `tsx`-et használó szerver dev parancs működéséhez rendezendő. A build és a Vitest ettől függetlenül sikeresen lefutott.
