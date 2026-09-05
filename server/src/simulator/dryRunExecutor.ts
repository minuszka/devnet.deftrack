import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import { z } from 'zod';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import { simulationActionIdFor } from '../domain/simulationIdentity.js';
import type { SimulationTargetCapability, SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { coreSimulatorReferenceFor } from './coreSimulatorAdapter.js';
import { parseScenarioRequest, type SimulationScenarioRequest } from './scenarioRegistry.js';
import {
  type DryRunContext,
  type DryRunImpactEstimate,
  type DryRunPlan,
  type DryRunRequest,
  type PlannedActionPayload,
  type PlannedSimulationAction,
} from './scenarioTypes.js';
import { selectSimulationTargets } from './targetSelection.js';

const targetIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const targetSnapshotSchema = z
  .object({
    targetId: targetIdSchema,
    displayLabel: z.string().min(1).max(200),
    operatorId: z.string().max(200).nullable(),
    proTxHash: z.string().max(128).nullable(),
    hostRef: z.string().min(1).max(200),
    // Optional, because absent means "the same as hostRef" -- see SimulationTarget.
    chainHostRef: z.string().min(1).max(200).nullable().optional(),
    unitRef: z.string().min(1).max(200),
    p2pPort: z.number().int().min(1).max(65_535),
    role: z.enum(['masternode', 'staker', 'seed']),
    network: z.enum(['regtest', 'devnet']),
    capabilities: z.array(z.enum(['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook'])),
    expectedBuild: z.string().max(200).nullable(),
    capturedAtMs: z.number().int().nonnegative(),
    capturedAtHeight: z.number().int().nonnegative(),
  })
  .strict();

const contextSchema = z
  .object({
    network: z.enum(['regtest', 'devnet']),
    currentHeight: z.number().int().nonnegative(),
    targets: z.array(targetSnapshotSchema).min(1).max(500),
    quorumMemberTargetIds: z.array(targetIdSchema).max(60),
    quorumThresholds: z
      .object({
        dkg: z.number().int().positive().nullable(),
        chainLock: z.number().int().positive().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

const dryRunRequestSchema = z
  .object({
    runKey: z.string().regex(/^sim_[0-9a-f]{32}$/),
    network: z.enum(['regtest', 'devnet']),
    scenario: z.unknown(),
  })
  .strict();

interface RawAction {
  targetId: string;
  payload: PlannedActionPayload;
  notBeforeOffsetMs: number;
  maxAttempts?: number;
}

const SERVICE_RECOVERY_GRACE_SECONDS = 120;
const ACTION_CLAIM_WINDOW_MS = 120_000;

function parseContext(input: unknown): DryRunContext {
  const context = contextSchema.parse(input);
  const byId = new Map<string, SimulationTargetSnapshot>();
  for (const target of context.targets) {
    if (target.network !== context.network) {
      throw new Error(`target network mismatch: ${target.targetId}`);
    }
    if (byId.has(target.targetId)) throw new Error(`duplicate targetId: ${target.targetId}`);
    if (new Set(target.capabilities).size !== target.capabilities.length) {
      throw new Error(`duplicate target capability: ${target.targetId}`);
    }
    byId.set(target.targetId, target);
  }
  if (new Set(context.quorumMemberTargetIds).size !== context.quorumMemberTargetIds.length) {
    throw new Error('quorumMemberTargetIds must be unique');
  }
  for (const targetId of context.quorumMemberTargetIds) {
    const target = byId.get(targetId);
    if (target === undefined || target.role !== 'masternode') {
      throw new Error(`quorum member is not a registered masternode: ${targetId}`);
    }
  }
  return context;
}

function eligibleTargets(
  context: DryRunContext,
  role: SimulationTargetSnapshot['role'],
  capability: SimulationTargetCapability
): SimulationTargetSnapshot[] {
  return context.targets.filter(
    (target) => target.role === role && target.capabilities.includes(capability)
  );
}

function selectedByCount(
  context: DryRunContext,
  request: SimulationScenarioRequest,
  role: SimulationTargetSnapshot['role'],
  capability: SimulationTargetCapability,
  count: number,
  targetIds?: readonly string[]
): SimulationTargetSnapshot[] {
  return selectSimulationTargets({
    candidates: eligibleTargets(context, role, capability),
    count,
    seed: request.seed,
    namespace: request.scenarioId,
    explicitTargetIds: targetIds,
  });
}

function serviceOutageActions(
  targets: readonly SimulationTargetSnapshot[],
  durationSeconds: number
): RawAction[] {
  return targets.flatMap((target) => [
    {
      targetId: target.targetId,
      payload: {
        kind: 'service-stop' as const,
        faultLeaseSeconds: durationSeconds + SERVICE_RECOVERY_GRACE_SECONDS,
      },
      notBeforeOffsetMs: 0,
    },
    {
      targetId: target.targetId,
      payload: { kind: 'service-start' as const },
      notBeforeOffsetMs: durationSeconds * 1_000,
    },
  ]);
}

function resolveTargets(
  request: SimulationScenarioRequest,
  context: DryRunContext
): { selected: SimulationTargetSnapshot[]; rawActions: RawAction[] } {
  switch (request.scenarioId) {
    case 'mn-stop': {
      const { count, durationSeconds, targetIds } = request.parameters;
      const selected = selectedByCount(context, request, 'masternode', 'service-control', count, targetIds);
      return { selected, rawActions: serviceOutageActions(selected, durationSeconds) };
    }
    case 'host-outage': {
      const anchor = context.targets.find((target) => target.targetId === request.parameters.anchorTargetId);
      if (anchor === undefined) throw new Error('host outage anchor is not registered');
      const selected = context.targets
        .filter((target) =>
          target.hostRef === anchor.hostRef &&
          target.capabilities.includes('service-control') &&
          // Never the seed, whatever else shares its host. It is where the
          // explorer's own RPC and ZMQ evidence comes from, so stopping it
          // stops the measurement rather than the network under test -- and a
          // host outage is about the masternodes on the host, not about
          // silencing the observer that would have recorded it.
          target.role !== 'seed'
        )
        .sort((a, b) => compareByCodeUnit(a.targetId, b.targetId));
      if (selected.length === 0) throw new Error('host has no service-control targets');
      if (selected.length > 20) throw new Error('host outage exceeds the maximum target count');
      const masternodes = selected.filter((target) => target.role === 'masternode').length;
      if (
        request.parameters.expectedMasternodes !== undefined &&
        masternodes !== request.parameters.expectedMasternodes
      ) {
        throw new Error(
          `host masternode count changed: expected ${request.parameters.expectedMasternodes}, found ${masternodes}`
        );
      }
      return {
        selected,
        rawActions: serviceOutageActions(selected, request.parameters.durationSeconds),
      };
    }
    case 'quorum-member-outage': {
      if (context.quorumMemberTargetIds.length === 0) {
        throw new Error('current quorum membership is required for this scenario');
      }
      const members = new Set(context.quorumMemberTargetIds);
      const candidates = eligibleTargets(context, 'masternode', 'service-control').filter((target) =>
        members.has(target.targetId)
      );
      const selected = selectSimulationTargets({
        candidates,
        count: request.parameters.count,
        seed: request.seed,
        namespace: `${request.scenarioId}:${request.parameters.phase}`,
        explicitTargetIds: request.parameters.targetIds,
      });
      return {
        selected,
        rawActions: serviceOutageActions(selected, request.parameters.durationSeconds),
      };
    }
    case 'staker-stop': {
      const { count, durationSeconds, targetIds } = request.parameters;
      const selected = selectedByCount(context, request, 'staker', 'service-control', count, targetIds);
      return { selected, rawActions: serviceOutageActions(selected, durationSeconds) };
    }
    case 'restart-flapping': {
      const { role, count, cycles, downSeconds, upSeconds, targetIds } = request.parameters;
      const selected = selectedByCount(context, request, role, 'service-control', count, targetIds);
      const rawActions: RawAction[] = [];
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        const cycleOffsetSeconds = cycle * (downSeconds + upSeconds);
        for (const target of selected) {
          rawActions.push({
            targetId: target.targetId,
            payload: {
              kind: 'service-stop',
              faultLeaseSeconds: downSeconds + SERVICE_RECOVERY_GRACE_SECONDS,
            },
            notBeforeOffsetMs: cycleOffsetSeconds * 1_000,
          });
          rawActions.push({
            targetId: target.targetId,
            payload: { kind: 'service-start' },
            notBeforeOffsetMs: (cycleOffsetSeconds + downSeconds) * 1_000,
          });
        }
      }
      return { selected, rawActions };
    }
    case 'network-degradation': {
      const { role, count, durationSeconds, latencyMs, jitterMs, lossPercent, correlationPercent, targetIds } =
        request.parameters;
      const selected = selectedByCount(context, request, role, 'netem-p2p', count, targetIds);
      return {
        selected,
        rawActions: selected.flatMap((target) => [
          {
            targetId: target.targetId,
            payload: {
              kind: 'netem-apply' as const,
              interfaceRef: 'devnet-p2p' as const,
              latencyMs,
              jitterMs,
              lossPercent,
              correlationPercent,
              faultLeaseSeconds: durationSeconds + SERVICE_RECOVERY_GRACE_SECONDS,
            },
            notBeforeOffsetMs: 0,
          },
          {
            targetId: target.targetId,
            payload: { kind: 'fault-clear' as const, scope: 'run' as const },
            notBeforeOffsetMs: durationSeconds * 1_000,
          },
        ]),
      };
    }
    case 'node-isolation': {
      const { count, durationSeconds, targetIds } = request.parameters;
      const selected = selectedByCount(context, request, 'masternode', 'partition-p2p', count, targetIds);
      const isolatedIds = new Set(selected.map((target) => target.targetId));
      const peerTargetIds = context.targets
        .filter((target) => !isolatedIds.has(target.targetId))
        .map((target) => target.targetId)
        .sort();
      if (peerTargetIds.length === 0) throw new Error('isolation requires at least one peer target');
      return {
        selected,
        rawActions: selected.flatMap((target) => [
          {
            targetId: target.targetId,
            payload: {
              kind: 'partition-apply' as const,
              p2pPortRef: 'devnet-p2p' as const,
              peerTargetIds,
              faultLeaseSeconds: durationSeconds + SERVICE_RECOVERY_GRACE_SECONDS,
            },
            notBeforeOffsetMs: 0,
          },
          {
            targetId: target.targetId,
            payload: { kind: 'fault-clear' as const, scope: 'run' as const },
            notBeforeOffsetMs: durationSeconds * 1_000,
          },
        ]),
      };
    }
    case 'clear-recover': {
      const byId = new Map(context.targets.map((target) => [target.targetId, target]));
      const selected = [...request.parameters.targetIds].sort().map((targetId) => {
        const target = byId.get(targetId);
        if (target === undefined) throw new Error(`target is not registered: ${targetId}`);
        return target;
      });
      return {
        selected,
        rawActions: selected.map((target) => ({
          targetId: target.targetId,
          payload: { kind: 'fault-clear', scope: 'run' },
          notBeforeOffsetMs: 0,
          maxAttempts: 5,
        })),
      };
    }
  }
}

function materializeActions(runKey: string, rawActions: readonly RawAction[]): PlannedSimulationAction[] {
  return [...rawActions]
    .sort(
      (a, b) =>
        a.notBeforeOffsetMs - b.notBeforeOffsetMs ||
        compareByCodeUnit(a.targetId, b.targetId) ||
        compareByCodeUnit(a.payload.kind, b.payload.kind)
    )
    .map((action, sequence) => {
      const kind = action.payload.kind;
      return {
        actionId: simulationActionIdFor({ runKey, sequence, kind, targetId: action.targetId }),
        runKey,
        sequence,
        targetId: action.targetId,
        kind,
        payload: action.payload,
        payloadDigest: simulationFingerprint(action.payload),
        notBeforeOffsetMs: action.notBeforeOffsetMs,
        expiresAfterMs: action.notBeforeOffsetMs + ACTION_CLAIM_WINDOW_MS,
        maxAttempts: action.maxAttempts ?? 3,
      };
    });
}

function estimateImpact(
  selected: readonly SimulationTargetSnapshot[],
  context: DryRunContext
): DryRunImpactEstimate {
  const selectedIds = new Set(selected.map((target) => target.targetId));
  const affectedQuorumMembers = context.quorumMemberTargetIds.filter((id) => selectedIds.has(id)).length;
  const quorumKnown = context.quorumMemberTargetIds.length > 0;
  const surviving = quorumKnown ? context.quorumMemberTargetIds.length - affectedQuorumMembers : null;
  const warnings: string[] = [];
  // From the profile in force, not from Q60's numbers. Pinned to 44 and 41,
  // every lab preview measured a devnet that was not there: on a 3/2/2 test
  // profile the margin is always negative, so every report came back degraded
  // whatever the fault actually did.
  const dkgThreshold = context.quorumThresholds?.dkg ?? null;
  const chainLockThreshold = context.quorumThresholds?.chainLock ?? null;
  if (!quorumKnown) warnings.push('Current quorum membership is unavailable; threshold margins are unknown.');
  if (dkgThreshold === null || chainLockThreshold === null) {
    warnings.push('Quorum thresholds for the active profile are unknown; margins are not computed.');
  }
  if (surviving !== null && dkgThreshold !== null && surviving < dkgThreshold) {
    warnings.push(`Planned fault falls below the DKG threshold (${dkgThreshold}).`);
  }
  if (surviving !== null && chainLockThreshold !== null && surviving < chainLockThreshold) {
    warnings.push(`Planned fault falls below the ChainLock threshold (${chainLockThreshold}).`);
  }

  return {
    affectedTargetCount: selected.length,
    affectedMasternodeCount: selected.filter((target) => target.role === 'masternode').length,
    affectedStakerCount: selected.filter((target) => target.role === 'staker').length,
    affectedHostCount: new Set(selected.map((target) => target.hostRef)).size,
    affectedCurrentQuorumMembers: affectedQuorumMembers,
    currentQuorumSize: quorumKnown ? context.quorumMemberTargetIds.length : null,
    survivingCurrentQuorumMembers: surviving,
    dkgThreshold,
    chainLockThreshold,
    dkgMarginAfterFault: surviving === null || dkgThreshold === null ? null : surviving - dkgThreshold,
    chainLockMarginAfterFault:
      surviving === null || chainLockThreshold === null ? null : surviving - chainLockThreshold,
    warnings,
  };
}

/**
 * Pure preview: validates, selects targets and returns an immutable action
 * description. It has no repository, RPC, SSH, Docker or clock dependency.
 */
export function generateDryRunPlan(requestInput: unknown, contextInput: unknown): DryRunPlan {
  const request = dryRunRequestSchema.parse(requestInput) as DryRunRequest;
  const context = parseContext(contextInput);
  if (request.network !== context.network) throw new Error('request network must match context network');
  const scenario = parseScenarioRequest(request.scenario);
  const { selected, rawActions } = resolveTargets(scenario, context);
  const actions = materializeActions(request.runKey, rawActions);
  const selectedTargetIds = selected.map((target) => target.targetId).sort();
  const selectedRoles = [...new Set(selected.map((target) => target.role))].sort();
  const planWithoutFingerprint = {
    mode: 'dry-run' as const,
    runKey: request.runKey,
    network: request.network,
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
    seed: scenario.seed,
    parameters: scenario.parameters,
    selectedTargetIds,
    selectedRoles,
    actions,
    impact: estimateImpact(selected, context),
    coreSimulator: coreSimulatorReferenceFor(scenario),
    assurances: [
      'NO_DATABASE_WRITE',
      'NO_RPC_CALL',
      'NO_REMOTE_ACTION',
      'NO_FAULT_APPLIED',
    ] as const,
  };
  return {
    ...planWithoutFingerprint,
    planFingerprint: simulationFingerprint(planWithoutFingerprint),
  };
}
