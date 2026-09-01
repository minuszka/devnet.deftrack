import { createHash } from 'node:crypto';

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function digest(namespace: string, parts: readonly (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify([namespace, ...parts])).digest('hex');
}

/**
 * Stable run key for a client idempotency key.
 *
 * The raw key is deliberately hashed: request identifiers can contain ticket
 * numbers or other operator context which does not belong in a public URL.
 * Replaying the same create request produces the same key and is resolved by a
 * unique database index when persistence is added.
 */
export function simulationRunKeyFor(idempotencyKey: string): string {
  const key = required(idempotencyKey, 'idempotencyKey');
  return `sim_${digest('simulation-run:v1', [key]).slice(0, 32)}`;
}

export interface SimulationActionIdentity {
  runKey: string;
  sequence: number;
  kind: string;
  targetId: string;
}

/**
 * Stable action id derived from the immutable execution plan.
 *
 * A worker retry or process restart therefore addresses the same action rather
 * than creating a second remote mutation. `sequence` is included because two
 * actions of the same kind can intentionally target the same node in one run.
 */
export function simulationActionIdFor(input: SimulationActionIdentity): string {
  const runKey = required(input.runKey, 'runKey');
  const kind = required(input.kind, 'kind');
  const targetId = required(input.targetId, 'targetId');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new Error('sequence must be a non-negative safe integer');
  }

  return `act_${digest('simulation-action:v1', [runKey, input.sequence, kind, targetId]).slice(0, 40)}`;
}
