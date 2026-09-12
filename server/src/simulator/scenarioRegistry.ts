import { z } from 'zod';
import { BLOCK_SECONDS } from '../domain/dkgWindows.js';
import {
  DSL_EPOCH_BLOCKS,
  DSL_FAULT_KINDS,
  SIMULATION_SCENARIO_IDS,
  type ScenarioCatalogueEntry,
  type ScenarioDescriptor,
  type ScenarioField,
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

/**
 * A Sentinel Layer fault on running masternodes: the node itself withholds or
 * delays its own DSL announcement or reports, or withholds its part of a
 * commitment, for whole epochs. Nothing is stopped and no packet is dropped;
 * the ceiling is therefore not the outage ceiling above but the number of
 * epochs, kept under `nDSLSuspendEpochs` (4) so even an enforcing chain could
 * not suspend a target from one run.
 */
export const DSL_FAULT_LIMITS = Object.freeze({
  maxEpochs: 3,
  maxDelayBlocks: DSL_EPOCH_BLOCKS,
});

const dslFaultSchema = z
  .object({
    scenarioId: z.literal('dsl-fault'),
    ...scenarioHeader,
    parameters: z
      .object({
        faultKind: z.enum(DSL_FAULT_KINDS),
        count: countSchema,
        epochs: z.number().int().min(1).max(DSL_FAULT_LIMITS.maxEpochs),
        /** Delay in blocks for the *-delay kinds; must be absent or 0 for the others. */
        param: z.number().int().min(0).max(DSL_FAULT_LIMITS.maxDelayBlocks).optional(),
        targetIds: targetIdsSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const simulationScenarioRequestSchema = z.discriminatedUnion('scenarioId', [
  dslFaultSchema,
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
  'dsl-fault': {
    scenarioId: 'dsl-fault', version: 1, title: 'Sentinel Layer fault',
    description: 'Running masternodes withhold or delay their own DSL announcements, reports or commitment share for whole epochs (test networks only).',
    riskClass: 'medium',
  },
};

/**
 * A target id that is syntactically valid and deliberately does not exist.
 *
 * The panel used to seed these fields with `target-id`, which reads like a
 * value somebody might have meant. The distinction it blurred is the one that
 * matters here: a parameter object can satisfy the schema completely and still
 * name no registered target, and the two failures are found in different places
 * -- the schema at parse time, the target at resolution time. A placeholder
 * that cannot be mistaken for a real id keeps them apart.
 */
export const PLACEHOLDER_TARGET_ID = 'replace-with-a-registered-target-id';

/**
 * One schema-valid parameter object per scenario, so the panel never has to
 * guess what a scenario takes.
 *
 * It lives here, next to the schema, rather than in the client: a table of
 * defaults maintained separately from the validator drifts, and it did -- the
 * panel had no entry for `dsl-fault` at all and sent `{}`, which is missing
 * three required fields. Keyed by the scenario id union, so a scenario added to
 * the registry without a template fails to compile.
 *
 * These are starting points, not runs. `scenarioRegistry.test.ts` puts every one
 * of them through `parseScenarioRequest`, which is the only claim they make.
 */
export const SCENARIO_PARAMETER_TEMPLATES: Readonly<
  Record<SimulationScenarioId, Readonly<Record<string, unknown>>>
> = {
  'mn-stop': { count: 1, durationSeconds: 60 },
  'host-outage': { anchorTargetId: PLACEHOLDER_TARGET_ID, durationSeconds: 60 },
  'quorum-member-outage': { count: 1, phase: 'dkg', durationSeconds: 60 },
  'staker-stop': { count: 1, durationSeconds: 60 },
  'restart-flapping': { role: 'masternode', count: 1, cycles: 1, downSeconds: 10, upSeconds: 10 },
  'network-degradation': {
    role: 'masternode',
    count: 1,
    durationSeconds: 60,
    latencyMs: 100,
    jitterMs: 20,
    lossPercent: 1,
    correlationPercent: 0,
  },
  'node-isolation': { count: 1, durationSeconds: 60 },
  'clear-recover': { targetIds: [PLACEHOLDER_TARGET_ID] },
  // The smallest observable Sentinel fault: one running masternode withholds
  // one response for one epoch. The panel sent `{}` here, which the schema
  // refuses for three separate missing fields.
  'dsl-fault': { faultKind: 'response-drop', count: 1, epochs: 1 },
};

/**
 * The four scenarios day 15 gives a form to, field by field.
 *
 * Every bound here is the schema's own bound, and `scenarioFields.test.ts`
 * proves it by pushing values at `parseScenarioRequest` -- one inside each
 * bound, one outside -- rather than by reading this table back to itself.
 *
 * The scenarios that are absent are absent on purpose. They take a target
 * chooser that does not exist yet (day 16), and a number field that silently
 * dropped `anchorTargetId` would produce a request the registry cannot
 * resolve. Those keep the JSON view until there is something real to draw.
 */
const durationField = (help: string): ScenarioField => ({
  name: 'durationSeconds',
  label: 'Duration',
  kind: 'integer',
  required: true,
  min: 5,
  max: SCENARIO_LIMITS.maxDurationSeconds,
  unit: 'seconds',
  help,
});

const targetIdsField: ScenarioField = {
  name: 'targetIds',
  label: 'Explicit target ids',
  kind: 'target-ids',
  required: false,
  help: 'Leave empty to let the server choose. If given, the list must be unique and exactly as long as the count.',
};

export const SCENARIO_FIELDS: Readonly<Partial<Record<SimulationScenarioId, ScenarioField[]>>> = {
  'mn-stop': [
    {
      name: 'count',
      label: 'Masternodes to stop',
      kind: 'integer',
      required: true,
      min: 1,
      max: SCENARIO_LIMITS.maxTargets,
      unit: 'nodes',
    },
    durationField(
      `At most ${MAX_OUTAGE_BLOCKS} blocks. An unanchored outage this short cannot be guaranteed to miss a DKG contribution window -- that is what anchoring is for, not a longer outage.`
    ),
    targetIdsField,
  ],
  'staker-stop': [
    {
      name: 'count',
      label: 'Stakers to stop',
      kind: 'integer',
      required: true,
      min: 1,
      // Lower than every other count, and deliberately: stopping stakers stops
      // block production, and the chain only advances while something stakes.
      max: SCENARIO_LIMITS.maxStakers,
      unit: 'stakers',
      help: 'Capped well below the masternode count: these are the daemons that produce blocks.',
    },
    durationField('At most six blocks, measured the same way as every other outage.'),
    targetIdsField,
  ],
  'quorum-member-outage': [
    {
      name: 'count',
      label: 'Members to stop',
      kind: 'integer',
      required: true,
      min: 1,
      max: SCENARIO_LIMITS.maxTargets,
      unit: 'members',
    },
    {
      name: 'phase',
      label: 'Around which activity',
      kind: 'enum',
      required: true,
      values: ['dkg', 'chainlock'],
      help: 'Which schedule the outage is aimed at. A member absent around DKG is punished; one absent around signing is not, and that difference is the measurement.',
    },
    durationField('At most six blocks.'),
    targetIdsField,
  ],
  'dsl-fault': [
    {
      name: 'faultKind',
      label: 'Fault',
      kind: 'enum',
      required: true,
      values: DSL_FAULT_KINDS,
      help: 'Spelled as the node spells it. Nothing is stopped: the node withholds or delays its own Sentinel traffic.',
    },
    {
      name: 'count',
      label: 'Masternodes affected',
      kind: 'integer',
      required: true,
      min: 1,
      max: SCENARIO_LIMITS.maxTargets,
      unit: 'nodes',
    },
    {
      name: 'epochs',
      label: 'Epochs',
      kind: 'integer',
      required: true,
      min: 1,
      max: DSL_FAULT_LIMITS.maxEpochs,
      unit: 'epochs',
      help: `One epoch is ${DSL_EPOCH_BLOCKS} blocks. Kept under the node's own suspend threshold, so a single run cannot suspend a target.`,
    },
    {
      name: 'param',
      label: 'Delay',
      kind: 'integer',
      required: true,
      min: 1,
      max: DSL_FAULT_LIMITS.maxDelayBlocks,
      unit: 'blocks',
      help: 'Only the delay kinds take this, and they require it: the node refuses a delay of zero blocks as not a delay.',
      onlyWhen: { field: 'faultKind', values: ['response-delay', 'report-delay'] },
    },
    targetIdsField,
  ],
};

export const SIMULATION_PRESET_IDS = [
  'dkg-minus-16',
  'dkg-minus-17',
  'chainlock-minus-19',
  'chainlock-minus-20',
  'host-10-masternodes',
  'one-staker-outage',
  'multi-staker-outage',
  'dsl-response-drop-1',
  'dsl-report-drop-1',
  'dsl-commitment-skip-1',
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
  // One running masternode, one epoch: its sentinels report it MISSED once and
  // the next clean epoch resets it -- the smallest observable DSL fault.
  'dsl-response-drop-1': { scenarioId: 'dsl-fault', scenarioVersion: 1, parameters: { faultKind: 'response-drop', count: 1, epochs: 1 } },
  'dsl-report-drop-1': { scenarioId: 'dsl-fault', scenarioVersion: 1, parameters: { faultKind: 'report-drop', count: 1, epochs: 1 } },
  'dsl-commitment-skip-1': { scenarioId: 'dsl-fault', scenarioVersion: 1, parameters: { faultKind: 'commitment-skip', count: 1, epochs: 1 } },
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
  if (request.scenarioId === 'dsl-fault') {
    // The node refuses a delay of zero blocks as "not a delay"; refusing it here
    // keeps the run from being armed around a fault the node will not take.
    const { faultKind, param } = request.parameters;
    const isDelay = faultKind === 'response-delay' || faultKind === 'report-delay';
    if (isDelay && (param === undefined || param < 1)) {
      throw new Error(`${faultKind} needs param, the delay in blocks (1..${DSL_FAULT_LIMITS.maxDelayBlocks})`);
    }
    if (!isDelay && param !== undefined && param !== 0) {
      throw new Error(`${faultKind} takes no param`);
    }
  }
  return request;
}

export function parseScenarioRequest(input: unknown): SimulationScenarioRequest {
  return validateCrossFields(simulationScenarioRequestSchema.parse(input));
}

export function scenarioDescriptors(): ScenarioCatalogueEntry[] {
  return SIMULATION_SCENARIO_IDS.map((id) => {
    const parameterTemplate = { ...SCENARIO_PARAMETER_TEMPLATES[id] };
    const parameterFields = SCENARIO_FIELDS[id];
    return {
      ...SCENARIO_REGISTRY[id],
      parameterTemplate,
      ...(parameterFields === undefined ? {} : { parameterFields }),
      // Whether the operator has to replace something before this can resolve.
      // Said by the server rather than sniffed for by the panel, because the
      // placeholder is the server's own constant.
      templateNeedsTargetId: JSON.stringify(parameterTemplate).includes(PLACEHOLDER_TARGET_ID),
    };
  });
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
