# W3 — P2: A ResponseGate másik, azonos URL-ű választ is saját olvasásnak fogad el

Alap: main@72fec82. Új harness-hiba. Hely: `client/e2e/harness.ts:172–193,204–224,418–435`.

Reprodukció: egy gated kérés válaszának fejlécét a lap megkapja, de a JSON-olvasást szándékosan későbbre halasztja. Közben egy másik fetch ugyanazon pathname+query URL-en elolvassa a saját JSON-ját. A `release()` `before + 1` számlálási feltétele teljesül; visszatér, miközben a saját törzs még `undefined`.

Szűk javítás: **kérés-/válaszpéldány-azonosság**, ne csupán pathname+query szerinti darabszám. Megoldás lehet a harness által adott egyedi válaszjelölő fejléc, amelyet a read-observer az adott Response-hoz jegyez fel. Ez csak tesztadat legyen, ne módosítsa az alkalmazás JSON-ját, kérésparamétereit vagy a visszaadott Promise szemantikáját. A cancelled és a teardown kezelés maradjon érvényes.

Elfogadás:

- A W3 zöld, továbbá két azonos URL-ű, fordítva elolvasott response esetén minden release csak a sajátját fogadja el.
- A régi harness öntesztek, V1/V2/V7 versenytesztek, paused clock és cancellation esetek zöldek.
- A javítás nélküli negatív kontroll konkrétan a korai visszatérést mutassa ki; ne pusztán egy tetszőleges timeoutot.
- Nem állítható, hogy minden async munka befejeződött: későbbi timer/kérés munkájára külön UI-állítás kell.

A jelenlegi rendezett V1/V2/V7 tesztekben ebből nem bizonyítottam hamis zöldet; saját baseline-kontrolljaik buktak. Külön harness-commit, alkalmazásváltoztatás nélkül.
