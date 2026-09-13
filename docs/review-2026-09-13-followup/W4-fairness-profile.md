# W4 — P2: Automatikus Fairness profilváltás régi mintát hagy az új kiválasztás alatt

Alap: main@72fec82. Hely: `client/src/components/dd-page-fairness.ts:173–180,214–225,237–285`. Korábban is meglévő, handoverben nyitottként jelzett eset; most böngészőben mérve.

Reprodukció: `/fairness` explicit profil nélkül, tip az aktiválás alatt; V1-profil statisztikája betöltve. A következő poll tipje az aktiválás felett van, a feloldott profil V2-re változik, az új fairness GET 503. A V2 „at the tip” gombja kijelölt, miközben a V1 statisztikája/táblái maradnak. A statisztika saját régi profilneve olvasható; nincs azonban külön korábbi pillanatképként megjelölve.

Szűk javítás: a betöltött adat tényleges mintakulcsa tartalmazza az ablakot és az **effektív feloldott profilt**. Az automatikus tip-váltás is mintaváltás; ne csak URL-módosításkor érvényteleníts. Azonos profil/ablak pollhibájánál maradjon a saját utolsó jó adat.

Elfogadás: W4 zöld; új profil késleltetett és hibás válasza alatt a régi minta nem jelenhet meg aktuálisként. Azonos profil pollhibája megőrzi az adatot, explicit profilválasztás és Back továbbra is helyes. Külön, világosan feliratozott korábbi snapshot is elfogadható, ha a teszt az adat saját profilját és korábbi állapotát ellenőrzi.

Külön commit, Fairness komponens és célzott fairness/query-identity tesztek. Konszenzusprofil-feloldási szabályt vagy szervereredményt ne változtass a megjelenítési hiba miatt.
