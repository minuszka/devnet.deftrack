# Kiesés és DKG-ablakok — miért nem elég a hossz, és mit kerülne a plafon emelése

Ez a jegyzet egyetlen kérdést zár le: **meddig tarthat egy fault-futam**, és miért
nem az az érdemi kérdés, aminek látszik. A számok a `domain/dkgWindows.ts`-ben
élnek, teszttel, minden lehetséges illesztésre kimérve.

## A mérés tengelye

A kísérlet nem azt kérdezi, hányszor indítottak újra egy node-ot, hanem hogy
**hány DKG-ablakon át volt távol**. Egy kör akkor vész el neki, ha épp akkor van
lent, amikor a kvóruma a hozzájárulásokat gyűjti — és ez a `MarkBadMember`
kilenc hívási helye közül pontosan az az egy, amit egy egyszerűen *hiányzó*
daemon el tud érni ("did not send any contribution"). A másik nyolc mind azt
követeli, hogy a tag küldött legyen valamit.

A hozzájárulási fázis a ciklus `[dkgPhaseBlocks, 2 * dkgPhaseBlocks)`
szakasza — a node `quorumStageInt / dkgPhaseBlocks + 1` képletéből —, tehát
devneten 2 blokk, 24-enként.

## Amit a puszta hossz garantál: semmit

Egy rögzített hosszúságú kiesés attól függően talál el 0, 1 vagy 2 ablakot, hogy
**hol kezdődik**. Ezért a hossz önmagában csak tartományt ad:

| kiesés | garantált ablak | lehetséges ablak |
|---|---|---|
| 6 blokk (a mai `maxDurationSeconds`, 900 s) | **0** | 1 |
| 24 blokk (egy teljes DKG-intervallum) | **0** | 2 |
| 24 blokk (a mai `MAX_TTL_MS`, 3600 s) | **0** | 2 |
| 25 blokk | 1 | 2 |

A második sor a meglepő, és ez dönti el a tervezést: **egy teljes intervallumnyi
kiesés sem garantál egyetlen kihagyott kört sem.** Az ablakok a `[24k+2, 24k+4)`
helyeken ülnek, és a `[24m+3, 24m+27)` blokkokat lefedő kiesés — pontosan egy
intervallum hosszú — sem az előtte, sem az utána lévő ablakot nem tartalmazza
teljesen. A garanciához `dkgInterval + dkgPhaseBlocks - 1` = **25 blokk**, azaz
devneten **62,5 perc** kell.

## Amiért ez a plafonokról szól

Két korlát van, és egyik sem éri el a 25 blokkot:

- `SCENARIO_LIMITS.maxDurationSeconds` = 6 blokk (900 s).
- `MAX_TTL_MS` = 3 600 000 ms = **24 blokk** — pontosan **egy blokkal kevesebb**,
  mint amennyi egyetlen kihagyott ablakhoz kellene.

Tehát egy **horgony nélküli** futam a 9. napi kísérletet nem tudja kifejezni, és
nem is a scenario-korlát a szűk keresztmetszet: még a wrapper saját TTL-plafonja
sem elég hozzá.

## Ezért horgony, nem magasabb plafon

Ha a kiesés kezdete a DKG-ütemezéshez van igazítva, egy kihagyott ablak
**2 blokkba** (300 s) kerül a 25 helyett. A horgony nem kényelmi funkció: ez az
egyetlen mód, hogy a kísérlet a meglévő biztonsági korlátokon belül elférjen.
`anchorForNextWindow()` adja a kezdőmagasságot, `dkgWindowsFromAnchor()` pedig a
pontos számot, amivé a tartomány összeomlik.

## Mit kerülne a `MAX_TTL_MS` emelése

**Ez nem csendes paraméterhangolás, ezért van itt leírva, és ezért nem tettük
meg.** A `MAX_TTL_MS` a wrapper watchdogjának a plafonja: az a felső korlát,
ameddig egy fault életben maradhat akkor is, ha *minden más* elromlik — a
control-szerver meghal, a recovery soha nem indul el, az operátor hazamegy. Ez
az utolsó védvonal a beragadt hiba ellen, nem teljesítménybeállítás.

Emelni tehát azt jelenti: elfogadjuk, hogy egy elfelejtett fault ennyi ideig
állhat a hálózaton. A 25 blokkhoz **3750 s** kellene, azaz a plafont egy óra fölé
kellene vinni — és mivel a devneten egy PoSe-kizárás 100 pontot ér, a döntés nem
kényelmi kérdés.

Ha valaha mégis emelni kell, ezeknek előbb igaznak kell lenniük:

1. A recovery bizonyítottan lefut a szerver elvesztése után is — ma a boot-kori
   `bootCleanup()` ezt a wrapper újraindulására alapozza, nem külső óra van
   mögötte.
2. A heartbeat boot-kori qdisc-próbája megvan (ma az állapotfájlból következtet
   tisztaságra, tehát egy összeomlott elődtől bent maradt netem mellett is
   átengedne).
3. A futam borítékának (`runExpiresAtMs`) és a lease-nek a viszonya kimondottan
   dokumentálva van arra az esetre, amikor a lease hosszabb, mint egy DKG-kör.

Addig a horgony az olcsóbb és igazabb válasz: kevesebb kiesés, pontosabb szám.
