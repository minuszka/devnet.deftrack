import { describe, expect, it } from 'vitest';
import { planMeasurementWindows } from './measurementWindows.js';
import { evaluateSimulationPreflight, type SimulationPreflightInput } from './preflight.js';
import type { TargetInventoryResolution } from './targetResolver.js';
import { recoveryEvidenceFromHeartbeat } from './wrapperHeartbeat.js';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';

const NOW = 2_000_000;
const HEIGHT = 6_240;
const BUILD = 'a'.repeat(64);
const GENESIS = 'b'.repeat(64);

function inventory(): TargetInventoryResolution {
  return {
    network: 'devnet',
    capturedAtMs: NOW - 1_000,
    capturedAtHeight: HEIGHT,
    complete: true,
    issues: [],
    snapshots: ['mn-1', 'mn-2'].map((targetId, index) => ({
      targetId,
      displayLabel: targetId,
      operatorId: `operator-${index}`,
      proTxHash: String(index + 1).padStart(64, '0'),
      hostRef: `host-${index}`,
      unitRef: `unit-${index}`,
      p2pPort: 19_800 + index,
      role: 'masternode' as const,
      network: 'devnet' as const,
      capabilities: ['service-control' as const],
      expectedBuild: BUILD,
      capturedAtMs: NOW - 1_000,
      capturedAtHeight: HEIGHT,
    })),
  };
}

function healthyInput(): SimulationPreflightInput {
  const plan = planMeasurementWindows({ baselineEndHeight: HEIGHT, faultStartHeight: HEIGHT + 1, faultEndHeight: HEIGHT + 10 });
  return {
    nowMs: NOW,
    policy: {
      expectedChain: 'devnet-defcon-q60',
      expectedGenesisHash: GENESIS,
      expectedWrapperVersion: '1.0.0',
      maxExplorerLagBlocks: 2,
      maxExplorerAgeMs: 60_000,
      maxObserverAgeMs: 60_000,
      maxTargetSnapshotAgeMs: 60_000,
      minObserverCoveragePercent: 95,
      maxStaleTargets: 0,
      maxWorkerAgeMs: 30_000,
      expectedQuorumSize: 2,
    },
    chain: {
      chain: 'devnet-defcon-q60', genesisHash: GENESIS,
      blocks: HEIGHT, headers: HEIGHT, initialBlockDownload: false,
    },
    explorer: {
      indexedHeight: HEIGHT, lastSyncedAtMs: NOW - 1_000, syncError: null, missingHeights: [],
    },
    targetInventory: inventory(),
    selectedTargetIds: ['mn-1'],
    observer: {
      coveragePercent: 100, staleTargetCount: 0, lastObservationAtMs: NOW - 1_000, sequenceGapCount: 0,
    },
    conflicts: { otherLiveRunKeys: [], otherRunningExperimentKeys: [] },
    recovery: {
      required: true,
      workerLastSeenAtMs: NOW - 1_000,
      targets: [{ targetId: 'mn-1', available: true, faultStateClean: true, wrapperVersion: '1.0.0' }],
    },
    quorum: {
      required: true, stable: true, capturedAtHeight: HEIGHT, memberTargetIds: ['mn-1', 'mn-2'],
    },
    baseline: {
      required: true,
      plan,
      evidence: {
        fromHeight: plan.baseline.fromHeight,
        toHeight: plan.baseline.toHeight,
        indexedBlocks: plan.minimumBaselineBlocks,
        resolvedDkgRounds: plan.minimumBaselineDkgRounds,
        chainLockedBlocks: plan.minimumBaselineChainLocks,
        medianHealthRatio: 1,
        poseRevivedEvents: 0,
      },
    },
  };
}

