# X1 — P2: a kezdeti párhuzamos olvasás elveszíti a 401-et egy másik olvasás hibája után

Vizsgált állapot: `eb767738f022277ad984275fe53e527e78707261`. **W2 megmaradt esete**, nem új szerveroldali auth-megkerülés.

Hely: `client/src/components/dd-admin-shell.ts:595–610`, továbbá `:871–902`.

## Reprodukció

1. `/admin?run=A`, működő session/dashboard; a futamra adott válasz sikeres.
2. A kezdeti history GET **503**-at ad. A recovery GET válaszát visszatartjuk.
3. Miután a history hibás törzsét a kliens elolvasta, elengedjük a recovery **401** válaszát.
4. Elvárt: session-lejárat, belépési felület, a privát vezérlők eltűnnek.
5. Tényleges: a belépési felület nem jelenik meg; a korábbi, 503-as betöltési hiba marad a privát felületen.

A dry-run GET 503-ával, sikeres history mellett ugyanez reprodukálható. A két ellenpróba az [extra.spec.ts](extra.spec.ts) X1 esete; [eredmény](extra.txt): két működési állítás bukik. Az óra megállított; a hiba nincs a következő 30 másodperces dashboard-poll által elfedve. A 401 törzsének elolvasását a javított ResponseGate várja meg. A pageerror-lista ekkor üres: nem kezeletlen rejection miatt marad nyitva a felület.

## Ok és javítás

A `_loadHistory()` három kérése `Promise.all`-ban fut. A history vagy dry-run 503-a elutasítja az egész Promise-t; a `_loadSelectedRun()` általános hibaága kezeli. A később visszatérő `readEvidence()` már csak a korábban elutasított Promise egyik eredménye: a `recovery.sessionEnded` ellenőrzéshez a végrehajtás nem jut el.

**Szűk javítás:** a kezdeti olvasás eredményeit úgy gyűjtsd/kezeld, hogy egyik szükséges kérés hibája se nyelje el a másik 401-ét. Például minden olvasás tipizált eredményt adhat, vagy `allSettled` után lehet az eredményeket minősíteni. A kiválasztási/session-generáció ellenőrzése előzze meg a session lezárását. Egy 503 önmagában továbbra sem logout; a V1 által megőrzött aktuális futamot és abortot se törölje.

## Elfogadás

- Mindkét X1 ellenpróba zöld, valamint a 401 előbb / társ-kérés hibája később sorrend is lefedett.
- Kezdeti history/dry-run 401 és recovery-401; aktuális futam frissítése és csak olvasó retry továbbra is lezárja a sessiont.
- Elhagyott A késői 401-e nem zárja le B-t, terv nélküli B esetén sem.
- 503 + sikeres recovery nem logout; a tervtől független abort elérhető marad, ha a futam már ismert.
- Nincs kezeletlen rejection; a read-again továbbra is csak GET.

Egy külön commit, admin shell és célzott run-status tesztek. Szerver-auth, CSRF, Core, lease/lock és idempotencia-védelem módosítása nem szükséges.
