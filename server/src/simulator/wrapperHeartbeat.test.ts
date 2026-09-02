import { describe, expect, it } from 'vitest';
import {
  buildWrapperHeartbeat,
  parseWrapperHeartbeat,
  recoveryEvidenceFromHeartbeat,
  type WrapperHeartbeat,
} from './wrapperHeartbeat.js';
import { emptyWrapperState, planApply, planServiceStop } from './netemLease.js';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';

const RUN = 'run-hb';

function target(targetId: string, hostRef: string): SimulationTargetSnapshot {
  return {
    targetId, displayLabel: targetId, operatorId: null, proTxHash: null, hostRef,
    unitRef: 'u', p2pPort: 19799, role: 'masternode', network: 'regtest',
    capabilities: ['netem-p2p', 'service-control'],
    expectedBuild: null, capturedAtMs: 0, capturedAtHeight: 0,
  };
}

describe('buildWrapperHeartbeat', () => {
  it('reports a container the wrapper holds a job against as not clean', () => {
    const stopped = planServiceStop(emptyWrapperState(), 'mn02', RUN, 1_000, 30_000).state;
    const impaired = planApply(stopped, { container: 'mn03', kind: 'latency', args: ['100ms'] }, RUN, 1_000, 30_000).state;
    const hb = buildWrapperHeartbeat({
      atMs: 5_000, wrapperVersion: '1.2.3', state: impaired,
      runningContainers: ['mn01', 'mn03'],
    });
    expect(hb.containers).toEqual([
      // mn02 is stopped BY the wrapper: it is not running, and not clean.
      { container: 'mn01', running: true, faultStateClean: true },
      { container: 'mn02', running: false, faultStateClean: false },
      // Impaired but up -- a netem fault is still a fault to recover from.
      { container: 'mn03', running: true, faultStateClean: false },
    ]);
    expect(hb).toMatchObject({ atMs: 5_000, wrapperVersion: '1.2.3' });
  });

  it('names a held container even when Docker no longer lists it', () => {
    const stopped = planServiceStop(emptyWrapperState(), 'mn09', RUN, 1_000, 30_000).state;
    const hb = buildWrapperHeartbeat({ atMs: 1, wrapperVersion: 'v', state: stopped, runningContainers: [] });
    expect(hb.containers).toEqual([{ container: 'mn09', running: false, faultStateClean: false }]);
  });
});

describe('recoveryEvidenceFromHeartbeat', () => {
  const heartbeat: WrapperHeartbeat = {
    atMs: 5_000,
    wrapperVersion: '1.2.3',
    containers: [
      { container: 'mn01', running: true, faultStateClean: true },
      { container: 'mn02', running: false, faultStateClean: false },
    ],
  };

  it('keys the wrapper\'s containers back to target ids through hostRef', () => {
    const evidence = recoveryEvidenceFromHeartbeat({
      heartbeat,
      targets: [target('mn-1', 'mn01'), target('mn-2', 'mn02')],
    });
    expect(evidence.workerLastSeenAtMs).toBe(5_000);
    expect(evidence.targets).toEqual([
      { targetId: 'mn-1', available: true, faultStateClean: true, wrapperVersion: '1.2.3' },
      { targetId: 'mn-2', available: false, faultStateClean: false, wrapperVersion: '1.2.3' },
    ]);
  });

  it('omits a target the wrapper has never seen, which preflight reads as unrecoverable', () => {
    const evidence = recoveryEvidenceFromHeartbeat({ heartbeat, targets: [target('mn-9', 'mn09')] });
    expect(evidence.targets).toEqual([]);
  });

  it('yields no worker and no targets when there is no heartbeat at all', () => {
    // Which is what makes the live preflight fail for the TRUE reason -- no
    // wrapper is publishing -- rather than because the evidence was hardcoded.
    expect(recoveryEvidenceFromHeartbeat({ heartbeat: null, targets: [target('mn-1', 'mn01')] }))
      .toEqual({ workerLastSeenAtMs: null, targets: [] });
  });
});

describe('parseWrapperHeartbeat', () => {
  it('accepts a well-formed heartbeat and rejects anything it cannot trust', () => {
    expect(parseWrapperHeartbeat({ atMs: 1, wrapperVersion: 'v', containers: [] }))
      .toEqual({ atMs: 1, wrapperVersion: 'v', containers: [] });
    expect(parseWrapperHeartbeat(null)).toBeNull();
    expect(parseWrapperHeartbeat({ wrapperVersion: 'v', containers: [] })).toBeNull();
    expect(parseWrapperHeartbeat({ atMs: 1, wrapperVersion: 'v' })).toBeNull();
  });

  it('drops an unusable container entry rather than the whole heartbeat', () => {
    const parsed = parseWrapperHeartbeat({
      atMs: 1, wrapperVersion: 'v',
      containers: [{ container: 'mn01', running: true, faultStateClean: true }, { running: true }, null],
    });
    expect(parsed!.containers).toEqual([{ container: 'mn01', running: true, faultStateClean: true }]);
  });
});