describe('simulation preflight', () => {
  it('passes a complete devnet snapshot with one result per declared check', () => {
    const result = evaluateSimulationPreflight(healthyInput());
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(11);
    expect(result.checks.every((item) => item.passed)).toBe(true);
    expect(result.dataQuality.confidence).toBe('high');
  });

  it('fails closed on wrong genesis even when the chain name looks right', () => {
    const input = healthyInput();
    input.chain.genesisHash = 'c'.repeat(64);
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'network-identity')).toMatchObject({ passed: false, severity: 'required' });
  });

  it('fails on stale explorer/observer data, conflicts and unavailable recovery', () => {
    const input = healthyInput();
    input.explorer.indexedHeight = HEIGHT - 3;
    input.observer.coveragePercent = 90;
    input.conflicts.otherLiveRunKeys = ['other'];
    input.recovery.workerLastSeenAtMs = NOW - 31_000;
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.dataQuality.confidence).toBe('low');
    for (const checkId of ['explorer-synced', 'observer-fresh', 'no-active-experiment', 'recovery-ready']) {
      expect(result.checks.find((item) => item.checkId === checkId)?.passed).toBe(false);
    }
  });

  it('does not let incomplete target mapping reach an armable result', () => {
    const input = healthyInput();
    input.targetInventory.complete = false;
    input.targetInventory.snapshots = [];
    input.targetInventory.issues = [{
      code: 'MISSING_PROTX_MAPPING', targetId: 'mn-1',
      publicMessage: 'missing', privateDetail: 'exact private cause',
    }];
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'target-resolved')?.passed).toBe(false);
  });

  it('rejects a stale immutable target snapshot', () => {
    const input = healthyInput();
    input.targetInventory.capturedAtMs = NOW - input.policy.maxTargetSnapshotAgeMs - 1;
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'target-resolved')?.passed).toBe(false);
  });

  it('supports an explicitly approved regtest identity for local testing', () => {
    const input = healthyInput();
    input.policy.expectedChain = 'regtest';
    input.chain.chain = 'regtest';
    input.targetInventory.network = 'regtest';
    for (const target of input.targetInventory.snapshots) target.network = 'regtest';
    expect(evaluateSimulationPreflight(input).checks.find((item) => item.checkId === 'network-identity')?.passed).toBe(true);
  });

  it('allows an initial preflight with optional baseline/quorum as medium confidence', () => {
    const input = healthyInput();
    input.quorum = { required: false, stable: false, capturedAtHeight: null, memberTargetIds: [] };
    input.baseline.required = false;
    input.baseline.evidence = null;
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(true);
    expect(result.dataQuality.confidence).toBe('medium');
    expect(result.checks.filter((item) => !item.passed).every((item) => item.severity === 'warning')).toBe(true);
  });

  it('does not require a remote recovery worker for a non-live DryRun', () => {
    const input = healthyInput();
    input.recovery = { required: false, workerLastSeenAtMs: null, targets: [] };
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(true);
    expect(result.checks.find((item) => item.checkId === 'recovery-ready')).toMatchObject({
      passed: true,
      severity: 'warning',
    });
  });

  it('requires baseline minimums before arming', () => {
    const input = healthyInput();
    input.baseline.evidence!.resolvedDkgRounds -= 1;
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'baseline-ready')).toMatchObject({ passed: false, severity: 'required' });
  });

  it('requires every selected quorum-outage target to remain a current member', () => {
    const input = healthyInput();
    input.selectedTargetIds = ['mn-1', 'mn-2'];
    input.recovery.required = false;
    input.targetInventory.snapshots.push({
      ...input.targetInventory.snapshots[1]!,
      targetId: 'mn-3',
      proTxHash: '3'.padStart(64, '0'),
    });
    input.quorum.memberTargetIds = ['mn-1', 'mn-3'];
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'quorum-stable')).toMatchObject({
      passed: false,
      severity: 'required',
    });
  });

  it('fails a quorum outage when the identified quorum changed after its snapshot', () => {
    const input = healthyInput();
    input.quorum.snapshotMatches = false;
    const result = evaluateSimulationPreflight(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.checkId === 'quorum-stable')).toMatchObject({
      passed: false,
      severity: 'required',
    });
  });

  it('refuses to evaluate with no expected wrapper version only when recovery is checked', () => {
    const input = healthyInput(); // recovery.required = true
    input.policy.expectedWrapperVersion = '';
    // A live run that checks recovery needs the version to compare against; an
    // unset one is a server misconfiguration named clearly, not a target failure.
    expect(() => evaluateSimulationPreflight(input)).toThrow(/SIMULATION_EXPECTED_WRAPPER_VERSION/);
  });

  it('does not require an expected wrapper version when recovery is not checked (dry run)', () => {
    const input = healthyInput();
    input.recovery = { required: false, workerLastSeenAtMs: null, targets: [] };
    input.policy.expectedWrapperVersion = '';
    // The version is only consumed in the recovery check, so a run that does not
    // ask for recovery must evaluate normally rather than 500 on a wrapper it never uses.
    expect(() => evaluateSimulationPreflight(input)).not.toThrow();
    expect(evaluateSimulationPreflight(input).passed).toBe(true);
  });
});

