import { describe, expect, it } from 'vitest';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { generateDryRunPlan } from './dryRunExecutor.js';
import {
  assertSingleFaultClass,
  faultRecoveryTargetsForPlan,
  indexTargetsById,
  labFaultsForPlan,
  scheduledLabActionsForPlan,
  UnsupportedLiveFaultError,
} from './liveExecutorPlan.js';
import {
  dslJobId,
  emptyWrapperState,
  parseWrapperState,
  planDslSet,
  planSweep,
  serviceJobId,
  undoFor,
  withDslFaultId,
  type FaultAction,
  type FaultJob,
  type WrapperState,
} from './netemLease.js';
import { NetemFaultRunner, dispatchWrapperCommand, parseWrapperCommand, type FaultExecutor, type WrapperStore } from './netemRunner.js';
import {
  DEFAULT_DSL_EXEC_OPTIONS,
  dockerDslClearArgv,
  dockerDslHeightArgv,
  dockerDslSetArgv,
  dslExpiryHeight,
  parseDslSetOutput,
} from './netemWrapperHost.js';
import { DSL_FAULT_LIMITS, parseScenarioRequest, scenarioRequestFromPreset } from './scenarioRegistry.js';
import type { DryRunPlan, PlannedActionPayload, PlannedSimulationAction } from './scenarioTypes.js';

/*
 * The Sentinel Layer fault path, end to end through the pure parts: the
 * scenario the operator asks for, the plan it becomes, the wrapper commands the
 * plan translates to, the wrapper's own state and undo, and the docker argv the
 * host runs. The one thing not here is Docker itself.
 */

const RUN = 'run-dsl';

function target(overrides: Partial<SimulationTargetSnapshot> = {}): SimulationTargetSnapshot {
  return {
    targetId: 'mn-1', displayLabel: 'mn-1', operatorId: null, proTxHash: '1'.padEnd(64, '0'), hostRef: 'mn01',
    unitRef: 'u', p2pPort: 19799, role: 'masternode', network: 'regtest',
    capabilities: ['service-control', 'dsl-test-hook'],
    expectedBuild: null, capturedAtMs: 0, capturedAtHeight: 0, ...overrides,
  };
}

function action(targetId: string, payload: PlannedActionPayload, notBeforeOffsetMs = 0, sequence = 0): PlannedSimulationAction {
  return {
    actionId: `${targetId}:${sequence}`, runKey: RUN, sequence, targetId, kind: payload.kind, payload,
    payloadDigest: 'd', notBeforeOffsetMs, expiresAfterMs: notBeforeOffsetMs + 60_000, maxAttempts: 1,
  };
}

const planWith = (actions: PlannedSimulationAction[]): DryRunPlan => ({ actions } as unknown as DryRunPlan);

const applyPayload: Extract<PlannedActionPayload, { kind: 'dsl-fault-apply' }> = {
  kind: 'dsl-fault-apply', faultKind: 'response-drop', epochs: 1, param: 0, faultLeaseSeconds: 840,
};

