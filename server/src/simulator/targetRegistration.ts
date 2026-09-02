import { z } from 'zod';

/**
 * The declaration that puts a target into the execution registry.
 *
 * Until now nothing wrote `SimulationTarget` at all -- ten modules read it and
 * none filled it -- so every run, dry or live, on either network, stopped at
 * "target inventory is incomplete: no eligible targets". A registry that cannot
 * be populated is a registry that blocks everything downstream of it.
 *
 * Targets are DECLARED, never inferred. That is the project's standing rule for
 * operator attribution and it holds with more force here: `hostRef` and
 * `unitRef` are what the executor eventually acts on, and a value discovered by
 * scanning the environment would let whatever is running decide what may be
 * faulted. A lab seeder is welcome to call this endpoint -- it is then declaring,
 * not inferring.
 *
 * Registration is not permission, and that is enforced rather than merely
 * intended: `enabled` is not a field of a declaration at all. The first version
 * of this schema defaulted it to false and then accepted `enabled: true` in the
 * very same request, so the two-step model existed only in the comment. Enabling
 * is a separate operation, reserved to safety-admin.
 */

const HEX64 = /^[0-9a-f]{64}$/;

export const simulationTargetRegistrationSchema = z
  .object({
    targetId: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, 'targetId must be lowercase, 2-64 chars'),
    displayLabel: z.string().min(1).max(120),
    operatorId: z.string().min(1).max(120).nullable().default(null),
    proTxHash: z.string().regex(HEX64, 'proTxHash must be 64 lowercase hex').nullable().default(null),
    // Private registry references. Never returned from a public DTO.
    hostRef: z.string().min(1).max(200),
    unitRef: z.string().min(1).max(200),
    p2pPort: z.number().int().min(1).max(65_535),
    role: z.enum(['masternode', 'staker', 'seed']),
    network: z.enum(['regtest', 'devnet']),
    capabilities: z
      .array(z.enum(['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook']))
      .max(4),
    expectedBuild: z.string().regex(HEX64, 'expectedBuild must be 64 lowercase hex').nullable().default(null),
    labels: z.array(z.string().min(1).max(60)).max(16).default([]),
    maintenance: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.capabilities).size !== value.capabilities.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'capabilities must be unique' });
    }
    if (new Set(value.labels).size !== value.labels.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['labels'], message: 'labels must be unique' });
    }
  });

export type SimulationTargetRegistration = z.infer<typeof simulationTargetRegistrationSchema>;

/** The mutable half of a registration; `targetId` is immutable once declared. */
export function registryUpdateFrom(input: SimulationTargetRegistration): Omit<SimulationTargetRegistration, 'targetId'> {
  const { targetId: _immutable, ...rest } = input;
  return rest;
}