describe('recovery evidence comes from the wrapper heartbeat', () => {
  const labTarget = (targetId: string, hostRef: string): SimulationTargetSnapshot => ({
    targetId, displayLabel: targetId, operatorId: null, proTxHash: null, hostRef,
    unitRef: 'u', p2pPort: 19799, role: 'masternode', network: 'regtest',
    capabilities: ['netem-p2p', 'service-control'],
    expectedBuild: null, capturedAtMs: 0, capturedAtHeight: 0,
  });

  const withRecovery = (recovery: SimulationPreflightInput['recovery']): SimulationPreflightInput => ({
    ...healthyInput(),
    recovery,
  });

  it('passes recovery-ready for a live run when a fresh heartbeat covers the target', () => {
    // The whole point of the fix: this check used to be unpassable for a live run,
    // because the evidence was hardcoded to null/[] with required=true.
    const evidence = recoveryEvidenceFromHeartbeat({
      heartbeat: {
        atMs: NOW - 1_000,
        wrapperVersion: '1.0.0',
        containers: [{ container: 'mn01', running: true, faultStateClean: true }],
      },
      targets: [labTarget('mn-1', 'mn01')],
    });
    const result = evaluateSimulationPreflight(withRecovery({ required: true, ...evidence }));
    expect(result.checks.find((item) => item.checkId === 'recovery-ready')).toMatchObject({
      passed: true, severity: 'required',
    });
  });

  it('fails for the true reason when no wrapper is publishing', () => {
    const evidence = recoveryEvidenceFromHeartbeat({ heartbeat: null, targets: [labTarget('mn-1', 'mn01')] });
    const result = evaluateSimulationPreflight(withRecovery({ required: true, ...evidence }));
    const check = result.checks.find((item) => item.checkId === 'recovery-ready');
    expect(check).toMatchObject({ passed: false, severity: 'required' });
    // The detail names the worker, not the targets -- it is a wrapper that is
    // absent, and the run record must not blame the fleet for it.
    expect(check?.privateDetail).toContain('workerAgeMs=Infinity');
  });

  it('fails when the wrapper is a different build from the one configured', () => {
    const evidence = recoveryEvidenceFromHeartbeat({
      heartbeat: {
        atMs: NOW - 1_000, wrapperVersion: 'not-the-expected-build',
        containers: [{ container: 'mn01', running: true, faultStateClean: true }],
      },
      targets: [labTarget('mn-1', 'mn01')],
    });
    const result = evaluateSimulationPreflight(withRecovery({ required: true, ...evidence }));
    expect(result.checks.find((item) => item.checkId === 'recovery-ready')?.passed).toBe(false);
  });

  it('fails when the wrapper still holds a fault against the target', () => {
    const evidence = recoveryEvidenceFromHeartbeat({
      heartbeat: {
        atMs: NOW - 1_000, wrapperVersion: '1.0.0',
        containers: [{ container: 'mn01', running: true, faultStateClean: false }],
      },
      targets: [labTarget('mn-1', 'mn01')],
    });
    const result = evaluateSimulationPreflight(withRecovery({ required: true, ...evidence }));
    expect(result.checks.find((item) => item.checkId === 'recovery-ready')?.passed).toBe(false);
  });
});

describe('freshness is judged only on being too old', () => {
  it('passes observer-fresh for an observation newer than the reference instant', () => {
    // Same rule as targetResolver: a negative age means the observation is fresher
    // than the reference, not staler. Requiring age >= 0 made a replayed request
    // fail a required check for evidence that was strictly better than it needed.
    const input = healthyInput();
    input.observer.lastObservationAtMs = NOW + 90_000;
    const result = evaluateSimulationPreflight(input);
    expect(result.checks.find((item) => item.checkId === 'observer-fresh')?.passed).toBe(true);
  });

  it('still fails observer-fresh when the observation is genuinely too old', () => {
    const input = healthyInput();
    input.observer.lastObservationAtMs = NOW - 999_999;
    const result = evaluateSimulationPreflight(input);
    expect(result.checks.find((item) => item.checkId === 'observer-fresh')?.passed).toBe(false);
  });

  it('still fails when there is no observation at all', () => {
    const input = healthyInput();
    input.observer.lastObservationAtMs = null;
    const result = evaluateSimulationPreflight(input);
    expect(result.checks.find((item) => item.checkId === 'observer-fresh')?.passed).toBe(false);
  });
});
