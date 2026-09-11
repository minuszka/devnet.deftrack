# Bemásolható indítópromptok – weboldaljavítás

Az `NN` helyére a munkanap száma kerül. Egy körben egy napot érdemes kiadni; a napok sorrendjét és függéseit a terv határozza meg. A modellválasztást ez a dokumentum nem automatizálja.

## Napi implementálás Terra vagy Opus számára

```text
A D:\www\devnet .deftrack projektben dolgozz.

Hajtsd végre a docs/WEBSITE_IMPLEMENTATION_ROADMAP_HU.md NN. napját.
Először olvasd el a terv munkaszabályait, ellenőrzési kapuit és az NN. napot,
valamint a docs/WEBSITE_IMPLEMENTATION_LOG_HU.md aktuális állapotát.
Olvasd el az audit kapcsolódó F-pontjait a
docs/WEBSITE_AUDIT_2026-09-11_HU.md fájlban, és ellenőrizd a jelenlegi kódot.

Ez helyi implementálási feladat. A feladathoz szükséges kódot és teszteket
készítsd el, ne állj meg egy tervnél. A nap pontos fájlkörét és kész-feltételeit
kövesd; ne kezdj mellé más napot vagy általános refaktort.
Őrizd meg más munkáját. A régi, már kész roadmapokat ne írd át.

Kezdéskor legfeljebb 6 pontban mondd el: mit találtál, milyen viselkedés változik,
melyik meglévő API-t használod, milyen fájlokat érintesz és hogyan ellenőrzöd.
Ezután dolgozz tovább önállóan. Egy szokásos implementációs döntés miatt ne állj meg.
Hiányzó tényt ellenőrizz; hiányzó jogosultságot vagy tesztbizonyítékot ne találj ki.

Ne módosíts Core-t, konszenzust, gyűjtőt, walletet, szimulátor állapotgépet,
lease-t, lockot vagy jogosultságot egy UI-feladat megoldásához.
Ne telepíts élesre és ne indíts valódi hálózati faultot e megbízás részeként.
A meglévő biztonsági és futtatási korlátok maradjanak.

Az érintett hibát reprodukáld, készíts értelmes regressziós tesztet,
és futtasd az adott napi ellenőrzési kapukat exit-kóddal.
A mockolt böngészőteszt nem valódi laborfutam; a skipped teszt nem siker.
Környezet hiányában pontosan írd le, mi elkészült és melyik ellenőrzés függő.
Ne gyengíts tesztet vagy szervervalidátort a zöld eredményért.

A végén frissítsd a végrehajtási naplót, és add át:
1. mi változott és melyik F-hibát oldja meg;
2. érintett fájlok és commit/HEAD;
3. lefutott tesztek, eredmények és bizonyítékok;
4. kihagyott tesztek, ismert korlátok;
5. a következő nap elkezdhető-e a függések alapján.

Az NN. nap kész-feltételeinek teljesülése után állj meg az átadással.
Ne jelents éles javítást pusztán attól, hogy a helyi build elkészült.
```

## Modellváltás vagy félbemaradt nap folytatása

```text
Folytasd a docs/WEBSITE_IMPLEMENTATION_ROADMAP_HU.md NN. napját.
Először olvasd el a végrehajtási naplót és nézd meg a tényleges git diffet.
Ne feltételezd, hogy a korábbi modell által késznek mondott feladat helyes.
Ne kezdd újra a már működő részeket. Ellenőrizd a nyitott pontokat, őrizd meg
a kész változtatásokat, és fejezd be a hiányzó implementációt/ellenőrzést.
A nap végén ugyanazzal a sablonnal add át az eredményt.
```

## Végső független review – visszaadható az auditáló modellnek

```text
Review-zd a devnet.deftrack weboldaljavítás elkészült változtatásait.
Alapdokumentumok:
- docs/WEBSITE_AUDIT_2026-09-11_HU.md
- docs/WEBSITE_IMPLEMENTATION_ROADMAP_HU.md
- docs/WEBSITE_IMPLEMENTATION_LOG_HU.md

A naplóban szereplő baseline és végső HEAD közötti tényleges diffből dolgozz.
A napló állításait ellenőrizendő állításként kezeld, ne bizonyítékként.
F01–F14 mindegyikére adj: javítva / részben javítva / nem javítva / nem
ellenőrizhető minősítést, konkrét fájl- és működési bizonyítékkal.

Kiemelten nézd meg:
- F5 utáni futam-visszatöltés, mentett terv, helyes runKey;
- poll/művelet versenyhelyzetek, revision, idempotency kulcsok;
- session/CSRF/role korlátok és a recovery elérhetősége;
- hiányos/elavult adatok és félrevezető sikerjelzések;
- teljes lista kontra lapozott minta, Fairness számlálók;
- publikus DTO és export redakció;
- valódi URL/history/fókusz/mobil viselkedés;
- függőség- és nginx-változás tényleges hatása.

Futtasd az indokolt ellenőrzéseket. UI-fixture, valós HTTP/Mongo és regtest
bizonyíték külön szerepeljen. Éles rendszert ne módosíts és faultot ne indíts.
Ha a böngésző vagy labor nem elérhető, a korlátot mondd ki.

Először a megmaradt vagy új hibákat add vissza súlyossággal, reprodukcióval és
javítási javaslattal. Külön jelezd, mely feladatok nem részei a 20 napos körnek.
Ne tekintsd deployoltnak a helyi javítást. E körben review-t végezz;
a javításokat külön, konkrét hibajegyekben add vissza az implementálónak.
```
