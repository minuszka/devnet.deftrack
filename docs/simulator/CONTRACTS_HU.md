# Devnet Simulator – TypeScript adatszerződések

Állapot: **a megvalósult kód leírása**, 2026-09-05-én forráshoz ellenőrizve.
Eredetileg implementációs terv volt, és a megvalósítás több ponton elment tőle
— a scenario-azonosítók, a kockázati osztályok és az action-payload union mind
mást mondtak, mint a kód. Ahol a kettő eltért, a kód nyert, és a forrásfájl meg
van nevezve, hogy vissza lehessen ellenőrizni.

Az igazság forrása:
`server/src/simulator/scenarioTypes.ts`, `server/src/simulator/scenarioRegistry.ts`,
`server/src/domain/simulationRunState.ts`, `server/src/models/SimulationRun.ts`
és `server/src/models/SimulationAction.ts`. A biztonsági invariánsok nem
lazíthatók.

## Alapelv

A Control API nem fogad `command`, `script`, `args: string[]`, fájlútvonal vagy nyers hálózati szabály mezőt. A kliens csak egy regisztrált scenario azonosítóját és annak szigorúan validált paramétereit küldi.

Az API-bemenetekhez runtime séma is kötelező. A TypeScript típus önmagában nem validáció; az implementáció a szerverben már használt Zod sémákkal parse-oljon minden külső bemenetet `strict` módban, az ismeretlen mezőket elutasítva.

## Azonosítók és állapotok

```ts
type SimulationRunKey = string;   // szerver generálja
type SimulationActionId = string; // szerver generálja
type TargetId = string;           // privát registry stabil ID

type SimulationRunStatus =
  | 'draft'
  | 'preflight'
  | 'rejected'
  | 'scheduled'
  | 'baseline'
  | 'armed'
  // A dokumentumból hiányzott: az arm és a fault között van egy állapot,
  // amiben a run már aktiválható, de még nem aktív.
  | 'activation_pending'
  | 'fault_active'
  | 'observing'
  | 'aborting'
  | 'recovery'
  | 'cooldown'
  | 'completed'
  | 'aborted'
  | 'failed';

type SimulationActionStatus =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'compensated';

type SimulationNetwork = 'regtest' | 'devnet';

// A kockázati osztályok a kódban low/medium/high, nem green/yellow/red. A
// jóváhagyási kapu is ezekre a nevekre hivatkozik (CONTROL_API_HU.md), tehát a
// régi hármas nem szinonima volt, hanem egy nem létező skála.
type SimulationRiskClass = 'low' | 'medium' | 'high';
```

Mainnet szándékosan nem eleme a `SimulationNetwork` unionnek. Ettől függetlenül a workernek és a node-wrappernek is saját hálózati guardot kell végeznie.

## Scenario registry

A tervezett öt `snake_case` scenario helyett **nyolc** van, kebab-case
azonosítókkal, és a leíró is szűkebb, mint amit a terv rajzolt: a limitek nem
per-scenario mezők, hanem egy közös `SCENARIO_LIMITS` a registryben, a
validáció pedig zod-séma és nem `validate()` metódus.

```ts
// server/src/simulator/scenarioTypes.ts
const SIMULATION_SCENARIO_IDS = [
  'mn-stop',
  'host-outage',
  'quorum-member-outage',
  'staker-stop',
  'restart-flapping',
  'network-degradation',
  'node-isolation',
  'clear-recover',
] as const;

interface ScenarioDescriptor {
  scenarioId: SimulationScenarioId;
  version: number;
  title: string;
  description: string;
  riskClass: SimulationRiskClass;
}

// server/src/simulator/scenarioRegistry.ts
const SCENARIO_LIMITS = {
  maxTargets: 20,
  // BLOKKBAN kifejezve, aztán másodpercre váltva: hat blokk az a hossz, ami
  // minden illeszkedésnél nulla kihagyott DKG-ablakot garantál. Lásd
  // OUTAGE_WINDOWS_HU.md, mielőtt bárki hozzányúl.
  maxDurationSeconds: 6 * BLOCK_SECONDS,
  maxLatencyMs: 2_000,
  maxJitterMs: 1_000,
  maxPacketLossPercent: 30,
  maxFlapCycles: 5,
  maxStakers: 5,
  maxIsolatedTargets: 5,
};
```

