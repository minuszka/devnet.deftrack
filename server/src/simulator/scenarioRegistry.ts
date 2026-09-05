import { z } from 'zod';
import { BLOCK_SECONDS } from '../domain/dkgWindows.js';
import {
  SIMULATION_SCENARIO_IDS,
  type ScenarioDescriptor,
  type SimulationScenarioId,
} from './scenarioTypes.js';

/**
 * The longest outage a scenario may ask for, in BLOCKS.
 *
 * Stated in blocks because the question every fault scenario is measured
 * against is how many DKG contribution windows a node was absent across, and
 * that is block arithmetic -- see domain/dkgWindows. As seconds the number said
 * nothing about what it permitted.
 *
 * What it permits, said plainly: six blocks guarantees ZERO missed windows at
 * any alignment. An unanchored outage must run 25 blocks -- 62 minutes on
 * devnet -- before it must miss even one, which is longer than the wrapper's own
 * TTL ceiling allows a fault to live. So an unanchored run cannot express the
 * experiment at all, and the answer is to anchor the outage on the schedule
 * rather than to raise either ceiling: anchored, one missed window costs two
 * blocks. See docs/simulator/OUTAGE_WINDOWS_HU.md before changing this.
 */
const MAX_OUTAGE_BLOCKS = 6;

export const SCENARIO_LIMITS = Object.freeze({
  maxTargets: 20,
  maxDurationSeconds: MAX_OUTAGE_BLOCKS * BLOCK_SECONDS,
  maxLatencyMs: 2_000,
  maxJitterMs: 1_000,
  maxPacketLossPercent: 30,
  maxFlapCycles: 5,
  maxStakers: 5,
  maxIsolatedTargets: 5,
});

const targetIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const targetIdsSchema = z.array(targetIdSchema).min(1).max(SCENARIO_LIMITS.maxTargets);
const seedSchema = z.string().trim().min(1).max(128);
const durationSchema = z.number().int().min(5).max(SCENARIO_LIMITS.maxDurationSeconds);
const countSchema = z.number().int().min(1).max(SCENARIO_LIMITS.maxTargets);

const scenarioHeader = {
  scenarioVersion: z.literal(1),
  seed: seedSchema,
};

const mnStopSchema = z
  .object({
    scenarioId: z.literal('mn-stop'),
    ...scenarioHeader,
    parameters: z
      .object({ count: countSchema, durationSeconds: durationSchema, targetIds: targetIdsSchema.optional() })
      .strict(),
  })
  .strict();

const hostOutageSchema = z
  .object({
    scenarioId: z.literal('host-outage'),
    ...scenarioHeader,
    parameters: z
      .object({
        anchorTargetId: targetIdSchema,
        durationSeconds: durationSchema,
        expectedMasternodes: z.number().int().min(1).max(SCENARIO_LIMITS.maxTargets).optional(),
      })
      .strict(),
  })
  .strict();

const quorumMemberOutageSchema = z
  .object({
    scenarioId: z.literal('quorum-member-outage'),
    ...scenarioHeader,
    parameters: z
      .object({
        count: countSchema,
        phase: z.enum(['dkg', 'chainlock']),
        durationSeconds: durationSchema,
        targetIds: targetIdsSchema.optional(),
      })
      .strict(),
  })
  .strict();

const stakerStopSchema = z
  .object({
    scenarioId: z.literal('staker-stop'),
    ...scenarioHeader,
    parameters: z
      .object({
        count: z.number().int().min(1).max(SCENARIO_LIMITS.maxStakers),
        durationSeconds: durationSchema,
        targetIds: targetIdsSchema.optional(),
      })
      .strict(),
  })
  .strict();

