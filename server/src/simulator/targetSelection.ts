import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import { createHash } from 'node:crypto';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';

export interface SelectTargetsInput {
  candidates: readonly SimulationTargetSnapshot[];
  count: number;
  seed: string;
  namespace: string;
  explicitTargetIds?: readonly string[];
}

function rank(seed: string, namespace: string, targetId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['target-selection:v1', seed, namespace, targetId]))
    .digest('hex');
}

/**
 * Deterministic selection for reproducible experiments. It deliberately uses
 * no process-global PRNG and is independent of registry/database ordering.
 */
export function selectSimulationTargets(input: SelectTargetsInput): SimulationTargetSnapshot[] {
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    throw new Error('target count must be a positive safe integer');
  }

  const byId = new Map<string, SimulationTargetSnapshot>();
  for (const target of input.candidates) {
    if (byId.has(target.targetId)) throw new Error(`duplicate targetId: ${target.targetId}`);
    byId.set(target.targetId, target);
  }

  if (input.explicitTargetIds !== undefined) {
    const requested = [...new Set(input.explicitTargetIds)].sort();
    if (requested.length !== input.explicitTargetIds.length) {
      throw new Error('explicit targetIds must be unique');
    }
    if (requested.length !== input.count) {
      throw new Error(`explicit target count must equal ${input.count}`);
    }
    return requested.map((targetId) => {
      const target = byId.get(targetId);
      if (target === undefined) throw new Error(`target is not eligible: ${targetId}`);
      return target;
    });
  }

  if (input.count > byId.size) {
    throw new Error(`requested ${input.count} targets but only ${byId.size} are eligible`);
  }

  return [...byId.values()]
    .map((target) => ({ target, score: rank(input.seed, input.namespace, target.targetId) }))
    .sort((a, b) => compareByCodeUnit(a.score, b.score) || compareByCodeUnit(a.target.targetId, b.target.targetId))
    .slice(0, input.count)
    .map(({ target }) => target);
}
