Aktuális nap/fázis: 6. nap kész – admin Control API és CLI, végrehajtás nélkül
Branch és HEAD: `feat/simulator-control-api-day6` – `feat: add simulator control API and CLI`
Elkészült: privát create/validate/dry-run/arm/start/abort/recover/status/history API; minden módosításhoz idempotency; append-only control request és artifact; Mongo/RPC evidence assembler; szerveroldali operator/safety-admin risk-kapu; kötelező publikus mezőprojekció és DTO-redakció; tervből származtatott run-expiry; nem felülírható baseline policy; null hostRef fail-closed; fejlesztői CLI és teljes `dry-lifecycle` parancs; admin rate limit és nem-böngészős, később CSRF-adapterrel bővíthető szerződés
Módosított fájlok: `.env.example`; `docs/SIMULATOR_IMPLEMENTATION_ROADMAP_HU.md`; `docs/SIMULATOR_HANDOFF.md`; `docs/simulator/CONTROL_API_HU.md`; `server/package.json`; simulator policy/timing/approval/public DTO/target/preflight/state fájlok és tesztjeik; simulation persistence/control/evidence service-ek és Mongo modellek; privát és publikus v1 route-ok; CLI
Futtatott tesztek és eredményük: `npm run typecheck && npm test && npm run build` zöld; 37 tesztfájl, 265 teszt; shared/server/client typecheck és production build sikeres
Nyitott hibák: ismert kódhiba nincs; live start és live recovery szándékosan fail-closed a 8. napi lease-es executor elkészültéig
Következő pontos feladat: 7. nap – mérési és összehasonlító pipeline; a 13. napi VPS pilot előtt külön felhasználói jóváhagyás szükséges
Külső állapot/VPS-művelet történt-e: nem
Aktív fault vagy recovery timer: nincs
Felhasználói jóváhagyás szükséges-e: a 7. napi lokális munkához nem; bármilyen VPS-művelethez és a 13. napi pilothoz igen
