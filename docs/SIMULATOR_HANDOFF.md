# Simulator fejlesztési handoff

Aktuális fázis: 4. nap kész – zárt scenario registry és mellékhatásmentes DryRun

Aktuális branch: `feat/devnet-chaos-orchestrator`

Előző napi commit: `67d3c25 feat: persist simulation runs with append-only audit`

## Elkészült az 1–3. napon

- Orchesztrációs és mérési réteg szétválasztása, bizalmi határok és mainnet hard-disable terv.
- Tiszta run state machine, timeout/recovery/restart reconcile és determinisztikus run/action ID.
- Egyetlen live run lock revisiont megőrző tombstone release-zel.
- Standalone MongoDB-kompatibilis event-first, CAS-alapú persistencia.
- Append-only audit mint igazságforrás; run/action gyors projekciók és audit replay.
- Privát, alapból disabled target registry; host/unit/port nem public adat.
- Kötelező correctness indexek és indulási index-kapu.

## Elkészült a 4. napon

- Nyolc scenario zárt, verziózott registryje és minden szinten `strict()` Zod validáció.
- Biztonsági limitek célpontszámra, futási időre, flappingre, latencyre, jitterre és packet lossra.
- DKG `-16/-17`, ChainLock `-19/-20`, 10 MN-es host és staker presetek.
- Seedelt, sorrendfüggetlen SHA-256 targetválasztás explicit targetlista támogatásával.
- Kizárólag memóriában működő `generateDryRunPlan()`, repository/RPC/SSH/Docker/clock dependency nélkül.
- Kód által előállított allowlist payload union; nincs tetszőleges command, script, path, host vagy unit.
- Stabil action ID, canonical payload digest és teljes plan fingerprint.
- Blast-radius és Q60 `44/41` küszöbmargó becslés az átadott aktuális quorum snapshot alapján.
- Core-native szimulátor adapter: csak eredménycsaládokra/artifactokra hivatkozik, nem számol újra.
- Staker scenario korrektül `not-modeled`; nincs hamis Core-szimulációs állítás.
- Tesztek az összes scenario-ra, limitekre, presetekre, determinisztikára, privátadat-szivárgásra és input-változatlanságra.

## Fő 4. napi döntések

- A DryRun nem kapott repository vagy executor interfészt sem: így szerkezetileg sem tud külső állapotot módosítani.
- A `host-10-masternodes` preset az aktuális snapshotban pontosan 10 MN-t követel; drift esetén nem készül terv.
- A quorumtag-scenario kizárólag az átadott aktuális quorumtagságból választhat.
- A Q60 margin csak ismert quorum snapshotnál jelenik meg; hiányzó tagságnál `null` és warning lesz.
- A fault lease minden alkalmazó payload része, de tényleges watchdog/cleanup csak a worker fázisban készül.
- Az action idők a run kezdetéhez viszonyított offsetek; perzisztens abszolút `notBeforeMs/expiresAtMs` képzés későbbi service feladata.

## 4. napi fájlok

- `docs/simulator/SCENARIOS_HU.md`
- `docs/SIMULATOR_HANDOFF.md`
- `server/src/simulator/scenarioTypes.ts`
- `server/src/simulator/scenarioRegistry.ts`
- `server/src/simulator/targetSelection.ts`
- `server/src/simulator/coreSimulatorAdapter.ts`
- `server/src/simulator/dryRunExecutor.ts`
- a három kapcsolódó `*.test.ts` fájl

## Következő pontos feladat – 5. nap

Implementáld a preflightot és az élő, privát target resolutiont úgy, hogy továbbra se legyen fault injection:

1. enabled/maintenance/network/build/capability ellenőrzés a `SimulationTarget` registryből;
2. friss chain tip, observer és aktuális quorum snapshot lekérése;
3. host- és provider-blast-radius ellenőrzés, stale snapshot tiltás;
4. célpont snapshot rögzítése a run immutable metadata részébe;
5. DryRun terv és preflight eredmény persistálása append-only audit mellett;
6. fail-closed döntés required check hibánál;
7. továbbra se készüljön SSH/Docker/systemd/tc végrehajtás.

Külső állapot/VPS-művelet történt-e: nem

Aktív fault vagy recovery timer: nincs

Felhasználói jóváhagyás szükséges-e: az 5. napi lokális, nem végrehajtó munkához nem; VPS pilot előtt igen
