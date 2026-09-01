# Devnet Simulator – TypeScript adatszerződések

Állapot: implementációs terv. A nevek még kód-review során finomíthatók, de a biztonsági invariánsok nem lazíthatók.

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
type RiskClass = 'green' | 'yellow' | 'red';
```

Mainnet szándékosan nem eleme a `SimulationNetwork` unionnek. Ettől függetlenül a workernek és a node-wrappernek is saját hálózati guardot kell végeznie.

## Scenario registry

```ts
type ScenarioId =
  | 'service_restart'
  | 'network_latency'
  | 'packet_loss'
  | 'provider_partition'
  | 'dsl_signing_fault';

interface ScenarioDefinition<TParams extends ScenarioParameters> {
  id: ScenarioId;
  version: number;
  displayName: string;
  description: string;
  riskClass: RiskClass;
  allowedNetworks: readonly SimulationNetwork[];
  requiredCapabilities: readonly TargetCapability[];
  minTargets: number;
  maxTargets: number;
  maxDurationSeconds: number;
  requiresExplicitApproval: boolean;
  validate(params: unknown): TParams;
  plan(context: PlanningContext, params: TParams): PlannedAction[];
}

type TargetCapability =
  | 'service-control'
  | 'netem-p2p'
  | 'partition-p2p'
  | 'dsl-test-hook';
```

A registry szerveroldali kód, nem adatbázisból szerkeszthető script. A `version` bekerül a run snapshotjába, hogy később ugyanaz a futás rekonstruálható legyen.

## Scenario paraméterek

```ts
interface BaseScenarioParameters {
  durationSeconds: number;
  seed: string;
}

interface ServiceRestartParameters extends BaseScenarioParameters {
  scenarioId: 'service_restart';
  downtimeSeconds: number;
  restartMode: 'simultaneous' | 'staggered';
  staggerSeconds?: number;
}

interface NetworkLatencyParameters extends BaseScenarioParameters {
  scenarioId: 'network_latency';
  latencyMs: number;
  jitterMs: number;
  correlationPercent: number;
}

interface PacketLossParameters extends BaseScenarioParameters {
  scenarioId: 'packet_loss';
  lossPercent: number;
  correlationPercent: number;
}

interface ProviderPartitionParameters extends BaseScenarioParameters {
  scenarioId: 'provider_partition';
  split: 'balanced' | 'by-provider';
}

interface DslSigningFaultParameters extends BaseScenarioParameters {
  scenarioId: 'dsl_signing_fault';
  behavior: 'skip-signing' | 'delay-signing' | 'invalid-test-signature';
  delayMs?: number;
  epochCount: number;
}

type ScenarioParameters =
  | ServiceRestartParameters
  | NetworkLatencyParameters
  | PacketLossParameters
  | ProviderPartitionParameters
  | DslSigningFaultParameters;
```

Kezdeti biztonságos limitek – konfigurációból csak szigoríthatók, lazításuk kód-reviewt igényel:

- `durationSeconds`: legfeljebb 15 perc;
- `downtimeSeconds`: legfeljebb 5 perc;
- `latencyMs`: legfeljebb 2000 ms;
- `jitterMs`: legfeljebb 1000 ms;
- `lossPercent`: legfeljebb 30%;
- `correlationPercent`: 0–100%;
- `epochCount`: kezdetben legfeljebb 2;
- `invalid-test-signature`: csak erre fordított devnet test hookkal, külön piros jóváhagyással.

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

```ts
type ActionPayload =
  | { kind: 'service-stop'; unitRef: string; ttlSeconds: number }
  | { kind: 'service-start'; unitRef: string }
  | {
      kind: 'netem-apply';
      interfaceRef: 'devnet-p2p';
      latencyMs?: number;
      jitterMs?: number;
      lossPercent?: number;
      correlationPercent?: number;
      ttlSeconds: number;
    }
  | {
      kind: 'partition-apply';
      peerTargetIds: TargetId[];
      p2pPortRef: 'devnet-p2p';
      ttlSeconds: number;
    }
  | { kind: 'fault-clear'; scope: 'run' }
  | {
      kind: 'dsl-test-hook';
      behavior: DslSigningFaultParameters['behavior'];
      delayMs?: number;
      epochCount: number;
      ttlSeconds: number;
    };

interface SimulationActionDocument {
  actionId: SimulationActionId;
  runKey: SimulationRunKey;
  sequence: number;
  targetId: TargetId;
  status: SimulationActionStatus;
  payload: ActionPayload;
  notBefore?: Date;
  expiresAt: Date;

  attempts: number;
  maxAttempts: number;
  claimedBy?: string;
  leaseUntil?: Date;
  claimedAt?: Date;
  executedAt?: Date;

  result?: ActionResult;
  createdAt: Date;
  updatedAt: Date;
}

interface ActionResult {
  code:
    | 'applied'
    | 'already-applied'
    | 'cleared'
    | 'already-clear'
    | 'guard-rejected'
    | 'target-unreachable'
    | 'wrapper-failed';
  publicMessage: string;
  privateDetail?: string;
  wrapperVersion?: string;
  finishedAt: Date;
}
```

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
