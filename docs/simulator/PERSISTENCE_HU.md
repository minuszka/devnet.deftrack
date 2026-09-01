# Devnet Simulator – persistencia és audit

Állapot: 3. napi implementációs döntés

## Miért nem Mongo-tranzakció

A jelenlegi környezet egyszerű `mongodb://127.0.0.1/...` kapcsolattal fut, replica-set követelmény nélkül. A simulator helyessége ezért nem épülhet `withTransaction()` használatára, mert az standalone MongoDB-n nem működne.

A megoldás event-source + projekció:

1. A változás először bekerül az append-only `SimulationAuditEvent` streambe.
2. A `(stream, subjectId, sequence)` unique index pontosan egy eseményt enged az adott következő revisionre.
3. Ezután a `SimulationRun` gyors projekciója `state.revision` CAS feltétellel frissül.
4. Ha a process a 2. és 3. lépés között leáll, restartkor az auditfolyam újrajátszása helyreállítja a projekciót.
5. Ha a projekció az audit előtt jár vagy azonos revision mellett eltér, a rendszer fail closed hibát ad.

Így nincs olyan pillanat, amikor egy már alkalmazott projekcióhoz biztosan elveszett az audit. Legfeljebb az audit jár átmenetileg előrébb, ami automatikusan javítható.

## Kollekciók

### `SimulationRun`

Gyors, változtatható projekció:

- immutable scenario-, network-, seed- és target snapshot;
- aktuális `SimulationRunState` és revision;
- preflight eredmények;
- recovery eredmények;
- data-quality snapshot;
- opcionális kapcsolat az `ExperimentRun` mérési rekordhoz.

Minden domain állapotfrissítés CAS-szal történik. Általános, status mezőt közvetlenül író update service nem készül.

### `SimulationAuditEvent`

Append-only igazságforrás run- és action-eseményekhez:

- run/event/subject azonosító;
- monoton sequence;
- request fingerprint;
- actor;
- előző és új státusz;
- az esemény utáni state snapshot;
- immutable run metadata kizárólag a creation eseményen.

A model query middleware-rel tiltja az update/replace/delete műveleteket. Ez alkalmazásszintű védelem; adatbázis-admin ellen külön MongoDB jogosultsági és backup-szabály szükséges.

Replay közben a rendszer nem bízik vakon a snapshotban: a normál eseményt újra lefuttatja a domain reduceren, a timeout/restart eseményt újra reconcile-olja, és byte-stabil canonical fingerprinttel hasonlítja össze az eredményt.

### `SimulationAction`

A worker számára optimalizált action projekció:

- determinisztikus `actionId`;
- runon belüli egyedi sequence;
- immutable target/kind/payload digest;
- claim lease, attempt és strukturált result;
- revision a későbbi action-CAS-hoz.

Az action audit eseménytípusok és a stream már definiáltak. A day-4 DryRun executor készíti majd az első action terveket; valódi worker-claim csak későbbi nap feladata.

### `SimulationTarget`

Privát végrehajtási registry. A `hostRef`, `unitRef` és port soha nem kerül public DTO-ba. Új target alapból `enabled=false`; külön admin jóváhagyás nélkül nem választható ki.

### `SimulationLiveRunLock`

Egyetlen `devnet-live` singleton. Release-kor nem törlődik, hanem revisiont növelő `released` tombstone lesz. Ez akadályozza meg, hogy egy régi CAS művelet egy később újralétrehozott, azonos revisionű lockot módosítson.

## Retention

Az első kiadásban nincs TTL a következő kollekciókon:

- `SimulationRun`;
- `SimulationAction`;
- `SimulationAuditEvent`;
- `SimulationTarget`;
- `SimulationLiveRunLock`.

Indok: egy kísérlet reprodukálhatósága és auditálhatósága fontosabb a kis tárhelynyereségnél. A run/action eseményszám korlátozott; a nagy volumenű node telemetry továbbra is a meglévő saját retention-politikáját követi.

Későbbi archiválás csak kétlépcsős lehet:

1. lezárt run teljes auditjának exportja és digestje;
2. csak ellenőrzött export után, külön admin művelettel történő archiválás.

Az aktív, recoveryben vagy `faultMayBeActive=true` állapotú run semmilyen retentionfolyam célpontja nem lehet.

## Indexek

Kötelező helyességi indexek:

- `SimulationRun.runKey` unique;
- `SimulationAction.actionId` unique;
- `SimulationAction { runKey, sequence }` unique;
- `SimulationAuditEvent { stream, subjectId, sequence }` unique;
- `SimulationAuditEvent { runKey, eventId }` unique;
- `SimulationTarget.targetId` unique;
- `SimulationLiveRunLock.scope` unique.

Kezdeti query indexek:

- run státusz + létrehozási idő;
- scenario + létrehozási idő;
- action claim: status + notBefore + leaseUntil;
- run + action status;
- target network + enabled + maintenance.

További index csak valós query és `explain("executionStats")` után kerülhet be. Az audit sequence és idempotency indexek nem teljesítmény-opciók, hanem a konkurencia-helyesség részei.

A controller indulásakor kötelező megvárni az `initializeSimulationPersistenceIndexes()` sikerét, mielőtt create/start kérést fogad. A unique indexek elkészülte nélkül a sequence/idempotency kizárás nem tekinthető aktívnak; indexhiba esetén a simulator control plane fail closed marad.

## Restart és hibaesetek

- Audit insert sikeres, projection CAS nem: `loadRun()` replayből javít.
- Két transition ugyanarra a revisionre: a unique sequence index egy nyertest választ; a vesztes újratölt vagy tiltott átmenettel leáll.
- Azonos event ID, más payload/deadline: `IDEMPOTENCY_CONFLICT`.
- Azonos create idempotency key, más metadata/live/deadline: `RUN_METADATA_CONFLICT`.
- Hiányzó projekció, meglevő audit: újraépül.
- Projekció audit előtt jár: fail closed; nincs találgatás vagy audit gyártása utólag.
- Audit gap vagy módosított snapshot/fingerprint: `AUDIT_DIVERGENCE`.

## Nem része a 3. napnak

- scenario registry és külső request Zod validáció;
- admin/public route-ok;
- worker claim API;
- SSH/Docker/VPS executor;
- valódi fault injection.
