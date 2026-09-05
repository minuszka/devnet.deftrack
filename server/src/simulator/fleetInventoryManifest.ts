import { z } from 'zod';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import type { SimulationNetwork } from '../models/SimulationRun.js';
import {
  simulationTargetRegistrationSchema,
  type SimulationTargetRegistration,
} from './targetRegistration.js';

/**
 * A reviewable declaration of the complete private faultable fleet.
 *
 * The manifest is deliberately only a parser and a diff producer. It never
 * scans hosts and never writes SimulationTarget: importing a host/unit mapping
 * is a separate, explicitly authorised admin operation.
 */
export const fleetInventoryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inventoryId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    network: z.enum(['regtest', 'devnet']),
    /** Declared separately so a missing host cannot be hidden by fewer rows. */
    expectedHostCount: z.number().int().min(1).max(50),
    limits: z.object({
      maxEnabledTargetsTotal: z.number().int().min(1).max(250),
      maxEnabledTargetsPerHost: z.number().int().min(1).max(50),
    }).strict(),
    targets: z.array(simulationTargetRegistrationSchema).min(1).max(250),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const targetIds = new Set<string>();
    const proTxHashes = new Set<string>();
    const hostUnits = new Set<string>();
    const hostPorts = new Set<string>();
    const perHost = new Map<string, number>();
    for (const [index, target] of manifest.targets.entries()) {
      if (target.network !== manifest.network) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', index, 'network'],
          message: 'target network must match manifest network',
        });
      }
      const duplicate = (set: Set<string>, value: string, path: (string | number)[], message: string) => {
        if (set.has(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
        set.add(value);
      };
      duplicate(targetIds, target.targetId, ['targets', index, 'targetId'], 'targetId must be unique');
      duplicate(hostUnits, `${target.hostRef}\u0000${target.unitRef}`, ['targets', index, 'unitRef'], 'host/unit mapping must be unique');
      duplicate(hostPorts, `${target.hostRef}\u0000${target.p2pPort}`, ['targets', index, 'p2pPort'], 'host/P2P-port mapping must be unique');
      if (target.proTxHash !== null) {
        duplicate(proTxHashes, target.proTxHash, ['targets', index, 'proTxHash'], 'proTxHash must be unique');
      }
      if (target.role === 'masternode' && target.proTxHash === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', index, 'proTxHash'],
          message: 'a masternode manifest entry requires a proTxHash',
        });
      }
      perHost.set(target.hostRef, (perHost.get(target.hostRef) ?? 0) + 1);
    }
    if (manifest.targets.length > manifest.limits.maxEnabledTargetsTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxEnabledTargetsTotal'],
        message: 'manifest target count exceeds its aggregate approved limit',
      });
    }
    if (perHost.size !== manifest.expectedHostCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedHostCount'],
        message: `manifest declares ${perHost.size} host(s), not ${manifest.expectedHostCount}`,
      });
    }
    for (const [hostRef, count] of perHost) {
      if (count > manifest.limits.maxEnabledTargetsPerHost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['limits', 'maxEnabledTargetsPerHost'],
          message: `host ${hostRef} has ${count} targets, above its approved limit`,
        });
      }
    }
  });

export type FleetInventoryManifest = z.infer<typeof fleetInventoryManifestSchema>;

export interface ValidatedFleetInventoryManifest extends FleetInventoryManifest {
  hostRefs: string[];
  manifestFingerprint: string;
}

function canonicalTarget(target: SimulationTargetRegistration): SimulationTargetRegistration {
  return {
    ...target,
    capabilities: [...target.capabilities].sort(compareByCodeUnit),
    labels: [...target.labels].sort(compareByCodeUnit),
  };
}

