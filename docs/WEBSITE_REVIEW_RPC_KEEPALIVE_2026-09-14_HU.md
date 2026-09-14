# PR #181 – független RPC keep-alive review

**Verdikt: APPROVED – a #181 változtatása telepíthető, a karbantartási ablak lezárása után.** Telepítést nem végeztem. Blokkoló működési hibát nem találtam; egy saját mutációval igazolt, nem blokkoló tesztlefedettségi hiányt rögzítettem. A feltételezett incidensok erősen alátámasztott magyarázat, de nem bizonyított socket-szintű rekonstrukció.

## 1. Azonosítók és a vizsgálat határa

- PR-fej: `310bfb25d7a13d8da885cc15df944c9954df417b`.
- Vizsgált merge: `65dcadf3c314a93aced4abc103eb60045880dac4`.
- Első szülő: `b9f5c9a8646e78a4a00ac9baec82f002e94db174`.
- A merge első szülőjéhez vett teljes diff SHA256: `3c9c7f95ec71098dce7959b40b1797ac26512e31eea518710b5a948be50b68c4`.
- Saját futtatás: Windows, Node `v24.7.0`, axios `1.19.0`, utóbbi egyezik a rögzített lockfájllal.

A mérések külön detached munkafában, a merge pontos állapotán futottak. A függőségeket a meglévő telepítésből használtam; a server és client saját shared-csomagjára külön hivatkozás került, a shared build a saját munkafában készült. A közös checkoutot nem váltottam át. A vizsgált alkalmazásfájlok változatlanok, a saját munkafa git-státusza tiszta. A SHA256-azonosságot a mutációk előtt és után ellenőriztem. Részletek: [identity.json](review-2026-09-14-rpc/identity.json).

Ez a döntés a három érintett fájl változtatására szól, nem a közben készülő további fejlesztésekre vagy a telepített állapothoz képest minden korábbi commit teljes auditjára.

## 2. Az ok-okozati állítás

**Forrásból igazolt:** a Core `src/httpserver.h:13` alapértéke 30 másodperc; a `src/httpserver.cpp:425` ezt vagy a felülíró argumentumot adja át az `evhttp_set_timeout` függvénynek. Az olvasott Core-revízió és a forráskivonatok a [core-timeout.json](review-2026-09-14-rpc/core-timeout.json) fájlban vannak. A VPS-en a felülírás hiányát nem ellenőriztem konfigurációolvasással; ez továbbra is szerzői állítás.

**Forrásból igazolt:** `server/src/index.ts:73`, `:76`, `:83` ugyanabban a `Promise.all` hívásban indítja a két RPC-t. A `client/src/components/dd-shell.ts:38` polling-intervalluma 30 másodperc. A `client/src/lib/poll.ts:113`, `:155` alapján a periodikus kérés látható böngészőlapon fut, háttérben szünetel. Ez nem feltétlenül állandó szerveroldali 30 másodperces óra.

**Saját naplóellenőrzés:** 2026-09-14 UTC szerint 02:18:01, 02:19:01, 02:20:01, 02:22:01, 02:26:31, 02:28:01 és 02:29:01 időpontban megvan a hét hiba. A teljes 00:00–04:00 lekérdezés 35 ilyen hibát adott, valamennyi másodpercértéke 01 vagy 31. A „retrying once” sorok az újrapróbálás indítását mutatják. Nem tekintettem őket sikeres RPC-válasz bizonyítékának. [Szűrt időbélyegek](review-2026-09-14-rpc/remote-readonly.json), [összesítés](review-2026-09-14-rpc/journal-summary.json).

**Következtetés:** a két időzítés találkozása hiteles magyarázat. Nem bizonyított, hogy mindig ugyanaz a második socket marad érintetlenül 30 másodpercig: az Agent a cél szerint pooloz, nem RPC-metódusonként; más kérések, a cache és az in-flight összevonás is befolyásolják a használatot (`rpc.service.ts:126`). A javítás megfelelően csökkenti ezt a kockázatot, de minden lehetséges `ECONNRESET` megszüntetését nem garantálja.

## 3. Agent-időkorlát és saját mérés

