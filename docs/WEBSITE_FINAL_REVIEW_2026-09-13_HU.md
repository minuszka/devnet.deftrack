# Végső független review – a 20 napos weboldaljavítás

**Dátum:** 2026-09-13. **Döntés: javítás szükséges.** A tervezett funkciók implementációja és a normál tesztkapuk jelentős része igazolt. A teljes munkát még nem zárom le: hét megmaradt működési hibához külön ellenpróba készült, köztük egy P1 futamállapot-visszaállás. Ezek nem a tegnapi hét találat egyszerű megismétlései: a korábbi konkrét eseteket javították, de a kapcsolódó folyamatokban további hiányok maradtak.

Alap: `1feca84617b27ebb8048430b3c01022d8b48f19d`. Vizsgált, merge-elt végállapot: **`39e7f80346f8ac7a14e7b82ebdae862c52fb3d16`**, [PR #174](https://github.com/minuszka/devnet.deftrack/pull/174). A review elején a követett munkafa tiszta volt. A baseline–HEAD diff 150 fájl, +23 773 / −495 sor; a tegnap vizsgált `83b8710` utáni webes és J1–J3 javításokra külön figyelmet fordítottam.

A kiindulópontot a kód és a tényleges diff adta. A roadmapot, a végrehajtási naplót, a tegnapi review-t, valamint a végső átadási csomagot ellenőrizendő állításokként kezeltem. A párhuzamos DSL/Core/flotta munka nem lett automatikusan a webes terv hibája.

## 1. Javítandó hibajegyek

| ID | Szint | Tárgy | Eredet / kapcsolat |
|---|---|---|---|
| V1 | **P1** | Későn érkező hydration visszatekeri az újabb futamállapotot | 06–07. nap; a tegnapi R2 elfogadási feltételei között is megnevezett rés |
| V2 | P2 | Azonos futam régi recovery-frissítése felülírja az új bizonyítékot | J2 / R3 javítás további versenyhelyzete |
| V3 | P2 | Sikeres belépés után nem töltődik be azonnal a dashboard és a kiválasztott futam | Baseline-ban is meglévő, fennmaradt hiba; nem újonnan bevezetett regresszió |
| V4 | P2 | Hibás lapváltás után az új oldalszám alatt a régi oldal sorai maradnak | 11. nap / F11; az átadási csomag is megnevezi, továbbra sincs javítva |
| V5 | P2 | Űrlapmező szerkesztése csendben eldobja a hibás Advanced JSON-t | 15–16. nap |
| V6 | P2 | Az export nem különbözteti meg a nem létező és a le nem kérhető riportot | 17. nap |
| V7 | P2 | A kezdeti recovery-olvasás hibája „nincs rögzített bizonyíték” lesz | 06–07. nap / R3; a frissítési ág javítása nem terjedt ki a kezdeti olvasásra |

### V1 — A mentett tervvel visszatérő régi futam felülírja az újabb pollt

**Hely:** `client/src/components/dd-admin-shell.ts:510–524`, különösen `:520`; státusz elfogadása: `:576–586` környéke, `_acceptRun()`.

**Reprodukció:** F5 után még úton van a mentett tervet és egy `armed`, revision 3 futamot hordozó `/dry-run` válasz. Közben az öt másodperces poll `fault_active`, revision 9 állapotot kap. Amikor a hydration megérkezik, a felület ismét **armed** lesz. A V1 teszt szabályozott böngészőórával hozza elő ezt a sorrendet; valódi hálózaton a pollnál lassabb kezdeti betöltés a kiváltó feltétel.

**Ok:** `_loadHistory()` a kiválasztási generációt ellenőrzi, utána közvetlenül írja a `detail.run` objektumot. A futam revision-szabályát ez az út megkerüli. A runKey és a generáció ebben az esetben végig azonos, ezért egyik sem véd.

**Hatás:** nemcsak egy felirat lesz régi: az indítási vezérlő ismét megjelenhet, és a régi objektum `faultMayBeActive` értéke is visszakerülhet. A szerveroldali állapotgép továbbra is külön ellenőriz; a teszt nem bizonyít kettős tényleges indítást, és nem is indít valódi faultot.

**Szűk javítás:** a hydration csak a mentett tervet töltse be feltétlenül, a futamobjektumot ugyanazon revision-ellenőrzéssel egyeztesse, mint a poll és a mutáció. A régi recovery/timeline/preflight se írjon felül frissebb, már elfogadott adatot.

**Elfogadás:** V1 zöld; késői hydration revision 3 + korábbi poll revision 9 után marad revision 9 és `fault_active`; régi Start vezérlő nem tér vissza. Legyen fordított érkezési sorrend és hydration-hiba melletti újabb poll eset is. A kiválasztásváltás és F5 korábbi tesztjei maradjanak zöldek.

### V2 — A recovery-frissítések egymás között nincsenek rendezve

**Hely:** `client/src/components/dd-admin-shell.ts:615–629`.

**Reprodukció:** A ugyanazon kiválasztási generációjában a revision 4 egy lassú evidence-frissítést indít, amely még `recovery: null` értéket ad. Revision 5-nél újabb frissítés indul, amely már `allClear: true` bizonyítékot ad. A felületen először megjelenik az „all targets clear”; az első kérés késői válasza ezt **„No recovery proof has been recorded”** szövegre cseréli. A V2 teszt mindkét egymást követő UI-állapotot ellenőrzi.

**Ok:** a guard csak a runKey/kiválasztási generáció párost hasonlítja össze. Két `_refreshSelectionDetail()` ugyanahhoz a kiválasztáshoz egyaránt érvényesnek számít; az utoljára megérkező válasz nyer. A history írása ugyanezt a szabályt használja.

**Szűk javítás:** a detail-frissítésnek legyen saját kérésgenerációja vagy soros, összevont újraolvasása. A régebbi kérés sem sikert, sem hibát ne írhasson az újabb helyére. Ez a generation nem azonos a futam kiválasztási generationjével.

**Elfogadás:** V2 zöld; null→clear és régebbi proof→újabb proof sorrendek; timeline ne menjen visszafelé. Azonos futam sikertelen státuszpollja ne törölje a vezérlést.

### V3 — A belépés saját loading flagje blokkolja az első dashboard-olvasást

**Hely:** `client/src/components/dd-admin-shell.ts:379–399`, `:436–438`.

**Reprodukció:** `/admin?run=A` session GET-je 401, majd az operátor sikeresen belép. A Sign out gomb már megjelenik, a kiválasztott futam és az űrlap descriptorai mégsem töltődnek be. A V3 teszt nem mozgatja előre a 30 másodperces órát, így a hiányzó azonnali betöltést méri.

**Ok:** `_signIn()` `_loading=true` mellett hívja `_loadDashboard()`-ot, amely pontosan `_loading=true` esetén azonnal visszatér. A következő dashboard-időzítő, kézi Refresh vagy F5 kerülheti meg ezt. A mintát a baseline `1feca84` változatában is ellenőriztem: örökölt hiba, nem a mostani fejlesztő új regressziója.

**Szűk javítás:** a session-művelet, dashboard-olvasás és kiválasztott futam betöltése ne ugyanazzal a logikai flaggel zárja ki egymást. A belépési eredmény elfogadása indítson egy tényleges dashboard-betöltést.

**Elfogadás:** V3 zöld; 30 másodperces várakozás vagy kézi Refresh nélkül megjelenik A vezérlése. Maradjon double-submit védelem; hibás belépés ne nyisson privát felületet. Ez UI/session-választeszt, nem a valódi identity proxy hitelesítési próbája.

### V4 — Másik oldal adatai kerülnek az új URL és sorszám alá

**Hely:** `client/src/components/dd-page-blocks.ts:68–71`, `:96–112`, `:174–183`. A Transactions és a többi szűrt nézet azonos mintáit is vizsgálni kell a javításkor.

**Reprodukció:** a Blocks első oldala betöltődik, az első sor `/block/11500`. Older → `/blocks?page=2`, a második kérés 503. Az első oldal sorai továbbra is a táblában vannak, a pager viszont már a második oldal tartományát jelzi. A külön hibaüzenet nem mondja meg, hogy a lent maradó sorok a korábbi oldalhoz tartoznak.

**Ok:** a query változásakor `_offset` módosul, a tárolt `_rows` és `_loaded` megmarad. A hibás kérés csak az `_error` mezőt állítja. Ugyanazon oldal pollinghibájánál hasznos a korábbi adat megtartása; megváltozott lekérdezésnél az új címke nem tartozhat hozzá.

**Szűk javítás:** a betöltött adat mellett őrizd meg a lekérdezésének azonosságát. Másik oldal betöltése/hibája alatt vagy ne rendereld a korábbi sorokat, vagy külön, egyértelműen a korábbi oldal pillanatképeként rendereld őket a hozzájuk tartozó sorszámokkal. Az új lap adatait csak a sikeres válasszal rendeld az új pagerhez.

**Elfogadás:** V4 üzleti feltétele teljesül; a jelenlegi ellenpróba a sorok elrejtésének egyszerű megoldását várja. Ha külön címkézett korábbi pillanatkép készül, a teszt ezt a címkét és a hozzá tartozó régi sorszámokat ellenőrizze, ne törölje az azonossági elvárást. Több egymás utáni lapváltás, Back, késői válasz és ugyanazon oldal pollhibája is legyen lefedve.

### V5 — A hibás Advanced szöveg elveszik egy másik mező szerkesztésétől

**Hely:** `client/src/components/dd-simulation-control.ts:367–389`, különösen `:386–387`.

**Reprodukció:** Advanced JSON-ba ezt írom: `{"count": 7, "durationSeconds":`. Megjelenik a figyelmeztetés, hogy a szöveg megmarad és nem készül terv. Utána a strukturált Count mezőt 2-re írom. A hibás szöveg és a figyelmeztetés eltűnik; helyette a korábbi objektumból származó `{"count":2,"durationSeconds":60}` jelenik meg. A félbehagyott szerkesztés nyomtalanul elveszett.

**Ok:** `_setParam()` minden formváltozásnál nullázza `_paramsText`-et és `_paramsError`-t, akkor is, ha a JSON éppen érvénytelen. Ez ellentétes a 15. nap kifejezett adatmegőrzési feltételével.

**Szűk javítás:** hibás raw JSON mellett a strukturált szerkesztést tiltsd, vagy legyen explicit helyreállítás/eldobás művelet. Egy tetszőleges mező input eseménye ne jelentse a JSON eldobását. A már kiválasztott futam és a recovery vezérlői ettől maradjanak elérhetők.

**Elfogadás:** a hibás szöveg változatlan marad a felhasználó egyértelmű javításáig/eldobásáig, Prepare nem küldi a régi objektumot. A teszt locator-lépése igazítható egy letiltott formhoz; a szövegmegőrzési állítást meg kell tartani. Érvényes JSON és strukturált mezők között továbbra is kétirányú szinkron kell.

### V6 — Az exportból eltűnik, hogy a riportlekérés hibás volt

**Hely:** `client/src/lib/simulations.ts:319–333`; letöltési link: `client/src/components/dd-page-simulations.ts:441–455`.

**Reprodukció:** ugyanazt a run-t és lekérési időt exportálom egyszer `report.kind='absent'`, egyszer `report.kind='error'` / HTTP 503 eredménnyel. A két JSON **teljesen azonos**, mindkettőben `report: null`. A működő UI különbséget tesz a két állapot között, a letölthető lelet már nem.

**Ok:** a helper minden nem-`present` állapotot nullra képez, a felület hibás riportlekérés mellett is felajánlja a letöltést. A `SimulationExport.report` dokumentációja a null értéket a nem létező mérésként magyarázza, ezért ez jelentésvesztés, nem pusztán hiányzó kényelmi mező. A V6 tiszta helper-teszt; a letöltési ág elérhetőségét forrásból ellenőriztem.

**Szűk javítás:** az exportban legyen explicit riportlekérési státusz, vagy ne készüljön teljesnek nevezett export, amíg a mérés lekérése hibás. A schema/kompatibilitás változását dokumentáld. Maradjon kizárólag a publikus válaszokra támaszkodó export; privát historyt vagy artifactot nem kell és nem szabad hozzáolvasni.

**Elfogadás:** a 404-es mérés-hiány és a 503/timeout olvasási hiba az export fogyasztója számára különbözik. V6 mellett legyen böngészős letöltési ellenőrzés; ha a választott javítás letiltja a hiányos exportot, azt kell mérni. A publikus redakciós tesztek maradjanak zöldek.

### V7 — Kezdeti evidence-hibából nem következik a bizonyíték hiánya

**Hely:** `client/src/components/dd-admin-shell.ts:517`, `client/src/components/dd-simulation-control.ts:1062–1066`.

**Reprodukció:** a futam és a mentett terv sikeresen visszatöltődik, a `/recovery` 503-at ad. A felület ezt írja: „No recovery proof has been recorded for this run yet.” A válasz valójában nem állított ilyet; csak nem lehetett elolvasni a bizonyítékot.

**Ok:** a kezdeti `_loadHistory()` `.catch(() => null)` ága összemossa a valódi üres eredményt a hibával. A J2 javítás `undefined`/`null` megkülönböztetése csak a későbbi detail-frissítésben szerepel.

**Szűk javítás:** a kezdeti olvasás és az újraolvasás is ugyanazt a loading / absent / present / unavailable bizonyítékállapotot használja. A hiba legyen látható és újrapróbálható; ne következzen belőle sem „all clear”, sem „soha nem volt bizonyíték”. A már betöltött futam vezérlését önmagában az evidence GET hibája ne tüntesse el.

**Elfogadás:** V7 zöld; kezdeti 503 és null külön felirat; hiba→siker helyreállás; korábbi jó bizonyíték frissítési hibája továbbra se törölje azt.

## 2. A korábbi R1–R7 javítások állapota

| Tegnapi találat | Mostani értékelés |
|---|---|
| R1: B URL alatt A vezérlése | A konkrét hiba javítva: az előző run törlődik, `_actionRun()` is ellenőrzi a runKey-t |
| R2: korábbi kiválasztás késői hibája töröl | A konkrét A→B hiba javítva kiválasztási generációval; a hydration/poll közös revision-védelme még hiányzik, V1 |
| R3: evidence soha nem frissül | Az átmenet/mutáció/Refresh utáni olvasás elkészült; az egymást keresztező frissítések és a kezdeti hiba miatt még részleges, V2/V7 |
| R4: megerősítés átkerül másik futamra | Javítva: a runKey változása törli a megerősítéseket |
| R5: Fairness-profil beragad | Javítva: dinamikus feloldás minden tickben, explicit választás megmarad |
| R6: aktuális registry létszáma történeti szűrést kap | Javítva: a teljes aktuális registry számít; az eligibility más metrikáknál megmarad |
| R7: szerkesztett draft azonos create kulcsot kap | Javítva a teljes request snapshothoz tartozó scope-pal; a változatlan retry kulcsa stabil |

A rendes E2E és unit kapuban ezekhez hozzáadott tesztek most átmentek. A tegnapi `docs/review-2026-09-12` csomag történeti bizonyíték; a mai teljes futás a továbbfejlesztett űrlapokhoz igazított rendes teszteket mérte. A mai ellenpróbák külön csomagban vannak.

## 3. F01–F14 minősítés

A minősítés a webes hibákra szól; nem Core-, konszenzus- vagy labor-tanúsítás. Az éles státuszt külön oszlop tartalmazza.

| Audit | Minősítés | Konkrét kód és működési bizonyíték | Éles korlát |
|---|---|---|---|
| F01 – vezérlés visszatöltése | **Részben javítva** | `dd-admin-shell.ts`, `dd-simulation-control.ts`; run-selection E2E zöld; V1/V3 még hibás | A VPS-en a J1–J3 javítások sincsenek telepítve |
| F02 – állapotkövetés | **Részben javítva** | `_pollSelectedRun`, `_acceptRun`, run-status E2E; V1/V2/V7 ellenpéldák | Korábbi változat fut |
| F03 – fejléc/Overview frissesség | **Javítva a vállalt körben** | `freshness.ts`, `dd-shell.ts`, `dd-page-overview.ts`; freshness unit/E2E, failure-states E2E | A korábbi frissességjavítás kint; a 20. napi bővítések nem. API-lekérés ideje nem azonos a forrásmegfigyelés idejével |
| F04 – kísérletlista teljessége | **Javítva** | `dd-page-experiments.ts`, `experiments.v1.routes.ts`; 0/25/26/34 és lapozási E2E, valós HTTP/Mongo paging | A 08. napi változat kint |
| F05 – Fairness-profil | **Javítva** | `dd-page-fairness.ts`, `primaryProfile.ts`; tip-váltás, hiba utáni feloldás, explicit és aggregate E2E; HTTP-szűrés | J3 dinamikus feloldás még nincs kint |
| F06 – hostlétszám | **Javítva** | `selectionFairness.ts`; aktuális registry unit és `fairnessSelection.integration.test.ts`, null/7–5/redakció | J3 korrekció még nincs kint |
| F07 – hibás percent-escape | **Javítva** | `router.ts`/router unit/E2E; élő `/round/%` 400, nem kliensösszeomlás | Az éles nginx választ közvetlenül mértem |
| F08 – ismeretlen útvonal | **Javítva** | `dd-page-not-found.ts`, `router.ts`; közvetlen és SPA navigációs E2E | A kliensoldali 404-oldal kint; a SPA HTTP fallback továbbra 200 lehet, ez külön réteg |
| F09 – DSL alapértékek | **Javítva** | `scenarioRegistry.ts`; descriptor és scenario-séma unit, forms E2E, scenarios HTTP | A presetjavítás kint, az új 15–16. napi űrlapok nem. V5 az új editor külön hibája |
| F10 – HTML CSP/HSTS | **Részben javítva üzemeltetési értelemben** | `ops/nginx/*.conf`, `httpHardening.ts`; buildelt kliens 4/4 enforce CSP, HTTP hardening tesztek | HTML-en HSTS és CSP report-only él; enforce nincs. API-n még két HSTS, az új szerver nincs deployolva |
| F11 – megosztható szűrők | **Részben javítva** | `queryState.ts`, Blocks/Transactions/Staking/Peers és 10. napi oldalak; URL/history E2E zöld; V4 hibás lapváltási adat-azonosság | A 11. napi bekötések nincsenek kint |
| F12 – szemantika/fókusz | **Javítva a vizsgált körben** | `dd-shell.ts`, oldalcímek, shared stílusok; teljes accessibility és navigation E2E, billentyűzet/skip link/zoom | Nincs kint; nem képernyőolvasós tanúsítás |
| F13 – függőségek | **Részben javítva, elfogadott maradékkal** | `body-parser@1.20.8` → `qs@6.16.0`; `express@4.22.2` → `qs@6.15.3` még érintett. Friss npm audit: 2 moderate, 0 high/critical. Mindkét szerver simple parserét és urlencoded hiányát tesztek védik | A VPS még a régi lockfile-t futtatja |
| F14 – veszélygomb kontraszt | **Javítva** | `styles/contrast.test.ts`, shared stílusok, accessibility E2E mindkét témában | Nincs kint |

A 15–19. nap termékfunkciói is elkészültek: strukturált scenario-űrlapok, targetválasztó, publikus szimulációs nézet, mobilmenü, keresés, másolás és módszertani oldal. V5 és V6 ezek elfogadását még korlátozza. A publikus DTO-ra ültetett privát sentinel nem jutott át a tényleges HTTP/Mongo teszteken. Az export V6 hibája jelentésvesztés, nem kimutatott privátadat-szivárgás.

## 4. Ténylegesen lefuttatott ellenőrzések

| Ellenőrzés | Eredmény |
|---|---|
| GitHub #174 | MERGED, merge SHA `39e7f80`; a lekérdezett push és PR checkek sikeresek |
| Node/npm/lockfile | Node 24.7.0, npm 11.5.1; lock SHA256 `2f72d372cf5d6dac7bc2e68a656971236a9791fe5cd163f80173f9a3177ffb78` |
| Shared build → typecheck → unit → teljes build | Mind exit 0; **864 szerver + 202 kliens unit**, 92+18 fájl |
| Teljes rendes E2E | **231/231**, exit 0, 5,7 perc, `CI=1`, 1 worker, `DEVNET_E2E_PORT=5293` |
| Valós HTTP/Mongo integráció | **98 passed, 8 skipped**, 15 fájl, exit 0, külön `127.0.0.1:27018` teszt-Mongo |
| Buildelt kliens enforce CSP alatt | **4/4**, exit 0; tiltott inline script kontroll is benne |
| Review-képek újragenerálása | 4/4 futtatási eset, **17 friss kép**, exit 0, külön 5296 port |
| Mai külön ellenpróbák | **7 failed, 1 passed**, exit 1; mind a hét a kívánt működésen bukik, nem fixture/setup hibán |
| `npm audit --json` | exit 1, 2 moderate; a teljes nyers jelentés mellékelve |
| `npm run verify:ops` | exit 0; 19 szkript, 23 relatív import, 14 név szerinti binding feloldódik |
| Követett fájlok `git diff --check` | Tiszta; alkalmazáskódot a review nem módosított |

**A környezet kezelése:** az első E2E indítás az alapértelmezett 5191 foglalt portja miatt nem indult el; saját szabad portra váltottam, a másik folyamatot nem állítottam le és nem használtam fel. A sikeres teljes E2E futás ezután egy menetben átment.

A külön ellenpróbák első futásának végén generált HTML-artifact írása Vite reloadot jelzett. A review-only Vite konfiguráció ezeket a kimeneti könyvtárakat kizárja a figyelésből. Újrafuttatva, ilyen reload nélkül ugyanaz a hét működési állítás bukott. A publikus 404-es riportot helyesen megkülönböztető C1 kontroll zöld. **Nincs `test.fail`, skip vagy szándékosan megfordított hibavárás a V-tesztekben.**

**Bizonyítékrétegek:** a UI próbákban minden API-válasz szintetikus, a hálózati kilépést a meglévő harness tiltja. Az integrációs kör valódi HTTP és valódi MongoDB, elkülönített generált adatbázisokkal. A 8 skip az adatbázis nélküli tartalék ág; nem 8 elmaradt mérés. A leak-check nem jelzett hátrahagyott új tesztadatbázist. **Regtest/Core/fault/hostoldali recovery futam nem történt.**

Saját új friss klónt és `npm ci`-t ebben a review-ban nem indítottam; a helyi futás a meglévő checkoutban történt. A tiszta telepítés bizonyítéka a GitHub CI `npm ci`-vel induló munkafolyamata; a naplóban leírt korábbi friss-klón futásokat nem minősítem saját mérésnek. A korábban jelzett időzítési flake ebben az egy teljes helyi E2E futásban nem jelentkezett; ettől még nem bizonyított, hogy minden környezetből eltűnt.

## 5. Mi fut most a VPS-en?

**A „11. napig van kint” állítást pontosítani kell.** Read-only SSH-val az alkalmazás checkoutján a következőt mértem:

```text
git -C /opt/devnet-deftrack/app rev-parse HEAD
83b87101704f7f34b4c7432bb80e15852000ad0c
```

Ez a #163 merge: az 01–10. nap és a külön DSL-változtatás. **A J1–J3 és a 11–20. nap alkalmazáskódja nincs kint.** A publikus HTML Last-Modified értéke a mérésben 2026-09-12 14:17:41 GMT volt, összhangban az átadási csomagban rögzített régi builddel. A böngészőben a helyi végső UI-t és a VPS régi UI-ját nem tekintettem azonos verziónak.

A nginx-fejlécek külön telepítve vannak. A [főoldal](https://devnet.deftrack.xyz/) HTML HEAD-válaszán mértem:

- HSTS: `max-age=63072000; includeSubDomains`;
- `Content-Security-Policy-Report-Only`, nem enforcing CSP;
- a korábbi noindex/nosniff/frame/referrer fejlécek.

A [health API](https://devnet.deftrack.xyz/api/v1/health) még két HSTS fejlécet küld: 31 536 000 és 63 072 000 másodperc. Ez a régi alkalmazás és az új nginx együttélésével egyezik; a mainen már lévő egyetlen HSTS-tulajdonos javítást még élesben is mérni kell deploy után. A hibás `/round/%` kérésre az élő nginx **400**-at adott.

A helyi WSL-ben `nginx` nem volt elérhető, ezért az izolált `verify-headers.sh`-t nem futtattam újra. Helyette nem állítottam, hogy a valós fejlécmérés kivált minden helyi nginx-konfigurációs esetet: a HTML/API és a hibás URL élő válaszait mértem, a repo CSP-jét külön a buildelt kliensen ellenőriztem. Production konfigurációt nem módosítottam, szolgáltatást nem reloadoltam.

## 6. Mobil és megjelenés

A 360/390/768/1440 px-es és zoom/billentyűzetes automatizált ellenőrzések a teljes 231-es körben átmentek. A 17 újragenerált screenshotból külön vizuálisan átnéztem a desktop Overview-t, a nyitott telefonos menüt és a telefonos elutasított adminműveletet. Ezek szintetikus adatokat mutatnak, nem élő laborállapotot.

A csoportos navigáció áttekinthetőbb, a hosszú azonosítók a vizsgált képeken nem feszítik szét az oldalt, az admin hibaüzenet telefonon olvasható. Megmaradt használhatósági kompromisszum: a telefonos fejléc és a menü sok függőleges helyet foglal. Ez az átadásban is megnevezett további finomítás, nem új blokkoló finding.

## 7. Javító feladatcsomag az implementálónak

| Csomag | Sorrend | Szűk fájlkör | Kimenet |
|---|---|---|---|
| A – állapot és bizonyíték | V1 → V2 → V7 → V3 | `dd-admin-shell.ts`, kapcsolódó run-state/recovery típusok, a megjelenítéshez szükséges `dd-simulation-control.ts`, célzott tesztek | Egyetlen revision-szabály minden run-olvasáshoz; rendezett evidence; őszinte olvasási hibák; működő első belépés |
| B – lekérdezés és adat azonossága | V4 | Blocks/Transactions és az ellenőrzésben azonosított azonos mintájú oldalak, kis helper csak indokolt esetben | Régi adat nem látszik új oldal/szűrő eredményének |
| C – szerkesztés és export | V5 → V6 | scenario editor, `simulations.ts`, publikus simulation export UI, tesztek | Nem vész el hibás JSON; a hiányzó és az elérhetetlen riport külön marad |

Mindegyik finding külön kis commitban javítható. Az A csomag után célzott run-selection/run-status + a V1/V2/V3/V7; B és C után a saját új próbák és az érintett meglévő tesztek. Végül typecheck, unit, build, teljes E2E, CSP és a módosított szerződésekhez releváns HTTP/Mongo kör. Ha a DTO export sémája változik, annak klienskompatibilitását és redakcióját is ellenőrizni kell.

**Másolható utasítás:**

```text
Olvasd el a docs/WEBSITE_FINAL_REVIEW_2026-09-13_HU.md fájlt.
Review alap: main@39e7f80. Először ellenőrizd, mi változott azóta.
Külön javító ágon, A → B → C csomagban dolgozz, findingenként kis commitokkal.
A docs/review-2026-09-13/regressions.spec.ts V-tesztjei a kívánt viselkedést írják le.
Reprodukálj, javíts, majd tedd a megfelelő unit/E2E kapuba az új regressziókat.
Ha más UI-megoldást választasz (pl. V4 címkézett snapshot, V5 tiltott form,
V6 letiltott hiányos export), a locator/elvárt forma változhat, de az adat-
azonosság, szövegmegőrzés és hiba/hiány különbsége nem lazítható.
Ne nullázz minden állapotot minden pollnál; a működő recovery vezérlés maradjon.
Ne módosíts Core-t, konszenzust, állapotgépet, lease-t, lockot, authot vagy
szerveroldali idempotencia-védelmet egy UI-hiba megkerülésére.
Ne deployolj és ne indíts valódi faultot ebben a javító körben.
Add át a findingenkénti commitot, valódi teszteredményt és a nyitott korlátokat.
A javító diffet új review-ra add vissza.
```

## 8. Mellékletek és határok

- [Futtatható ellenpróbák](review-2026-09-13/regressions.spec.ts)
- [Review Playwright-konfiguráció](review-2026-09-13/playwright.config.ts)
- [Review-only Vite-konfiguráció](review-2026-09-13/vite.config.ts)
- [Teljes, megismételt ellenpróba-futtatás](review-2026-09-13/results.txt)
- [Friss npm audit JSON](review-2026-09-13/npm-audit.json)
- Helyi trace-ek/hibaképek: `client/test-results/review-final/`.
- Friss általános review-képek: `client/review-shots/` (17 PNG).
- [GitHub CI, PR #174](https://github.com/minuszka/devnet.deftrack/actions/runs/34756559571).

Futtatás a repó gyökeréből, telepített függőségekkel és buildelt shared csomaggal:

```powershell
npx playwright test --config docs/review-2026-09-13/playwright.config.ts
```

A további Core-adapter bekötés, a valódi normál és abort/recovery regtest elfogadás, a production deploy és a CSP enforce-ra váltás külön feladat. A proTxHash keresés dedikált útvonal nélkül továbbra is dokumentált backlog. Ezek hiányát nem UI-fixture eredménnyel pótoltam.

Dokumentációs apróság: a végrehajtási napló eleji áttekintő táblában a 11–20. nap még TERVEZETT, miközben a későbbi bejegyzések és az átadási csomag elkészültként részletezik őket. A következő átadáskor ezt érdemes összhangba hozni, a mostani hibajegyek státuszával együtt.

**A review csak új dokumentációt és ellenpróbákat adott hozzá. Alkalmazáskód-javítás, commit, push, merge, éles deploy, wallet-művelet vagy valódi fault nem történt.**