describe('the dsl-fault scenario', () => {
  it('parses, with a delay kind demanding its delay and the others refusing one', () => {
    const base = { scenarioId: 'dsl-fault', scenarioVersion: 1, seed: 's' };
    expect(parseScenarioRequest({ ...base, parameters: { faultKind: 'response-drop', count: 1, epochs: 2 } }).scenarioId).toBe('dsl-fault');
    expect(parseScenarioRequest({ ...base, parameters: { faultKind: 'report-delay', count: 1, epochs: 1, param: 4 } }).parameters)
      .toMatchObject({ param: 4 });
    expect(() => parseScenarioRequest({ ...base, parameters: { faultKind: 'report-delay', count: 1, epochs: 1 } }))
      .toThrow(/needs param/);
    expect(() => parseScenarioRequest({ ...base, parameters: { faultKind: 'response-drop', count: 1, epochs: 1, param: 2 } }))
      .toThrow(/takes no param/);
    expect(() => parseScenarioRequest({ ...base, parameters: { faultKind: 'response-drop', count: 1, epochs: DSL_FAULT_LIMITS.maxEpochs + 1 } }))
      .toThrow();
    expect(() => parseScenarioRequest({ ...base, parameters: { faultKind: 'unplug', count: 1, epochs: 1 } })).toThrow();
  });

  it('ships three one-epoch presets that are ordinary validated requests', () => {
    for (const preset of ['dsl-response-drop-1', 'dsl-report-drop-1', 'dsl-commitment-skip-1'] as const) {
      const request = scenarioRequestFromPreset(preset, 'seed');
      expect(request.scenarioId).toBe('dsl-fault');
      expect(request.parameters).toMatchObject({ count: 1, epochs: 1 });
    }
  });

  it('plans one arm and one planned clear per target, a whole epoch of lease beyond the fault', () => {
    const targets = [target(), target({ targetId: 'mn-2', hostRef: 'mn02', proTxHash: '2'.padEnd(64, '0') }),
      target({ targetId: 'mn-3', hostRef: 'mn03', proTxHash: '3'.padEnd(64, '0'), capabilities: ['service-control'] })];
    const plan = generateDryRunPlan(
      { runKey: simulationRunKeyFor('dsl-plan'), network: 'regtest',
        scenario: { scenarioId: 'dsl-fault', scenarioVersion: 1, seed: 's', parameters: { faultKind: 'report-delay', count: 2, epochs: 2, param: 4 } } },
      { network: 'regtest', currentHeight: 100, targets, quorumMemberTargetIds: [] }
    );
    const applies = plan.actions.filter((a) => a.payload.kind === 'dsl-fault-apply');
    const clears = plan.actions.filter((a) => a.payload.kind === 'dsl-fault-clear');
    expect(applies).toHaveLength(2);
    expect(clears).toHaveLength(2);
    // mn-3 has no dsl-test-hook and can never be chosen
    expect(plan.actions.every((a) => a.targetId !== 'mn-3')).toBe(true);
    for (const apply of applies) {
      expect(apply.notBeforeOffsetMs).toBe(0);
      expect(apply.payload).toMatchObject({ faultKind: 'report-delay', epochs: 2, param: 4 });
      const lease = (apply.payload as { faultLeaseSeconds: number }).faultLeaseSeconds;
      // (epochs + 1) epochs of blocks, because the fault counts from the next boundary, plus the recovery grace
      const clear = clears.find((c) => c.targetId === apply.targetId)!;
      expect(clear.notBeforeOffsetMs).toBe((lease - 120) * 1_000);
      expect(clear.payload).toMatchObject({ faultKind: 'report-delay' });
    }
  });
});

describe('the wrapper state for a dsl fault', () => {
  const spec = { container: 'mn01', faultKind: 'response-drop' as const, epochs: 1, param: 0, scenarioId: RUN };

  it('writes the job before the node has answered, and completes it with the fault id after', () => {
    const plan = planDslSet(emptyWrapperState(), spec, RUN, 1_000, 61_000);
    expect(plan.actions).toEqual([{ op: 'dsl-set', container: 'mn01', faultKind: 'response-drop', epochs: 1, param: 0, scenarioId: RUN }]);
    const job = plan.state.jobs[0]!;
    expect(job).toMatchObject({ faultClass: 'dsl', kind: 'dsl', args: ['response-drop', '1', '0', ''] });
    expect(job.jobId).toBe(dslJobId(RUN, 'mn01', 'response-drop'));
    // an undo with no id clears nothing, deliberately
    expect(undoFor(job)).toEqual({ op: 'dsl-clear', container: 'mn01', faultId: '' });
    const completed = withDslFaultId(plan.state, job.jobId, '7');
    expect(undoFor(completed.jobs[0]!)).toEqual({ op: 'dsl-clear', container: 'mn01', faultId: '7' });
    // re-arming the same live job is a no-op, and keeps the id
    const again = planDslSet(completed, spec, RUN, 2_000, 61_000);
    expect(again.actions).toEqual([]);
    expect(again.state.jobs[0]!.args[3]).toBe('7');
    // ... but a live job the node never answered is not "applied": a retry arms again.
    // On the lab the first arm was refused by the node and the retry read the
    // half-written job as done, reporting a fault active that did not exist.
    const retried = planDslSet(plan.state, spec, RUN, 2_000, 61_000);
    expect(retried.actions).toHaveLength(1);
    expect(retried.state.jobs).toHaveLength(1);
    expect(retried.state.jobs[0]!.args[3]).toBe('');
  });

  it('refuses what the node would refuse, before any docker call', () => {
    expect(() => planDslSet(emptyWrapperState(), { ...spec, faultKind: 'report-delay', param: 0 }, RUN, 1_000, 61_000)).toThrow(/non-zero delay/);
    expect(() => planDslSet(emptyWrapperState(), { ...spec, param: 3 }, RUN, 1_000, 61_000)).toThrow(/takes no param/);
    expect(() => planDslSet(emptyWrapperState(), { ...spec, epochs: 4 }, RUN, 1_000, 61_000)).toThrow(/1\.\.3/);
    expect(() => planDslSet(emptyWrapperState(), { ...spec, scenarioId: ' ' }, RUN, 1_000, 61_000)).toThrow(/scenario/);
    expect(() => planDslSet(emptyWrapperState(), spec, RUN, 1_000, 1_000)).toThrow(/expired/);
  });

  it('survives a state file round trip and sweeps first, ahead of the service undo on the same container', () => {
    const dsl: FaultJob = { jobId: 'dsl-1', runTag: RUN, container: 'mn01', faultClass: 'dsl', kind: 'dsl', args: ['report-drop', '1', '0', '3'], appliedAtMs: 0, expiresAtMs: 10 };
    const svc: FaultJob = { jobId: serviceJobId(RUN, 'mn01'), runTag: RUN, container: 'mn01', faultClass: 'service', kind: 'service-stop', args: [], appliedAtMs: 0, expiresAtMs: 10 };
    const netem: FaultJob = { jobId: 'netem-1', runTag: RUN, container: 'mn01', faultClass: 'netem', kind: 'latency', args: ['100ms'], appliedAtMs: 0, expiresAtMs: 10 };
    const state: WrapperState = parseWrapperState(JSON.parse(JSON.stringify({ jobs: [netem, svc, dsl] })));
    expect(state.jobs.map((j) => j.faultClass)).toEqual(['netem', 'service', 'dsl']);
    const undos = planSweep(state, 11);
    expect(undos.map((u) => u.action.op)).toEqual(['dsl-clear', 'start', 'clear']);
    expect((undos[0]!.action as Extract<FaultAction, { op: 'dsl-clear' }>).faultId).toBe('3');
  });
});