A Node `v24.19.0` forrásában az Agent timeout-kezelője a free listán lévő socketet bontja (`lib/_http_agent.js:524`); a `keepSocketAlive` visszaállítja a pool időkorlátját (`:616`). A forrásazonosító és a releváns kivonatok: [Node-forrás](review-2026-09-14-rpc/node-24.19-agent-source.json). A helyi futtatókörnyezet beépített forrását is ellenőriztem.

A `rpc.service.ts:89`, `:95`, `:96` külön hagyja az axios kérés-timeoutját és a két Agent timeoutját. Az axios telepített HTTP-adaptere saját `req.setTimeout` kezelőt állít be (`node_modules/axios/lib/adapters/http.js:1335`). A pool limitje így nem válik 15 másodperces aktívkérés-korláttá. A kérés-timeoutot nem szabad a teljes, újrapróbálást is tartalmazó művelet abszolút időkeretének tekinteni.

Saját helyi HTTP-szerverrel, valódi időzített szerveroldali bontással, 300 ms szerver- és 100 ms kliens-poollimittel mértem:

| Eset | Saját eredmény |
| --- | --- |
| 100 ms poollimit | A szabad socket 114 ms után bezárult. |
| Poollimit nélkül | 200 ms-nál még nyitva volt; a szerver 301 ms-nál bontotta. |
| Újrahasznált socketen lassú kérés | 465 ms alatt sikeres; nem nyílt új kapcsolat. |
| Ugyanez poollimit nélkül | 454 ms alatt sikeres. |
| Külön 150 ms kérés-timeout | A lassú kérést mindkét változatban megszakította. |

A saját alapérték-teszt igazolta a 15 000 ms értéket a fő és peer példánynál, mindkét Agenten, az eltérő kérés-timeoutok megtartásával. [Mérési eredmény](review-2026-09-14-rpc/agent-measurement.json), [alapérték-kontroll](review-2026-09-14-rpc/own-default-results.json).

## 4. A reprodukáló teszt értéke és korlátja

A `rpc.keepalive.test.ts:61` nem ütemez előre szerveroldali bontást: a túl későn érkező kérésre zárja le a socketet. Ez determinisztikusan modellezi az elvesző kérés következményét, és ténylegesen ellenőrzi, hogy az Agent előbb üríti-e a poolt. Nem a valódi FIN/kérés-verseny pontos reprodukciója.

Ezt a saját kontroll is megmutatta: valódi, 300 ms-nál bontó szerverrel a jóval későbbi kérés poollimit nélkül is új kapcsolatra került és sikerült. A szerver korábbi bontását a kliens addigra feldolgozta. A PR tesztje hasznos regressziós védelem, de az incidens okának önálló bizonyítására kevés.

## 5. Negatív kontrollok

Az alkalmazásfájlokat nem szerkesztettem: a Vite transzformációja kizárólag a tesztfolyamat memóriájában cserélte ki a vizsgált kódrészleteket.

| Változat | Meglévő nyolc célzott teszt eredménye |
| --- | --- |
| Eredeti merge | 8 sikeres |
| Agent-poollimit kikapcsolása | 1 hibás, 7 sikeres |
| Első transzporthiba ismét error | 2 hibás, 6 sikeres |
| Végső transzporthiba is warn | 1 hibás, 7 sikeres |
| Limit áthelyezése a kérésre | 2 hibás, 6 sikeres |
| **Saját további mutáció: a default 15 000 → 0** | **8 sikeres – lefedettségi rés** |

A négy előírt kontroll érzékenysége hiteles; az „egyenként pontosan egy teszt bukik” megfogalmazás a saját megvalósításaimra nem igaz. A default-hibát a saját kiegészítő teszt már elkapta: eredetin sikeres, mutálton hibás. Ez P3, nem blokkoló teszthiány, mert a jelenlegi default helyes és külön ellenőriztem. [Kontrollok és fájlhash-ek](review-2026-09-14-rpc/negative-controls.json), [külön hibajegy](review-2026-09-14-rpc/P3-default-timeout-test-gap.md).

## 6. Mellékhatások

