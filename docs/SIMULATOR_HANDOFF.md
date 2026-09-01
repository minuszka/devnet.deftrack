# Simulator fejlesztési handoff

Aktuális nap/fázis: 2. nap kész – tiszta persistent run state machine domainréteg

Aktuális branch: `feat/devnet-chaos-orchestrator`

Előző napi commit: `da19182 docs: design devnet simulator control plane`

## Elkészült

- A devnet explorer meglévő admin-, experiment-, operator- és observer-rétegének célzott auditja.
- A külön `SimulationRun` és append-only `SimulationAction` vezérlési réteg megtervezése.
- Az `ExperimentRun` megtartása stabil mérési/eredmény rétegként.
- A public read-only, admin control, orchestrator worker és observer jogosultságok szétválasztása.
- Konkrét TypeScript interface- és API-vázlat, state machine, lease/idempotencia és recovery szabályok.
- Privát target-regiszter és public/private DTO-elválasztás terve.
- Újrahasználati térkép a jelenlegi explorer és a Core-native Docker/netem/regtest szimulátor elemeihez.
- Fenyegetési modell, mainnet hard-disable, TTL/watchdog és pilot előtti támadási tesztlista.
- A roadmap 2. napi állapotgép-sorának összehangolása a végleges 1. napi tervvel.
- Tiszta `SimulationRunState` állapotgép minden engedélyezett és tiltott átmenettel.
- Persistálható revision, timestamp, teljes run deadline és fault lease; nincs process-local timer mint igazságforrás.
- Restart/reconcile döntési réteg, amely lejárat vagy félbeszakadt abort után automatikusan recoverybe irányít.
- Sikertelen recovery után a fault bizonytalanul aktív marad és újrapróbálható.
- Determinisztikus, nyers idempotency adatot nem kiszivárogtató run/action azonosítók.
- Egyetlen aktív live experiment tiszta lock/lease logikája, explicit renew és owner-ellenőrzött release.
- A release revisiont növelő `released` tombstone-t hagy; így a Mongo CAS-rétegben nem alakulhat ki ABA-verseny a lock törlése és újralétrehozása miatt.
- Azonnali event retry valódi no-op; a teljes event-ID egyediséget a 3. napi append-only auditmodell biztosítja.

## Fő tervezési döntések

- Az explorer nem tárol fleet SSH-kulcsot. A privát jump hoston futó worker kifelé pollolja a szűk worker API-t.
- Nincs tetszőleges shell: kizárólag verziózott scenario registry és diszkriminált action union használható.
- Minden fault kötelező TTL-t, node-local watchdogot és idempotens cleanupot kap.
- Az observer read-only marad, és külön tokent használ.
- Egy időben legfeljebb egy élő, node-módosító experiment futhat.
- Mainnet nincs az engedélyezett hálózattípusban, és worker/wrapper oldalon is külön chain guard szükséges.
- A publikus API nem ad ki host-, unit-, port-, provider- vagy nyers infrastruktúra-hibainformációt.

## Módosított fájlok

- `docs/SIMULATOR_HANDOFF.md`
- `server/src/domain/simulationIdentity.ts`
- `server/src/domain/simulationIdentity.test.ts`
- `server/src/domain/liveRunLock.ts`
- `server/src/domain/liveRunLock.test.ts`
- `server/src/domain/simulationRunState.ts`
- `server/src/domain/simulationRunState.test.ts`

## Futtatott ellenőrzések és eredményük

- `git diff --check`: zöld.
- `npm run typecheck`: zöld a shared, server és client workspace-ben.
- `npm test`: zöld, 21 tesztfájl és 174 teszt sikeres.
- Új célzott state/identity/lock tesztek: 3 tesztfájl, 41 teszt sikeres.
- `npm run build`: zöld, a shared/server TypeScript build és a kliens Vite production build sikeres.

## Nyitott kérdések / későbbi döntések

- A runtime bemeneti sémához a szerverben már használt Zodot kell alkalmazni; strict, unknown-field reject kötelező.
- A böngészős admin session konkrét identity providerét a control UI előtt kell kiválasztani.
- Az SSH executor csak átmeneti megoldás; a mTLS node-agent későbbi külön döntés lehet.
- A target-regiszter tényleges fleet adatait nem szabad a publikus repóba commitolni.

## Következő pontos feladat – 3. nap

Kösd a tiszta domainréteget MongoDB persistenciához és append-only audithoz:

1. külön `SimulationRun`, `SimulationAction`, `SimulationAuditEvent`, `SimulationTarget` és `LiveRunLock` sémák;
2. CAS update a `revision` mezővel;
3. egyedi event/action/idempotency indexek;
4. append-only audit service, általános update/delete nélkül;
5. public/private mezők és retention/index döntések;
6. persistence service tesztek versenyhelyzetre, duplikációra és restart-reconcile-ra.

Ne készüljön még VPS executor, SSH-hívás, admin UI vagy valódi fault injection. A scenario registry és Zod request-sémák a 4. nap feladatai.

Külső állapot/VPS-művelet történt-e: nem

Aktív fault vagy recovery timer: nincs

Felhasználói jóváhagyás szükséges-e: a 3. napi helyi munkához nem; VPS pilot előtt igen