Kockázati osztályok a registryből: `low` a `clear-recover`; `medium` az
`mn-stop` és a `staker-stop`; `high` a `host-outage`, a
`quorum-member-outage`, a `restart-flapping`, a `network-degradation` és a
`node-isolation`.

type TargetCapability =
  | 'service-control'
  | 'netem-p2p'
  | 'partition-p2p'
  | 'dsl-test-hook';
```

A registry szerveroldali kód, nem adatbázisból szerkeszthető script. A `version` bekerül a run snapshotjába, hogy később ugyanaz a futás rekonstruálható legyen.

## Scenario paraméterek

Zod-sémák, `strict` módban, discriminated union a `scenarioId`-n
(`simulationScenarioRequestSchema`). Minden kérés `scenarioVersion: 1`-et és egy
`seed`-et hordoz; a `targetIds` mindenhol opcionális azoknál, amelyek maguk
választanak célpontot, és kötelező a `clear-recover`-nél.

| scenario | paraméterek |
|---|---|
| `mn-stop` | `count`, `durationSeconds`, `targetIds?` |
| `host-outage` | `anchorTargetId`, `durationSeconds`, `expectedMasternodes?` |
| `quorum-member-outage` | `count`, `phase: 'dkg' \| 'chainlock'`, `durationSeconds`, `targetIds?` |
| `staker-stop` | `count` (max `maxStakers`), `durationSeconds`, `targetIds?` |
| `restart-flapping` | `role: 'masternode' \| 'staker'`, `count`, `cycles`, `downSeconds`, `upSeconds`, `targetIds?` |
| `network-degradation` | `role`, `count`, `durationSeconds`, `latencyMs`, `jitterMs`, `lossPercent`, `correlationPercent`, `targetIds?` |
| `node-isolation` | `count` (max `maxIsolatedTargets`), `durationSeconds`, `targetIds?` |
| `clear-recover` | `targetIds` |

Két szabály, ami a sémákban él és nem a prózában:

- **A `restart-flapping` `count`-ját kétszer korlátozza a séma**, mert staker
  szerepben más kísérlet: tíz masternode flappelése nem ugyanaz, mint öt
  stakeré, amiken a blokktermelés áll.
- **A `network-degradation` nem fogad `seed` szerepet.** A seed node az, ahonnan
  az explorer RPC- és ZMQ-bizonyítéka jön, tehát megrontani a *mérést* rontja
  meg, nem a mért hálózatot — és az eredmény hálózati leletnek látszana.

A tervben szereplő `dsl_signing_fault` scenario nem létezik. A `dsl-test-hook`
capability megmaradt a `SimulationTargetCapability` unionben, de egyetlen
scenario sem kéri.

## Target kiválasztás és snapshot

```ts
interface TargetSelectorInput {
  mode: 'explicit' | 'random-sample' | 'by-label';
  targetIds?: TargetId[];
  sampleSize?: number;
  labels?: string[];
}

interface PrivateTargetSnapshot {
  targetId: TargetId;
  displayLabel: string;
  operatorId?: string;
  proTxHash?: string;
  hostRef: string;
  unitRef: string;
  p2pPort: number;
  role: 'masternode' | 'staker' | 'seed';
  network: SimulationNetwork;
  capabilities: TargetCapability[];
  expectedBuild?: string;
  capturedAt: string;
  capturedAtHeight: number;
}

interface PublicTargetSnapshot {
  targetId: TargetId;
  displayLabel: string;
  role: PrivateTargetSnapshot['role'];
  proTxHash?: string;
}
```

A publikus DTO-ból hiányzik a `hostRef`, `unitRef`, port, provider és minden olyan adat, amely az infrastruktúrát támadhatóbbá teszi.

## Run rekord

```ts
interface SimulationRunDocument {
  runKey: SimulationRunKey;
  revision: number;
  status: SimulationRunStatus;
  network: SimulationNetwork;
  scenarioId: ScenarioId;
  scenarioVersion: number;
  parameters: ScenarioParameters;
  seed: string;

