# X2 — P3: a W3 negatív kontroll első hibája után a teszt timere bezárt lapot hív

Hely: `client/e2e/harness.spec.ts:156–169`, a „release waits for its own response…” teszt.

## Reprodukció és jelentőség

A jelenlegi tesztet a `72fec82` régi, URL-darabszámot használó harnessével futtatva az elvárt első hiba megvan: **Expected body n=1, Received undefined**. Ez hiteles korai-visszatérési kontroll.

Az állítás azonban az `await allow` **előtt** dob hibát. A teszt teardownja bezárja a lapot; az 500 ms-os timer később `page.evaluate()`-et hív rajta, az `allow` Promise pedig megfigyeletlenül elutasítódik. A napló második hibája: **Target page, context or browser has been closed**. [Bizonyíték](negative-harness.txt).

Ez nem cáfolja a negatív kontroll első, helyes eredményét, és nem alkalmazás-/deploy-blokkoló. A javított harness normál futásában nem jelentkezett; a teszt hibás ága nincs rendesen lezárva.

## Szűk javítás és elfogadás

Mentsd el a törzs pillanatnyi értékét közvetlenül a release után, majd az `allow` rendezése után állíts ezen a **korábban elmentett** értéken; vagy használd a megfelelő `try/finally`-t. Ha csak az állítás előtti várakozást növeled és utána újraolvasod a törzset, a negatív kontroll elveszti az értelmét.

Elfogadás: helyes harness → zöld; régi URL-számláló → `undefined` miatt piros, további bezárt-lap hiba/kezeletlen rejection nélkül. A második, két azonos URL-ű válasz tesztje is maradjon hiteles. Külön teszt-only commit.