describe('the wrapper command and runner', () => {
  const command = {
    op: 'dsl-set', container: 'mn01', faultKind: 'commitment-skip', epochs: 2, param: 0, scenarioId: RUN,
    runTag: RUN, expiresAtMs: 5_000, commandId: 'c1',
  };

  it('parses a dsl-set command and refuses a malformed one', () => {
    expect(parseWrapperCommand(command, 1_000)).toMatchObject({ op: 'dsl-set', faultKind: 'commitment-skip', epochs: 2 });
    expect(() => parseWrapperCommand({ ...command, faultKind: 'drop' }, 1_000)).toThrow(/faultKind/);
    expect(() => parseWrapperCommand({ ...command, epochs: 0 }, 1_000)).toThrow(/epochs/);
    expect(() => parseWrapperCommand({ ...command, scenarioId: '' }, 1_000)).toThrow(/scenarioId/);
    expect(() => parseWrapperCommand({ ...command, expiresAtMs: 500 }, 1_000)).toThrow();
  });

  it('records the fault id the node answered with, and clears by it', async () => {
    class MemoryStore implements WrapperStore {
      state: WrapperState = emptyWrapperState();
      async load(): Promise<WrapperState> { return structuredClone(this.state); }
      async save(state: WrapperState): Promise<void> { this.state = structuredClone(state); }
    }
    const store = new MemoryStore();
    const actions: FaultAction[] = [];
    const execute: FaultExecutor = async (a) => {
      actions.push(a);
      if (a.op === 'dsl-set') return { faultId: '42', expiryHeight: 96 };
      return undefined;
    };
    const runner = new NetemFaultRunner(execute, store, { clock: () => 1_000 });
    const calls: string[] = [];
    await dispatchWrapperCommand(
      {
        apply: async () => { calls.push('apply'); return { jobId: 'x' }; },
        stopService: async () => { calls.push('stop'); return { jobId: 'x' }; },
        setDslFault: async (spec, runTag, expiresAtMs) => {
          calls.push(`dsl:${spec.faultKind}:${runTag}:${expiresAtMs}`);
          return runner.setDslFault(spec, runTag, expiresAtMs);
        },
        clear: async () => { calls.push('clear'); },
      },
      parseWrapperCommand(command, 1_000)
    );
    expect(calls).toEqual([`dsl:commitment-skip:${RUN}:5000`]);
    expect(actions).toEqual([{ op: 'dsl-set', container: 'mn01', faultKind: 'commitment-skip', epochs: 2, param: 0, scenarioId: RUN }]);
    const jobId = dslJobId(RUN, 'mn01', 'commitment-skip');
    expect(store.state.jobs[0]).toMatchObject({ jobId, args: ['commitment-skip', '2', '0', '42'] });
    await runner.clear(jobId);
    expect(actions[1]).toEqual({ op: 'dsl-clear', container: 'mn01', faultId: '42' });
    expect(store.state.jobs).toEqual([]);
  });
});

