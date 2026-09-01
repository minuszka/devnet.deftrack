# Simulator fejlesztési handoff

Aktuális nap/fázis: 3. nap kész – Mongo persistencia, CAS és append-only audit

Aktuális branch: `feat/devnet-chaos-orchestrator`

Előző napi commit: `a10f0bb feat: add persistent simulation run state machine`

## Elkészült

### 1–2. napi alap

- Külön orchesztrációs és `ExperimentRun` mérési réteg.
- Public read-only, admin control, worker és observer bizalmi határok.
- Típusos scenario/action terv, threat model és mainnet hard-disable.
- Tiszta `SimulationRunState` reducer, timeout/recovery és restart-reconcile.
- Determinisztikus run/action azonosítók.
- Egyetlen live run lock/lease logika revisiont megőrző tombstone release-zel.

### 3. napi persistencia

- `SimulationRun` projekció immutable metadata- és privát target snapshottal.
- `SimulationAction` projekció determinisztikus ID-val, claim lease-zel és revisionnel.
- Privát `SimulationTarget` registry; új target alapból disabled.
- `SimulationLiveRunLock` singleton és valódi Mongo CAS adapter.
- Append-only `SimulationAuditEvent` run/action stream, update/replace/delete middleware-tiltással.
- Standalone MongoDB-kompatibilis event-first/CAS algoritmus, replica-set tranzakció nélkül.
- Audit insert és projection update közti process-crash automatikus javítása.
- Hiányzó run projekció teljes újraépítése az auditfolyamból.
- Audit replay minden eseményt újrafuttat a domain reduceren/reconcile-on; nem bízik meg vakon a snapshotban.
- Event ID/payload, create metadata/live/deadline és revision konkurencia-konfliktusok felismerése.
- Persistált live lock service acquire/renew/release CAS retryjal és ABA-védelemmel.
- Kötelező index-inicializáló kapu; a controller unique indexek nélkül nem fogadhat create/start kérést.
- Retention- és indexdöntések dokumentálva; audit/run/action adatokon nincs TTL.

## Fő tervezési döntések

- A jelenlegi standalone Mongo telepítési mód támogatott; a helyesség nem függ `withTransaction()`-től.
- Az append-only audit az igazságforrás, a `SimulationRun` és később az action rekord gyors projekció.
- Egy revisionre a unique `{ stream, subjectId, sequence }` index választ egyetlen nyertes eseményt.
- A projekció csak `{ runKey, state.revision }` CAS feltétellel módosulhat.
- Projekció-audit eltérésnél a rendszer fail closed; nem gyárt utólag kitalált auditot.
- A target host/unit/port privát marad, és nincs még hozzá public vagy control route.
- Nincs SSH, Docker, VPS-hozzáférés vagy valódi hibainjektálás.

## A 3. napon módosított fájlok

- `docs/SIMULATOR_HANDOFF.md`
- `docs/simulator/PERSISTENCE_HU.md`
- `server/src/domain/simulationAudit.ts`
- `server/src/domain/simulationAudit.test.ts`
- `server/src/models/SimulationRun.ts`
- `server/src/models/SimulationAction.ts`
- `server/src/models/SimulationAuditEvent.ts`
- `server/src/models/SimulationTarget.ts`
- `server/src/models/SimulationLiveRunLock.ts`
- `server/src/models/simulationModels.test.ts`
- `server/src/services/simulationPersistence.service.ts`
- `server/src/services/simulationPersistence.service.test.ts`
- `server/src/services/simulationMongo.repository.ts`
- `server/src/services/simulationLiveRunLock.service.ts`
- `server/src/services/simulationLiveRunLock.service.test.ts`

## Futtatott ellenőrzések és eredményük

- `git diff --check`: zöld.
- `npm run typecheck`: zöld a shared, server és client workspace-ben.
- `npm test`: zöld, 25 tesztfájl és 200 teszt sikeres.
- Új audit/model/persistence/lock tesztek: 4 tesztfájl és 26 teszt sikeres.
- `npm run build`: zöld, a shared/server TypeScript build és a kliens Vite production build sikeres.

## Nyitott kérdések / későbbi döntések

- A day-4 scenario registry Zoddal váltja ki a jelenlegi belső `Mixed` parameter/payload tárolás előtti bizalmi feltételezést.
- A worker action reducer és claim API későbbi nap; az action projekció és append-only eventtípusok már készen állnak.
- Az append-only middleware alkalmazásszintű védelem; adatbázis-admin elleni védelemhez külön Mongo role és backup policy kell.
- A böngészős admin session identity providerét a control UI előtt kell kiválasztani.
- A target-regiszter tényleges fleet adatait nem szabad a publikus repóba commitolni.

## Következő pontos feladat – 4. nap

Implementáld a zárt scenario registryt és a kizárólag tervet készítő DryRun executort:

1. erős, `strict()` Zod sémák és unknown-field reject;
2. első scenario-k: egy/N MN, teljes host, quorumtagok, staker, flapping, latency/jitter/loss, izoláció és clear/recover;
3. biztonsági limitek target-számra, időtartamra, latencyre és packet lossra;
4. determinisztikus célpontválasztás seeddel;
5. allowlistelt `SimulationAction` terv és payload digest;
6. hatásbecslés, blast radius és a Core-native szimulátor eredményeire mutató adapter;
7. bizonyítani teszttel, hogy a DryRun semmilyen külső állapotot nem módosít.

Ne készüljön még VPS executor, SSH-hívás, admin UI vagy valódi fault injection.

Külső állapot/VPS-művelet történt-e: nem

Aktív fault vagy recovery timer: nincs

Felhasználói jóváhagyás szükséges-e: a 4. napi helyi munkához nem; VPS pilot előtt igen
