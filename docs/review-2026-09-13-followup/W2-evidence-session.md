# W2 — P2: Recovery 401 nem zárja le a kliens sessiont

Alap: main@72fec82. Hely: `client/src/components/dd-admin-shell.ts:77–81,580–588,723–738`. A 401 korábban is elnyelődött; az új readEvidence helper sem választja el az átmeneti olvasási hibától.

Reprodukció: a dashboard, futam, terv és history 200; a recovery GET 401. A kliens a privát nézetben marad, „evidence could not be read” állapotot és olvasó retry-t kínál. Terminális futamnál a státuszpoll nem segít, a következő dashboard-frissítésig megmaradhat ez az állapot. In-flight kérések között lejáró session is előidézheti.

Határ: a teszt nem bizonyít szerveroldali auth-megkerülést. A már letöltött adat és a kliens session-nézete marad tévesen aktív.

Szűk javítás: a 401 maradjon meg külön eredményként, vagy jusson a session-lejárati kezelőhöz. Ezt **mind a kezdeti, mind az újraolvasási ágban**, a kiválasztás/session érvényességének ellenőrzésével kezeld. A refresh history `.catch(() => null)` ágát is vizsgáld át. Egy naivan továbbdobott, fire-and-forget Promise ne váljon kezeletlen rejectionné.

Elfogadás: a W2 zöld; külön kezdeti és gombos recovery-401; a késői, korábbi kiválasztáshoz tartozó válasz ne írjon hibás állapotot; a 503 továbbra is olvasási hiba és nem logout. A csak olvasó gomb továbbra sem küldhet mutációt. A meglévő V1 `/dry-run`-401 és V7 tesztek maradjanak zöldek.

Külön commit, admin shell és célzott E2E. A szerver auth/CSRF védelmét ne módosítsd a klienshiba megkerülésére.