describe('the docker argv the host runs', () => {
  it('reads the height, arms from the next boundary for whole epochs, and clears by id, all inside the container', () => {
    const cli = ['exec', 'mn01', 'defcon-cli', '-regtest', '-datadir=/var/lib/defcon', '-rpcport=19798'];
    expect(dockerDslHeightArgv('mn01')).toEqual([...cli, 'getblockcount']);
    // 24-block epochs: armed at 100, the next boundary is 120, one epoch ends at 144
    expect(dslExpiryHeight(100, 1, 24)).toBe(144);
    expect(dslExpiryHeight(119, 1, 24)).toBe(144);
    // armed exactly on a boundary, this epoch already announced: the count starts at the next one
    expect(dslExpiryHeight(120, 1, 24)).toBe(168);
    expect(dslExpiryHeight(100, 3, 24)).toBe(192);
    expect(dockerDslSetArgv({ op: 'dsl-set', container: 'mn01', faultKind: 'report-delay', epochs: 1, param: 4, scenarioId: RUN }, 144))
      .toEqual([...cli, 'faultinject', 'set', 'report-delay', '144', RUN, '4']);
    expect(dockerDslClearArgv({ op: 'dsl-clear', container: 'mn01', faultId: '9' })).toEqual([...cli, 'faultinject', 'clear', '9']);
    expect(DEFAULT_DSL_EXEC_OPTIONS.epochBlocks).toBe(24);
  });

  it('takes the fault id only from a well-formed answer', () => {
    expect(parseDslSetOutput(JSON.stringify({ id: 3, kind: 'response-drop', expiryHeight: 144 }))).toEqual({ faultId: '3', expiryHeight: 144 });
    expect(() => parseDslSetOutput(JSON.stringify({ kind: 'response-drop' }))).toThrow(/fault id/);
    expect(() => parseDslSetOutput(JSON.stringify({ id: 0, expiryHeight: 1 }))).toThrow(/fault id/);
    expect(() => parseDslSetOutput('error code: -1')).toThrow();
  });
});

describe('translating a plan for the lab executor', () => {
  const targets = indexTargetsById([target(), target({ targetId: 'mn-2', hostRef: 'mn02', capabilities: ['service-control'] })]);

  it('turns a dsl-fault-apply into a dsl-set under the run lease, with the run key as the scenario', () => {
    const { faults, skipped } = labFaultsForPlan({
      plan: planWith([action('mn-1', applyPayload), action('mn-1', { kind: 'dsl-fault-clear', faultKind: 'response-drop' }, 720_000, 1)]),
      targetsById: targets, runTag: RUN, expiresAtMs: 900_000, nowMs: 0, strict: true,
    });
    expect(skipped).toBe(0);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({
      targetId: 'mn-1', container: 'mn01', faultClass: 'dsl', jobId: dslJobId(RUN, 'mn01', 'response-drop'),
      apply: { op: 'dsl-set', container: 'mn01', faultKind: 'response-drop', epochs: 1, param: 0, scenarioId: RUN, runTag: RUN, expiresAtMs: 900_000 },
    });
  });

  it('refuses a target without the dsl-test-hook capability, and never mixes classes', () => {
    expect(() => labFaultsForPlan({
      plan: planWith([action('mn-2', applyPayload)]), targetsById: targets, runTag: RUN, expiresAtMs: 900_000, nowMs: 0, strict: true,
    })).toThrow();
    expect(() => assertSingleFaultClass(planWith([action('mn-1', applyPayload), action('mn-2', { kind: 'service-stop', faultLeaseSeconds: 60 })])))
      .toThrow(UnsupportedLiveFaultError);
    expect(() => assertSingleFaultClass(planWith([action('mn-1', applyPayload)]))).not.toThrow();
  });

  it('schedules the planned clear as a clear of the dsl job, and recovery clears the same job', () => {
    const plan = planWith([action('mn-1', applyPayload), action('mn-1', { kind: 'dsl-fault-clear', faultKind: 'response-drop' }, 720_000, 1)]);
    const jobId = dslJobId(RUN, 'mn01', 'response-drop');
    const { actions, skipped } = scheduledLabActionsForPlan({ plan, targetsById: targets, runTag: RUN, expiresAtMs: 900_000 });
    expect(skipped).toBe(0);
    expect(actions).toEqual([{
      actionId: 'mn-1:1', targetId: 'mn-1', container: 'mn01', faultClass: 'dsl', notBeforeOffsetMs: 720_000,
      command: { op: 'clear', jobId, commandId: 'mn-1:1' },
    }]);
    const recovery = faultRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: RUN });
    expect(recovery.skipped).toBe(0);
    expect(recovery.targets).toEqual([{ targetId: 'mn-1', container: 'mn01', faultClass: 'dsl', clear: { op: 'clear', jobId, commandId: jobId } }]);
  });
});
