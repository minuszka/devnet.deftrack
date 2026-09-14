# P3 – A produkciós pool-default kikapcsolását nem jelzik a PR tesztjei

Nem blokkolja a #181 telepítését. A jelenlegi kód helyes alapértékét saját ellenőrzés igazolta.

Érintett hely: `server/src/services/rpc.service.ts:53`, valamint `server/src/services/rpc.keepalive.test.ts:102`. A keep-alive tesztek minden példánynál explicit `idleSocketMs` értéket adnak; a másik tesztfájl mockolja az axios klienst.

Saját ellenpélda: a `DEFAULT_IDLE_SOCKET_MS` értékét kizárólag a tesztfolyamat memóriájában 15 000-ről 0-ra változtattam. Mind a nyolc meglévő célzott teszt sikeres maradt, noha az éles default így kikapcsolná a védelmet. A `missing-default.log` és `negative-controls.json` rögzíti az eredményt.

Javasolt elfogadási feltétel egy követő teszt-PR-hez: külön timeout-felülírás nélkül ellenőrizze a fő és peer példány 15 000 ms Agent-defaultját, mindkét protokollhoz; közben igazolja a kérés-timeout változatlanságát. A hibás default mellett bukjon. A review saját `defaults.test.ts` tesztje ezt már demonstrálja: eredetin sikeres, mutálton hibás (`own-default-results.json`). Az alkalmazáskódhoz nem nyúltam.