  targetSnapshot: PrivateTargetSnapshot[];
  experimentRunKey?: string;
  baselineRunKey?: string;

  requestedBy: AuditActor;
  approvedBy?: AuditActor;
  requestedAt: Date;
  approvedAt?: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  faultActivatedAt?: Date;
  recoveryStartedAt?: Date;
  recoveredAt?: Date;
  completedAt?: Date;

  startHeight?: number;
  faultActivationHeight?: number;
  recoveryHeight?: number;
  endHeight?: number;

  preflight: PreflightResult[];
  recovery: RecoverySummary;
  failure?: SanitizedFailure;
  dataQuality?: DataQualitySnapshot;

  createdAt: Date;
  updatedAt: Date;
}

interface AuditActor {
  actorId: string;
  actorType: 'admin-session' | 'orchestrator' | 'system';
  displayName?: string;
}
```

`targetSnapshot`, `scenarioVersion`, `parameters`, `seed` és `network` az approval után immutable. A státuszváltásokat dedikált service végzi; közvetlen általános PATCH nincs.

## Preflight és data quality

```ts
type CheckSeverity = 'required' | 'warning';

interface PreflightResult {
  checkId:
    | 'network-is-devnet'
    | 'worker-online'
    | 'target-resolved'
    | 'target-build-match'
    | 'observer-fresh'
    | 'chain-synced'
    | 'quorum-stable'
    | 'no-active-live-run'
    | 'wrapper-version-match'
    | 'recovery-clean';
  severity: CheckSeverity;
  passed: boolean;
  checkedAt: Date;
  publicMessage: string;
  privateDetail?: string;
}

interface DataQualitySnapshot {
  observerCoveragePercent: number;
  staleTargetCount: number;
  explorerLagBlocks: number;
  missingHeights: number[];
  confidence: 'high' | 'medium' | 'low';
}
```

Required check hibája esetén a run `rejected`. Warning esetén elindítható, de a publikus eredményen látszania kell a kisebb mérési bizalomnak.

## Action és lease

A payload **nem hordoz unit-nevet.** A tervben `service-stop` és
`service-start` is `unitRef`-et vitt; a megvalósításban egyik sem, mert az
action a célpont logikai azonosítójára hivatkozik, és a unit nevét kizárólag a
privát registry ismeri. Ezt teszt is őrzi: `dryRunExecutor.test.ts` a
szerializált payloadokban elutasít mindent, ami `hostRef`, `unitRef`, `command`,
`script` vagy útvonal-szerű.

A `ttlSeconds` neve `faultLeaseSeconds`, és a netem mezői kötelezőek, nem
opcionálisak — egy hiányzó `lossPercent` nem „nulla veszteség", hanem egy
kérdés, amit senki nem tett fel.

```ts
// server/src/simulator/scenarioTypes.ts
type PlannedActionPayload =
  | { kind: 'service-stop'; faultLeaseSeconds: number }
  | { kind: 'service-start' }
  | {
      kind: 'netem-apply';
      interfaceRef: 'devnet-p2p';
      latencyMs: number;
      jitterMs: number;
      lossPercent: number;
      correlationPercent: number;
      faultLeaseSeconds: number;
    }
  | {
      kind: 'partition-apply';
      p2pPortRef: 'devnet-p2p';
      peerTargetIds: string[];
      faultLeaseSeconds: number;
    }
  | { kind: 'fault-clear'; scope: 'run' };