/** Parses and canonicalises a manifest without reading or changing external state. */
export function parseFleetInventoryManifest(input: unknown): ValidatedFleetInventoryManifest {
  const manifest = fleetInventoryManifestSchema.parse(input);
  const targets = manifest.targets.map(canonicalTarget).sort((a, b) => compareByCodeUnit(a.targetId, b.targetId));
  const hostRefs = [...new Set(targets.map((target) => target.hostRef))].sort(compareByCodeUnit);
  const canonical = { ...manifest, targets };
  return {
    ...canonical,
    hostRefs,
    manifestFingerprint: simulationFingerprint(canonical),
  };
}

/** A registry-shaped record accepted by the pure manifest preview. */
export interface ExistingFleetInventoryTarget extends SimulationTargetRegistration {
  enabled: boolean;
}

export interface FleetInventoryImportPreview {
  network: SimulationNetwork;
  manifestFingerprint: string;
  createTargetIds: string[];
  updateTargetIds: string[];
  unchangedTargetIds: string[];
  /** Existing records absent from the full declaration. Preview never deletes them. */
  undeclaredExistingTargetIds: string[];
  /** Changes to an enabled target need an explicit disable/review step. */
  enabledTargetMappingChangeIds: string[];
}

function registrationIdentity(
  target: SimulationTargetRegistration | ExistingFleetInventoryTarget
): SimulationTargetRegistration {
  // Do not spread an existing database record: its operational `enabled` bit
  // is intentionally outside a declaration and must not make an otherwise
  // identical manifest look like an update.
  return canonicalTarget({
    targetId: target.targetId,
    displayLabel: target.displayLabel,
    operatorId: target.operatorId,
    proTxHash: target.proTxHash,
    hostRef: target.hostRef,
    chainHostRef: target.chainHostRef,
    unitRef: target.unitRef,
    p2pPort: target.p2pPort,
    role: target.role,
    network: target.network,
    capabilities: target.capabilities,
    expectedBuild: target.expectedBuild,
    labels: target.labels,
    maintenance: target.maintenance,
  });
}

/**
 * Computes a no-write import plan. Existing records from other networks are
 * ignored; absence is reported but is never treated as a deletion instruction.
 */
export function previewFleetInventoryImport(input: {
  manifest: ValidatedFleetInventoryManifest;
  existing: readonly ExistingFleetInventoryTarget[];
}): FleetInventoryImportPreview {
  const existing = input.existing.filter((target) => target.network === input.manifest.network);
  const existingById = new Map<string, ExistingFleetInventoryTarget>();
  for (const target of existing) {
    if (existingById.has(target.targetId)) throw new Error(`existing registry has duplicate targetId: ${target.targetId}`);
    existingById.set(target.targetId, target);
  }
  const createTargetIds: string[] = [];
  const updateTargetIds: string[] = [];
  const unchangedTargetIds: string[] = [];
  const enabledTargetMappingChangeIds: string[] = [];
  const declared = new Set(input.manifest.targets.map((target) => target.targetId));
  for (const target of input.manifest.targets) {
    const previous = existingById.get(target.targetId);
    if (previous === undefined) {
      createTargetIds.push(target.targetId);
      continue;
    }
    if (simulationFingerprint(registrationIdentity(previous)) === simulationFingerprint(registrationIdentity(target))) {
      unchangedTargetIds.push(target.targetId);
      continue;
    }
    updateTargetIds.push(target.targetId);
    const mappingChanged =
      previous.hostRef !== target.hostRef ||
      previous.chainHostRef !== target.chainHostRef ||
      previous.unitRef !== target.unitRef ||
      previous.p2pPort !== target.p2pPort ||
      previous.proTxHash !== target.proTxHash ||
      previous.role !== target.role;
    if (previous.enabled && mappingChanged) enabledTargetMappingChangeIds.push(target.targetId);
  }
  return {
    network: input.manifest.network,
    manifestFingerprint: input.manifest.manifestFingerprint,
    createTargetIds,
    updateTargetIds,
    unchangedTargetIds,
    undeclaredExistingTargetIds: existing
      .filter((target) => !declared.has(target.targetId))
      .map((target) => target.targetId)
      .sort(compareByCodeUnit),
    enabledTargetMappingChangeIds,
  };
}
