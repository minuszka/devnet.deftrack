import { simulationFingerprint } from '../domain/simulationAudit.js';
import type { SimulationAuditActor, SimulationDataQualitySnapshot, SimulationPreflightResult } from '../models/SimulationRun.js';
import type {
  SimulationControlOperation,
  SimulationControlRole,
} from '../models/SimulationControlRequest.js';
import type { SimulationArtifactKind } from '../models/SimulationRunArtifact.js';

export interface SimulationControlRequestRecord {
  requestKey: string;
  operation: SimulationControlOperation;
  runKey: string | null;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  actor: SimulationAuditActor;
  role: SimulationControlRole;
  acceptedAtMs: number;
}

export interface SimulationArtifactRecord {
  artifactId: string;
  runKey: string;
  kind: SimulationArtifactKind;
  requestKey: string;
  payloadFingerprint: string;
  payload: Record<string, unknown>;
  actor: SimulationAuditActor;
  role: SimulationControlRole;
  atMs: number;
}

export interface SimulationControlPersistenceRepository {
  insertControlRequest(record: SimulationControlRequestRecord): Promise<'inserted' | 'existing'>;
  findControlRequest(requestKey: string): Promise<SimulationControlRequestRecord | null>;
  insertArtifact(record: SimulationArtifactRecord): Promise<'inserted' | 'existing'>;
  findArtifact(artifactId: string): Promise<SimulationArtifactRecord | null>;
  listArtifacts(runKey: string): Promise<SimulationArtifactRecord[]>;
  projectPreflight(input: {
    runKey: string;
    checks: SimulationPreflightResult[];
    dataQuality: SimulationDataQualitySnapshot;
  }): Promise<boolean>;
}

export class SimulationControlPersistenceError extends Error {
  constructor(
    public readonly code: 'IDEMPOTENCY_CONFLICT' | 'ARTIFACT_CONFLICT' | 'RUN_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'SimulationControlPersistenceError';
  }
}

function opaque(prefix: string, value: unknown, length = 40): string {
  return `${prefix}_${simulationFingerprint(value).slice(0, length)}`;
}

export class SimulationControlPersistenceService {
  constructor(private readonly repository: SimulationControlPersistenceRepository) {}

  async claim(input: {
    operation: SimulationControlOperation;
    runKey: string | null;
    idempotencyKey: string;
    requestPayload: unknown;
    actor: SimulationAuditActor;
    role: SimulationControlRole;
    nowMs: number;
  }): Promise<SimulationControlRequestRecord> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new Error('idempotency key must contain 8-200 characters');
    }
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error('control request time is invalid');
    const idempotencyKeyHash = simulationFingerprint(idempotencyKey);
    const requestKey = opaque('ctl', {
      operation: input.operation,
      runKey: input.runKey,
      idempotencyKeyHash,
    });
    const requestFingerprint = simulationFingerprint(input.requestPayload);
    const proposed: SimulationControlRequestRecord = {
      requestKey,
      operation: input.operation,
      runKey: input.runKey,
      idempotencyKeyHash,
      requestFingerprint,
      actor: input.actor,
      role: input.role,
      acceptedAtMs: input.nowMs,
    };
    const disposition = await this.repository.insertControlRequest(proposed);
    if (disposition === 'inserted') return proposed;
    const existing = await this.repository.findControlRequest(requestKey);
    if (
      existing === null ||
      existing.operation !== proposed.operation ||
      existing.runKey !== proposed.runKey ||
      existing.requestFingerprint !== proposed.requestFingerprint ||
      existing.role !== proposed.role ||
      simulationFingerprint(existing.actor) !== simulationFingerprint(proposed.actor)
    ) {
      throw new SimulationControlPersistenceError(
        'IDEMPOTENCY_CONFLICT',
        'idempotency key is already bound to another control request'
      );
    }
    return existing;
  }

  async appendArtifact(input: {
    request: SimulationControlRequestRecord;
    runKey: string;
    kind: SimulationArtifactKind;
    payload: Record<string, unknown>;
  }): Promise<SimulationArtifactRecord> {
    const payloadFingerprint = simulationFingerprint(input.payload);
    const artifactId = opaque('art', {
      runKey: input.runKey,
      kind: input.kind,
      requestKey: input.request.requestKey,
    });
    const proposed: SimulationArtifactRecord = {
      artifactId,
      runKey: input.runKey,
      kind: input.kind,
      requestKey: input.request.requestKey,
      payloadFingerprint,
      payload: input.payload,
      actor: input.request.actor,
      role: input.request.role,
      atMs: input.request.acceptedAtMs,
    };
    const disposition = await this.repository.insertArtifact(proposed);
    if (disposition === 'inserted') return proposed;
    const existing = await this.repository.findArtifact(artifactId);
    if (
      existing === null ||
      existing.runKey !== proposed.runKey ||
      existing.kind !== proposed.kind ||
      existing.requestKey !== proposed.requestKey ||
      existing.payloadFingerprint !== proposed.payloadFingerprint
    ) {
      throw new SimulationControlPersistenceError(
        'ARTIFACT_CONFLICT',
        'artifact identity is already bound to different content'
      );
    }
    return existing;
  }

  async recordPreflight(input: {
    request: SimulationControlRequestRecord;
    runKey: string;
    checks: SimulationPreflightResult[];
    dataQuality: SimulationDataQualitySnapshot;
    passed: boolean;
  }): Promise<SimulationArtifactRecord> {
    const artifact = await this.appendArtifact({
      request: input.request,
      runKey: input.runKey,
      kind: 'preflight',
      payload: {
        passed: input.passed,
        checkedAtMs: input.request.acceptedAtMs,
        checks: input.checks,
        dataQuality: input.dataQuality,
      },
    });
    const projected = await this.repository.projectPreflight({
      runKey: input.runKey,
      checks: input.checks,
      dataQuality: input.dataQuality,
    });
    if (!projected) {
      throw new SimulationControlPersistenceError('RUN_NOT_FOUND', 'simulation run projection not found');
    }
    return artifact;
  }

  listArtifacts(runKey: string): Promise<SimulationArtifactRecord[]> {
    return this.repository.listArtifacts(runKey);
  }

  async findRequestArtifact(
    runKey: string,
    requestKey: string,
    kind: SimulationArtifactKind
  ): Promise<SimulationArtifactRecord | null> {
    const artifacts = await this.repository.listArtifacts(runKey);
    return artifacts.find(
      (artifact) => artifact.requestKey === requestKey && artifact.kind === kind
    ) ?? null;
  }
}
