import { describe, expect, it } from 'vitest';
import { creationAuditRecord } from '../domain/simulationAudit.js';
import { createSimulationRunState } from '../domain/simulationRunState.js';
import { SimulationAction, simulationActionSchema } from './SimulationAction.js';
import { SimulationAuditEvent, simulationAuditEventSchema } from './SimulationAuditEvent.js';
import { SimulationLiveRunLock } from './SimulationLiveRunLock.js';
import {
  SimulationRun,
  simulationRunSchema,
  type SimulationRunMetadata,
} from './SimulationRun.js';
import { SimulationTarget } from './SimulationTarget.js';
import {
  SimulationControlRequest,
  simulationControlRequestSchema,
} from './SimulationControlRequest.js';
import {
  SimulationRunArtifact,
  simulationRunArtifactSchema,
} from './SimulationRunArtifact.js';

const actor = { actorId: 'admin-1', actorType: 'admin-session' as const, displayName: 'Admin' };

const state = () =>
  createSimulationRunState({
    runKey: 'sim-model-test',
    live: true,
    createdAtMs: 1,
    runExpiresAtMs: 1_000,
  });

const metadata = (): SimulationRunMetadata => ({
  network: 'devnet',
  scenarioId: 'model-test',
  scenarioVersion: 1,
  parameters: { durationSeconds: 30 },
  seed: 'seed',
  targetSnapshot: [],
  experimentRunKey: null,
  baselineRunKey: null,
  requestedBy: actor,
});

