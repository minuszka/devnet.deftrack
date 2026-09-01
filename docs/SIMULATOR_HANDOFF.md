# Simulator fejlesztési handoff

Aktuális nap/fázis: 1. nap kész – audit, architektúra, adatszerződések és fenyegetési modell

Branch és kiinduló HEAD: `feat/devnet-chaos-orchestrator` @ `8a644cd`

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

## Fő tervezési döntések

- Az explorer nem tárol fleet SSH-kulcsot. A privát jump hoston futó worker kifelé pollolja a szűk worker API-t.
- Nincs tetszőleges shell: kizárólag verziózott scenario registry és diszkriminált action union használható.
- Minden fault kötelező TTL-t, node-local watchdogot és idempotens cleanupot kap.
- Az observer read-only marad, és külön tokent használ.
- Egy időben legfeljebb egy élő, node-módosító experiment futhat.
- Mainnet nincs az engedélyezett hálózattípusban, és worker/wrapper oldalon is külön chain guard szükséges.
- A publikus API nem ad ki host-, unit-, port-, provider- vagy nyers infrastruktúra-hibainformációt.

## Módosított fájlok

- `docs/SIMULATOR_IMPLEMENTATION_ROADMAP_HU.md`
- `docs/SIMULATOR_HANDOFF.md`
- `docs/simulator/ARCHITECTURE_HU.md`
- `docs/simulator/CONTRACTS_HU.md`
- `docs/simulator/THREAT_MODEL_HU.md`

## Futtatott ellenőrzések és eredményük

- `git diff --check`: zöld.
- Dokumentációs konzisztencia-ellenőrzés: az állapotnevek összehangolva.
- `npm run typecheck`: zöld a shared, server és client workspace-ben.
- `npm test`: zöld, 18 tesztfájl és 133 teszt sikeres.
- `npm run build`: zöld, a shared/server TypeScript build és a kliens Vite production build sikeres.

## Nyitott kérdések / későbbi döntések

- A runtime bemeneti sémához a szerverben már használt Zodot kell alkalmazni; strict, unknown-field reject kötelező.
- A böngészős admin session konkrét identity providerét a control UI előtt kell kiválasztani.
- Az SSH executor csak átmeneti megoldás; a mTLS node-agent későbbi külön döntés lehet.
- A target-regiszter tényleges fleet adatait nem szabad a publikus repóba commitolni.

## Következő pontos feladat – 2. nap

Implementáld és unit teszteld a tiszta, persistent run state machine domainréteget:

1. érvényes és tiltott állapotátmenetek;
2. optimista `revision` kezelés;
3. idempotens run/action azonosítók;
4. egyszerre egy aktív live experiment lock;
5. process restart utáni folytatás;
6. timeout mindig `recovery` állapotba vezessen.

Ne készüljön még VPS executor, SSH-hívás, admin UI vagy valódi fault injection.

Külső állapot/VPS-művelet történt-e: nem

Aktív fault vagy recovery timer: nincs

Felhasználói jóváhagyás szükséges-e: a 2. napi helyi munkához nem; VPS pilot előtt igen