const restartFlappingSchema = z
  .object({
    scenarioId: z.literal('restart-flapping'),
    ...scenarioHeader,
    parameters: z
      .object({
        role: z.enum(['masternode', 'staker']),
        count: z.number().int().min(1).max(10),
        cycles: z.number().int().min(1).max(SCENARIO_LIMITS.maxFlapCycles),
        // `count` is bounded again below, against maxStakers when the role is
        // staker: block production rests on those daemons, and flapping ten of
        // them is a different experiment from flapping ten masternodes.
        downSeconds: z.number().int().min(5).max(60),
        upSeconds: z.number().int().min(5).max(120),
        targetIds: targetIdsSchema.optional(),
      })
      .strict()
      .refine(
        (value) => value.role !== 'staker' || value.count <= SCENARIO_LIMITS.maxStakers,
        { message: `at most ${SCENARIO_LIMITS.maxStakers} stakers may be flapped at once` }
      ),
  })
  .strict();

const networkDegradationSchema = z
  .object({
    scenarioId: z.literal('network-degradation'),
    ...scenarioHeader,
    parameters: z
      .object({
        // No 'seed'. The seed is where the explorer's RPC and ZMQ evidence
        // comes from, so impairing it degrades the measurement rather than the
        // network under test -- and the result would look like a network
        // finding. A seed fault, if it is ever wanted, needs its own scenario
        // that says what it is doing to the observer.
        role: z.enum(['masternode', 'staker']),
        count: z.number().int().min(1).max(10),
        durationSeconds: durationSchema,
        latencyMs: z.number().int().min(0).max(SCENARIO_LIMITS.maxLatencyMs),
        jitterMs: z.number().int().min(0).max(SCENARIO_LIMITS.maxJitterMs),
        lossPercent: z.number().min(0).max(SCENARIO_LIMITS.maxPacketLossPercent),
        correlationPercent: z.number().min(0).max(100),
        targetIds: targetIdsSchema.optional(),
      })
      .strict(),
  })
  .strict();

const nodeIsolationSchema = z
  .object({
    scenarioId: z.literal('node-isolation'),
    ...scenarioHeader,
    parameters: z
      .object({
        count: z.number().int().min(1).max(SCENARIO_LIMITS.maxIsolatedTargets),
        durationSeconds: durationSchema,
        targetIds: targetIdsSchema.optional(),
      })
      .strict(),
  })
  .strict();

const clearRecoverSchema = z
  .object({
    scenarioId: z.literal('clear-recover'),
    ...scenarioHeader,
    parameters: z.object({ targetIds: targetIdsSchema }).strict(),
  })
  .strict();

export const simulationScenarioRequestSchema = z.discriminatedUnion('scenarioId', [
  mnStopSchema,
  hostOutageSchema,
  quorumMemberOutageSchema,
  stakerStopSchema,
  restartFlappingSchema,
  networkDegradationSchema,
  nodeIsolationSchema,
  clearRecoverSchema,
]);

export type SimulationScenarioRequest = z.infer<typeof simulationScenarioRequestSchema>;

export const SCENARIO_REGISTRY: Readonly<Record<SimulationScenarioId, ScenarioDescriptor>> = {
  'mn-stop': {
    scenarioId: 'mn-stop', version: 1, title: 'Masternode stop',
    description: 'One or more masternodes are stopped and later restarted.', riskClass: 'medium',
  },
  'host-outage': {
    scenarioId: 'host-outage', version: 1, title: 'Full host outage',
    description: 'All allowlisted services on one registered host are stopped.', riskClass: 'high',
  },
  'quorum-member-outage': {
    scenarioId: 'quorum-member-outage', version: 1, title: 'Quorum member outage',
    description: 'Current quorum members are stopped around DKG or ChainLock activity.', riskClass: 'high',
  },
  'staker-stop': {
    scenarioId: 'staker-stop', version: 1, title: 'Staker stop',
    description: 'One or more allowlisted stakers are stopped and restarted.', riskClass: 'medium',
  },
  'restart-flapping': {
    scenarioId: 'restart-flapping', version: 1, title: 'Restart and flapping',
    description: 'Selected services repeatedly alternate between stopped and running.', riskClass: 'high',
  },
  'network-degradation': {
    scenarioId: 'network-degradation', version: 1, title: 'Latency, jitter and loss',
    description: 'Bounded network impairment is applied only to the devnet P2P interface.', riskClass: 'high',
  },
  'node-isolation': {
    scenarioId: 'node-isolation', version: 1, title: 'P2P isolation',
    description: 'Selected nodes are isolated from the other registered targets.', riskClass: 'high',
  },
  'clear-recover': {
    scenarioId: 'clear-recover', version: 1, title: 'Clear and recover',
    description: 'Known simulator fault state is cleared for selected targets.', riskClass: 'low',
  },
};