describe('simulation Mongo schemas', () => {
  it('validates a run projection and rejects a target from another network', async () => {
    const valid = new SimulationRun({
      runKey: 'sim-model-test',
      metadataFingerprint: 'fingerprint',
      metadata: metadata(),
      state: state(),
    });
    await expect(valid.validate()).resolves.toBeUndefined();

    const wrongMetadata = metadata();
    wrongMetadata.targetSnapshot.push({
      targetId: 'mn-1',
      displayLabel: 'MN 1',
      operatorId: null,
      proTxHash: null,
      hostRef: 'host-1',
      unitRef: 'mn-1',
      p2pPort: 19_799,
      role: 'masternode',
      network: 'regtest',
      capabilities: ['service-control'],
      expectedBuild: null,
      capturedAtMs: 1,
      capturedAtHeight: 1,
    });
    const invalid = new SimulationRun({
      runKey: 'sim-model-test',
      metadataFingerprint: 'fingerprint',
      metadata: wrongMetadata,
      state: state(),
    });
    await expect(invalid.validate()).rejects.toThrow(/target network/i);
  });

  it('rejects mainnet and unknown fields at the schema boundary', () => {
    const invalidNetwork = new SimulationRun({
      runKey: 'sim-model-test',
      metadataFingerprint: 'fingerprint',
      metadata: { ...metadata(), network: 'mainnet' },
      state: state(),
    });
    expect(invalidNetwork.validateSync()?.message).toMatch(/network/);

    expect(
      () =>
        new SimulationTarget({
          targetId: 'mn-1',
          displayLabel: 'MN 1',
          hostRef: 'host-1',
          unitRef: 'mn-1',
          p2pPort: 19_799,
          role: 'masternode',
          network: 'devnet',
          capabilities: [],
          arbitraryShell: 'rm -rf /',
        })
    ).toThrow(/strict/i);
  });

  it('keeps new execution targets disabled until explicitly approved', () => {
    const target = new SimulationTarget({
      targetId: 'mn-1',
      displayLabel: 'MN 1',
      hostRef: 'host-1',
      unitRef: 'mn-1',
      p2pPort: 19_799,
      role: 'masternode',
      network: 'devnet',
      capabilities: [],
    });
    expect(target.enabled).toBe(false);
    expect(target.maintenance).toBe(false);
  });

  it('requires claimed actions to carry an owner and lease', async () => {
    const action = new SimulationAction({
      actionId: 'act-1',
      runKey: 'sim-model-test',
      sequence: 0,
      targetId: 'mn-1',
      kind: 'service-stop',
      status: 'claimed',
      revision: 1,
      payload: { kind: 'service-stop', ttlSeconds: 30 },
      payloadDigest: 'digest',
      expiresAtMs: 100,
      attempts: 1,
      maxAttempts: 3,
    });
    await expect(action.validate()).rejects.toThrow(/owner and lease/i);
  });

  it('enforces held and released lock invariants', async () => {
    const held = new SimulationLiveRunLock({
      scope: 'devnet-live',
      status: 'held',
      runKey: 'sim-model-test',
      ownerId: 'worker-1',
      acquiredAtMs: 10,
      leaseUntilMs: 20,
      revision: 0,
    });
    await expect(held.validate()).resolves.toBeUndefined();

    const broken = new SimulationLiveRunLock({
      scope: 'devnet-live',
      status: 'released',
      runKey: null,
      ownerId: null,
      acquiredAtMs: null,
      leaseUntilMs: null,
      releasedAtMs: null,
      revision: 1,
    });
    await expect(broken.validate()).rejects.toThrow(/tombstone/i);
  });

  it('defines the idempotency, ordering, claim and query indexes without TTL', () => {
    const auditIndexes = simulationAuditEventSchema.indexes();
    expect(auditIndexes).toEqual(
      expect.arrayContaining([
        [{ stream: 1, subjectId: 1, sequence: 1 }, { unique: true, background: true }],
        [{ runKey: 1, eventId: 1 }, { unique: true, background: true }],
      ])
    );
    expect(simulationActionSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ runKey: 1, sequence: 1 }, { unique: true, background: true }],
        [{ status: 1, notBeforeMs: 1, leaseUntilMs: 1 }, { background: true }],
      ])
    );
    expect(simulationRunSchema.indexes()).toEqual(
      expect.arrayContaining([[{ 'state.status': 1, createdAt: -1 }, { background: true }]])
    );
    expect(simulationControlRequestSchema.indexes()).toEqual(
      expect.arrayContaining([[{ requestKey: 1 }, { unique: true, background: true }]])
    );
    expect(simulationRunArtifactSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ runKey: 1, requestKey: 1, kind: 1 }, { unique: true, background: true }],
      ])
    );
    for (const [, options] of [
      ...auditIndexes,
      ...simulationActionSchema.indexes(),
      ...simulationRunSchema.indexes(),
    ]) {
      expect(options).not.toHaveProperty('expireAfterSeconds');
    }
  });

  it('accepts audit inserts but blocks query mutation before reaching MongoDB', async () => {
    const initial = state();
    const audit = new SimulationAuditEvent(
      creationAuditRecord({ state: initial, metadata: metadata(), actor })
    );
    await expect(audit.validate()).resolves.toBeUndefined();

    await expect(
      SimulationAuditEvent.updateOne(
        { runKey: initial.runKey },
        { $set: { requestFingerprint: 'rewritten' } }
      ).exec()
    ).rejects.toThrow(/append-only/i);
    await expect(SimulationAuditEvent.deleteMany({ runKey: initial.runKey }).exec()).rejects.toThrow(
      /append-only/i
    );
    await expect(
      SimulationAuditEvent.bulkWrite([{ deleteMany: { filter: { runKey: initial.runKey } } }])
    ).rejects.toThrow(/append-only/i);
  });

  it('keeps control requests and run artifacts append-only', async () => {
    await expect(SimulationControlRequest.updateOne(
      { requestKey: 'ctl-1' }, { $set: { role: 'safety-admin' } }
    ).exec()).rejects.toThrow(/append-only/i);
    await expect(SimulationControlRequest.deleteMany({}).exec()).rejects.toThrow(/append-only/i);
    await expect(SimulationRunArtifact.findOneAndUpdate(
      { artifactId: 'art-1' }, { $set: { payload: {} } }
    ).exec()).rejects.toThrow(/append-only/i);
    await expect(SimulationRunArtifact.bulkWrite([
      { deleteMany: { filter: { runKey: 'sim-model-test' } } },
    ])).rejects.toThrow(/append-only/i);
  });
});