- **Peer:** a `seedStatus.service.ts:63` példánya is megkapja az új defaultot. A poll 10 perces (`:25`), így 30 másodperces szerverlimittel a kapcsolat korábban is bezárult volna két poll között. A módosítás nem indít további RPC-ket.
- **Kapcsolatok száma:** elsősorban a 15–30 másodperc közötti szünetek után lesz több új TCP-kapcsolat. A folyamatosan használt socketek újrafelhasználása megmarad; ezt a meglévő öt-hívásos teszt és a saját lassú, újrahasznált kapcsolatos mérés is ellenőrzi. A `maxSockets: 16` változatlan. Élő kapcsolatszám- vagy terhelésmérést nem végeztem.
- **Naplózás:** az első felismert transzporthiba warn, a második error (`rpc.service.ts:157`, `:209`). A visszatérési érték és az exception-alapú hívói kezelés változatlan. A produkciós logger mindkét szintet kiírja (`utils/logger.ts:5`). A vizsgált repóban nem találtam a régi RPC error-sorra támaszkodó automatizmust; külső riasztórendszerek teljes leltárát nem ellenőriztem. Egy error-only számláló szándékosan kevesebb eseményt fog látni.
- **Metrikák:** a hibás első próbálkozás továbbra is hibának számít (`rpc.service.ts:216`, `metrics.service.ts:83`), tehát a warnra váltás nem tünteti el az RPC-hibaarányból.
- A retry osztályozása továbbra is üzenetszövegre épül; a `tolerated` ág továbbra is megelőzi a logszint-választást. Ezek meglévő korlátok, nem a PR új regressziói.

## 7. Kapuk

| Kapu | Saját / ellenőrzött eredmény |
| --- | --- |
| K1 typecheck | exit 0 |
| K1 npm test | 869 server + 203 client teszt sikeres, exit 0 |
| K3 | 15 tesztfájl; 98 sikeres, 8 kihagyott, exit 0 |
| PR-fej CI | Mind a 6 check sikeres |
| Merge CI | Mind a 3 check sikeres |

A K3 kizárólag a 27018-as helyi, eldobható Mongo-példányon futott. Az indító argumentumokat előtte ellenőriztem. A suite saját, véletlen nevű tesztadatbázisokat használ; a végső leak-check nem jelzett újonnan hátrahagyott adatbázist. Produkciós adatbázist nem használtam tesztelésre. A nyolc kihagyott tesztet nem számítom sikeresnek.

A CI Node 22-t használ (`.github/workflows/ci.yml:47`), ezért a saját Node 24-es futtatás különösen releváns. A VPS parancssori Node-verziója az olvasáskor `v24.19.0`; ez önmagában nem bizonyítja az incidens idején futó processz verzióját. Naplók: [K1 typecheck](review-2026-09-14-rpc/k1-typecheck.log), [K1 tesztek](review-2026-09-14-rpc/k1-test.log), [K3](review-2026-09-14-rpc/k3-integration.log), [CI API-kivonat](review-2026-09-14-rpc/ci.json).

## 8. Amit nem végeztem, és a telepítés utáni ellenőrzés

Nem futtattam próbát az élő RPC-n, nem készítettem csomagfelvételt, nem módosítottam VPS-fájlt vagy szolgáltatást, nem olvastam tiltott konfigurációt, nem telepítettem. A nyers journal nem került a bizonyítékcsomagba. Linuxon, a pontos VPS-runtime alatt nem futtattam tesztet; annak Agent-forrását ellenőriztem, a mérések helyi Node 24 alatt történtek.

A karbantartás lezárása után a jóváhagyott változtatás telepíthető. Utána összehasonlítható, látható böngészőlapos polling mellett külön kell számlálni a visszaálló transzporthibák warn sorait és a végleges hibákat. A puszta error-csökkenés nem bizonyítja a socket-hiba megszűnését, mert a PR szándékosan megváltoztatja a logszintet. A TCP-kapcsolatnyitások és az RPC-késleltetés változása szintén hasznos utóellenőrzés.

Futtatások és reprodukció: [RUNS.md](review-2026-09-14-rpc/RUNS.md).