export const SIMULATION_PRESET_IDS = [
  'dkg-minus-16',
  'dkg-minus-17',
  'chainlock-minus-19',
  'chainlock-minus-20',
  'host-10-masternodes',
  'one-staker-outage',
  'multi-staker-outage',
] as const;
export type SimulationPresetId = (typeof SIMULATION_PRESET_IDS)[number];

const PRESET_BASES: Record<SimulationPresetId, Record<string, unknown>> = {
  'dkg-minus-16': { scenarioId: 'quorum-member-outage', scenarioVersion: 1, parameters: { count: 16, phase: 'dkg', durationSeconds: 180 } },
  'dkg-minus-17': { scenarioId: 'quorum-member-outage', scenarioVersion: 1, parameters: { count: 17, phase: 'dkg', durationSeconds: 180 } },
  'chainlock-minus-19': { scenarioId: 'quorum-member-outage', scenarioVersion: 1, parameters: { count: 19, phase: 'chainlock', durationSeconds: 180 } },
  'chainlock-minus-20': { scenarioId: 'quorum-member-outage', scenarioVersion: 1, parameters: { count: 20, phase: 'chainlock', durationSeconds: 180 } },
  'host-10-masternodes': { scenarioId: 'host-outage', scenarioVersion: 1, parameters: { durationSeconds: 180, expectedMasternodes: 10 } },
  'one-staker-outage': { scenarioId: 'staker-stop', scenarioVersion: 1, parameters: { count: 1, durationSeconds: 180 } },
  'multi-staker-outage': { scenarioId: 'staker-stop', scenarioVersion: 1, parameters: { count: 3, durationSeconds: 180 } },
};

function validateCrossFields(request: SimulationScenarioRequest): SimulationScenarioRequest {
  const parameters = request.parameters;
  if ('targetIds' in parameters && parameters.targetIds !== undefined) {
    if (new Set(parameters.targetIds).size !== parameters.targetIds.length) {
      throw new Error('targetIds must be unique');
    }
    if ('count' in parameters && parameters.targetIds.length !== parameters.count) {
      throw new Error('targetIds length must equal count');
    }
  }
  if (request.scenarioId === 'network-degradation') {
    const { latencyMs, jitterMs, lossPercent } = request.parameters;
    if (latencyMs === 0 && jitterMs === 0 && lossPercent === 0) {
      throw new Error('network degradation must configure latency, jitter or packet loss');
    }
    if (jitterMs > latencyMs) {
      throw new Error('jitterMs must not exceed latencyMs');
    }
  }
  if (request.scenarioId === 'restart-flapping') {
    const total = request.parameters.cycles * (request.parameters.downSeconds + request.parameters.upSeconds);
    if (total > SCENARIO_LIMITS.maxDurationSeconds) {
      throw new Error('flapping schedule exceeds the maximum duration');
    }
  }
  return request;
}

export function parseScenarioRequest(input: unknown): SimulationScenarioRequest {
  return validateCrossFields(simulationScenarioRequestSchema.parse(input));
}

export function scenarioDescriptors(): ScenarioDescriptor[] {
  return SIMULATION_SCENARIO_IDS.map((id) => ({ ...SCENARIO_REGISTRY[id] }));
}

/** Builds a normal validated request; presets are shortcuts, not a validation bypass. */
export function scenarioRequestFromPreset(
  presetId: SimulationPresetId,
  seed: string,
  parameterOverrides: Record<string, unknown> = {}
): SimulationScenarioRequest {
  const base = PRESET_BASES[presetId];
  const baseParameters = base.parameters as Record<string, unknown>;
  return parseScenarioRequest({
    ...base,
    seed,
    parameters: { ...baseParameters, ...parameterOverrides },
  });
}