interface PlannedSimulationAction {
  actionId: string;
  runKey: string;
  sequence: number;
  targetId: string;
  kind: PlannedActionPayload['kind'];
  payload: PlannedActionPayload;
  /** A payload tartalmi ujjlenyomata: két azonos akció ugyanaz az akció. */
  payloadDigest: string;
  notBeforeOffsetMs: number;
  expiresAfterMs: number;
  maxAttempts: number;
}
```

A tervben szereplő `dsl-test-hook` payload nem létezik.

Az actionön nincs nyers parancs. A `unitRef` és `interfaceRef` szintén registry-azonosító; a worker/node-wrapper oldja fel fix helyi allowlistből.

## Recovery

```ts
interface RecoveryTargetResult {
  targetId: TargetId;
  faultStateClear: boolean;
  expectedServiceRunning: boolean;
  observerFresh: boolean;
  checkedAt: Date;
  privateDetail?: string;
}

interface RecoverySummary {
  required: boolean;
  startedAt?: Date;
  finishedAt?: Date;
  targets: RecoveryTargetResult[];
  allClear: boolean;
}
```

Az `allClear` értéke számított mező. A run nem zárható `completed` állapotba, ha bármely célon maradt fault state vagy elvárt daemon nem fut.

## API-vázlat

### Publikus, kizárólag olvasás

```text
GET /api/v1/simulations
GET /api/v1/simulations/:runKey
GET /api/v1/simulations/:runKey/timeline
GET /api/v1/simulations/scenarios
```

### Admin control

```text
POST /api/v1/admin/simulations/drafts
POST /api/v1/admin/simulations/:runKey/preflight
POST /api/v1/admin/simulations/:runKey/approve
POST /api/v1/admin/simulations/:runKey/start
POST /api/v1/admin/simulations/:runKey/abort
POST /api/v1/admin/simulations/:runKey/retry-recovery
GET  /api/v1/admin/simulations/:runKey
```

Minden módosító kéréshez session, CSRF és idempotency key kell. Nincs általános run-PATCH és nincs status mezőt közvetlenül beállító végpont.

### Orchestrator worker

```text
POST /api/v1/orchestrator/heartbeat
POST /api/v1/orchestrator/actions/claim
POST /api/v1/orchestrator/actions/:actionId/renew
POST /api/v1/orchestrator/actions/:actionId/result
POST /api/v1/orchestrator/runs/:runKey/recovery-report
```

A worker-token csak ezekre a végpontokra érvényes. Nem használható admin route-on, observer ingestként vagy publikus adatok bővebb lekérésére.

## Adatbázis-index terv

Indexet csak valós query és `explain("executionStats")` után véglegesítsünk. Kiinduló jelöltek:

```ts
SimulationRun:    { runKey: 1 } unique
SimulationRun:    { status: 1, scheduledAt: 1 }
SimulationRun:    { createdAt: -1 }
SimulationAction: { actionId: 1 } unique
SimulationAction: { status: 1, notBefore: 1, leaseUntil: 1 }
SimulationAction: { runKey: 1, sequence: 1 } unique
TargetRegistry:   { targetId: 1 } unique
```

## Publikus redakció

A public DTO csak az alábbiakat adja vissza:

- scenario név és verzió;
- publikus, biztonságos paraméterek;
- target címkék/proTx azonosítók, ha azok már eleve publikusak;
- állapot és idővonal;
- chain-height mérföldkövek;
- preflight publikus üzenetei;
- aggregált recovery és data-quality eredmény;
- kapcsolt `ExperimentRun` eredmény.

Nem kerülhet ki worker ID, host/IP, unit, provider, token, SSH-hiba, lokális fájlútvonal, nyers stderr vagy belső stack trace.

## Kötelező invariáns tesztek

- Ismeretlen `scenarioId`, extra mező vagy határértéken kívüli paraméter 4xx választ ad.
- Mainnet érték minden rétegben elutasított.
- Azonos idempotency key nem hoz létre két runt/actiont.
- Két élő run közül legfeljebb egy juthat `baseline` állapotba.
- Lejárt claim újra kiosztható, a wrapper mégsem alkalmazza kétszer a faultot.
- Abort és worker-crash után is recovery actionök készülnek.
- Privát target mező egyetlen public DTO-ban sem jelenik meg.
- `completed` nem érhető el `recovery.allClear === true` nélkül.
