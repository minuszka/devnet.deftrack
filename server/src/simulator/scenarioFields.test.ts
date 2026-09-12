import { describe, expect, it } from 'vitest';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationTargetCapability, SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { generateDryRunPlan } from './dryRunExecutor.js';
import { labFaultsForPlan } from './liveExecutorPlan.js';
import {
  SCENARIO_FIELDS,
  SCENARIO_PARAMETER_TEMPLATES,
  parseScenarioRequest,
  scenarioDescriptors,
} from './scenarioRegistry.js';
import { SIMULATION_SCENARIO_IDS, type ScenarioField, type SimulationScenarioId } from './scenarioTypes.js';

/**
 * The form metadata, held against the code that actually decides.
 *
 * A table of field bounds maintained beside a schema drifts from it. This
 * project has already watched that happen once, in the panel's own copy of the
 * parameter defaults: it had no entry for `dsl-fault` at all and offered `{}`,
 * three required fields short, refused by the server with nothing on screen
 * saying why.
 *
 * So nothing here reads the table back to itself. Bounds, enums and required
 * flags are pushed through `parseScenarioRequest` -- the function the route
 * calls. Target requirements are pushed through `generateDryRunPlan` -- the
 * function that resolves a target and refuses the wrong role or capability. A
 * declaration that disagrees with either fails here, before it reaches a form.
 */
type Fields = ScenarioField[];
const ENTRIES = Object.entries(SCENARIO_FIELDS) as Array<[SimulationScenarioId, Fields]>;

/** The value a field is probed with when the test is about its existence. */
function sample(field: ScenarioField): unknown {
  switch (field.kind) {
    case 'enum':
      return field.values?.[0];
    case 'integer':
    case 'number':
      return field.min;
    case 'target':
      return 'lab-mn-1';
    case 'target-ids':
      return ['lab-mn-1'];
  }
}

/**
 * Keep the schema's CROSS-field rules satisfied while one field is probed.
 *
 * Without this a per-field bound cannot be isolated: setting `latencyMs` to its
 * minimum of 0 while the template's jitter is 20 breaks "jitter may not exceed
 * latency", and the probe would report the bound wrong when the bound is right.
 *
 * It only ever moves the OTHER fields. The probed one is left exactly as the
 * test set it, so a bound that is genuinely wrong still fails.
 */
function consistent(
  scenarioId: SimulationScenarioId,
  probed: string,
  parameters: Record<string, unknown>
): Record<string, unknown> {
  const p = { ...parameters };
  if (scenarioId === 'network-degradation') {
    const lat = Number(p['latencyMs'] ?? 0);
    const jit = Number(p['jitterMs'] ?? 0);
    if (jit > lat) {
      if (probed === 'jitterMs') p['latencyMs'] = jit;
      else p['jitterMs'] = lat;
    }
    if (Number(p['latencyMs']) === 0 && Number(p['jitterMs']) === 0 && Number(p['lossPercent']) === 0) {
      if (probed === 'lossPercent') p['latencyMs'] = 100;
      else p['lossPercent'] = 1;
    }
  }
  if (scenarioId === 'restart-flapping') {
    const total = (): number =>
      Number(p['cycles']) * (Number(p['downSeconds']) + Number(p['upSeconds']));
    for (const other of ['cycles', 'upSeconds', 'downSeconds'] as const) {
      if (total() <= 900) break;
      if (other !== probed) p[other] = other === 'cycles' ? 1 : 5;
    }
  }
  // An explicit target list must be exactly as long as the count.
  if (probed === 'targetIds' && Array.isArray(p['targetIds']) && 'count' in p) {
    p['count'] = (p['targetIds'] as unknown[]).length;
  }
  return p;
}

/** One field set to one value, with its conditional neighbours made consistent. */
function probe(scenarioId: SimulationScenarioId, fields: Fields, name: string, value: unknown): Record<string, unknown> {
  const overrides: Record<string, unknown> = { [name]: value };

  // Probing a conditional field needs its condition to hold.
  const self = fields.find((f) => f.name === name);
  if (self?.onlyWhen !== undefined) overrides[self.onlyWhen.field] = self.onlyWhen.values[0];

  // And the other direction, which the first version of this helper missed:
  // setting a field that others depend on must settle those others too.
  for (const other of fields) {
    if (other.onlyWhen?.field !== name) continue;
    overrides[other.name] = other.onlyWhen.values.includes(value as string) ? other.min : undefined;
  }

  const parameters = consistent(scenarioId, name, {
    ...SCENARIO_PARAMETER_TEMPLATES[scenarioId],
    ...overrides,
  });
  for (const [key, v] of Object.entries(parameters)) if (v === undefined) delete parameters[key];
  return parameters;
}

const accepts = (scenarioId: SimulationScenarioId, parameters: Record<string, unknown>): boolean => {
  try {
    parseScenarioRequest({ scenarioId, scenarioVersion: 1, seed: 'fixture-seed', parameters });
    return true;
  } catch {
    return false;
  }
};

describe('scenario form fields agree with the validator', () => {
  it('describes every scenario, so no scenario is left as a bare JSON blob', () => {
    expect(Object.keys(SCENARIO_FIELDS).sort()).toEqual([...SIMULATION_SCENARIO_IDS].sort());
  });

  it('describes only fields the schema really has', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        // `.strict()` refuses an unknown key outright, so a renamed or invented
        // parameter fails here.
        expect(
          accepts(scenarioId, probe(scenarioId, fields, field.name, sample(field))),
          `${scenarioId}.${field.name} is not a parameter this schema accepts`
        ).toBe(true);
      }
    }
  });

  it('states the numeric bounds the schema actually enforces', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.kind !== 'integer' && field.kind !== 'number') continue;
        const where = `${scenarioId}.${field.name}`;
        expect(field.min, `${where} has no min`).toBeTypeOf('number');
        expect(field.max, `${where} has no max`).toBeTypeOf('number');
        const at = (v: number): boolean => accepts(scenarioId, probe(scenarioId, fields, field.name, v));

        expect(at(field.min!), `${where}: min rejected`).toBe(true);
        expect(at(field.max!), `${where}: max rejected`).toBe(true);
        expect(at(field.min! - 1), `${where}: below min accepted`).toBe(false);
        expect(at(field.max! + 1), `${where}: above max accepted`).toBe(false);

        const between = field.min! + 0.5;
        if (field.kind === 'integer') {
          // Integer, not "a number": 1.5 nodes is not a quantity.
          expect(at(between), `${where}: a fraction was accepted`).toBe(false);
        } else {
          // And the other way: a percentage IS fractional, and a form that
          // stepped it in whole numbers would refuse a value the server takes.
          expect(at(between), `${where}: a fraction was refused`).toBe(true);
        }
      }
    }
  });

  it('lists exactly the enum values the schema admits', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.kind !== 'enum') continue;
        for (const value of field.values ?? []) {
          expect(
            accepts(scenarioId, probe(scenarioId, fields, field.name, value)),
            `${scenarioId}.${field.name}: '${value}' is listed but refused`
          ).toBe(true);
        }
        expect(
          accepts(scenarioId, probe(scenarioId, fields, field.name, 'not-a-real-value')),
          `${scenarioId}.${field.name}: an unknown value was accepted`
        ).toBe(false);
      }
    }
  });

  it('marks a field optional only when the schema lets it be absent', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.onlyWhen !== undefined) continue;
        const absent = accepts(scenarioId, probe(scenarioId, fields, field.name, undefined));
        expect(absent, `${scenarioId}.${field.name}: required=${field.required} disagrees with the schema`).toBe(
          !field.required
        );
      }
    }
  });

  it('shows the delay field exactly when the delay kinds need it', () => {
    const fields = SCENARIO_FIELDS['dsl-fault']!;
    const param = fields.find((f) => f.name === 'param')!;
    expect(param.onlyWhen).toEqual({ field: 'faultKind', values: ['response-delay', 'report-delay'] });

    for (const faultKind of param.onlyWhen!.values) {
      expect(accepts('dsl-fault', probe('dsl-fault', fields, 'faultKind', faultKind)), `${faultKind} with param`).toBe(true);
      expect(accepts('dsl-fault', { faultKind, count: 1, epochs: 1 }), `${faultKind} without param`).toBe(false);
      expect(accepts('dsl-fault', { faultKind, count: 1, epochs: 1, param: 0 }), `${faultKind} zero delay`).toBe(false);
    }
    for (const faultKind of ['response-drop', 'report-drop', 'commitment-skip']) {
      expect(accepts('dsl-fault', { faultKind, count: 1, epochs: 1 }), `${faultKind} without param`).toBe(true);
      expect(accepts('dsl-fault', { faultKind, count: 1, epochs: 1, param: 1 }), `${faultKind} with a param`).toBe(false);
    }
  });

  /**
   * A ceiling that depends on another field, proven both ways. restart-flapping
   * takes up to ten masternodes but only five stakers, because stakers are the
   * block producers -- a form showing the plain maximum would accept eight
   * stakers and let the server refuse them afterwards.
   */
  it('lowers a ceiling exactly when the other field says so', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.maxWhen === undefined) continue;
        const { field: dep, values, max } = field.maxWhen;
        const where = `${scenarioId}.${field.name} when ${dep}=${values[0]}`;
        const withDep = (v: number, depValue: string): boolean =>
          accepts(scenarioId, { ...probe(scenarioId, fields, field.name, v), [dep]: depValue });

        expect(withDep(max, values[0]!), `${where}: its lowered max is refused`).toBe(true);
        expect(withDep(max + 1, values[0]!), `${where}: one past the lowered max is accepted`).toBe(false);

        // And the plain max still holds for a value that does not lower it.
        const other = (fields.find((f) => f.name === dep)?.values ?? []).find((v) => !values.includes(v));
        expect(other, `${where}: no value of ${dep} that leaves the plain max`).toBeDefined();
        expect(withDep(field.max!, other!), `${scenarioId}.${field.name} when ${dep}=${other}`).toBe(true);
      }
    }
  });
});

/* ── target requirements, against the executor that enforces them ─────────── */

const CAPABILITIES: SimulationTargetCapability[] = ['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook'];

function snapshot(
  targetId: string,
  role: SimulationTargetSnapshot['role'],
  capabilities: SimulationTargetCapability[],
  hostRef = `host-${targetId}`
): SimulationTargetSnapshot {
  return {
    targetId,
    displayLabel: targetId,
    operatorId: role === 'masternode' ? `operator-${targetId}` : null,
    proTxHash: role === 'masternode' ? targetId.padEnd(64, '0') : null,
    hostRef,
    unitRef: `unit-${targetId}`,
    p2pPort: 19_799,
    role,
    network: 'devnet',
    capabilities: [...capabilities],
    expectedBuild: 'test-build',
    capturedAtMs: 1_000,
    capturedAtHeight: 6_240,
  };
}

/**
 * Does the executor resolve a plan when this one target is named explicitly?
 *
 * A generous context -- many masternodes and stakers with every capability,
 * all of them quorum members -- so that the only thing that can make the plan
 * fail is the candidate itself.
 */
function executorAccepts(
  scenarioId: SimulationScenarioId,
  fields: Fields,
  candidate: SimulationTargetSnapshot,
  roleValue?: string
): boolean {
  const filler = [
    ...Array.from({ length: 12 }, (_, i) => snapshot(`mn-fill-${i}`, 'masternode', CAPABILITIES)),
    ...Array.from({ length: 6 }, (_, i) => snapshot(`st-fill-${i}`, 'staker', CAPABILITIES)),
  ];
  const targets = [candidate, ...filler];
  const field = fields.find((f) => f.kind === 'target-ids' || f.kind === 'target')!;
  const value = field.kind === 'target' ? candidate.targetId : [candidate.targetId];
  const base = probe(scenarioId, fields, field.name, value);
  if (field.target?.roleFrom !== undefined && roleValue !== undefined) base[field.target.roleFrom] = roleValue;

  try {
    generateDryRunPlan(
      {
        runKey: simulationRunKeyFor(`fields-${scenarioId}`),
        network: 'devnet',
        scenario: { scenarioId, scenarioVersion: 1, seed: 'fixture-seed', parameters: base },
      },
      {
        network: 'devnet',
        currentHeight: 6_240,
        targets,
        quorumMemberTargetIds: targets.filter((t) => t.role === 'masternode').map((t) => t.targetId),
        quorumThresholds: { dkg: 44, chainLock: 41 },
      }
    );
    return true;
  } catch {
    return false;
  }
}

describe('target requirements agree with the executor', () => {
  it('names a role and a capability the executor really requires', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      const field = fields.find((f) => f.kind === 'target-ids' || f.kind === 'target');
      if (field?.target === undefined) continue;
      const { role, roleFrom, capability } = field.target;
      if (role === undefined && roleFrom === undefined && capability === undefined) continue;

      const roles: Array<SimulationTargetSnapshot['role']> =
        role !== undefined
          ? [role]
          : ((fields.find((f) => f.name === roleFrom)?.values ?? []) as Array<SimulationTargetSnapshot['role']>);

      for (const r of roles) {
        const where = `${scenarioId} (${roleFrom ?? 'role'}=${r})`;
        const others = CAPABILITIES.filter((c) => c !== capability);

        // A target that meets the requirement is resolved.
        expect(
          executorAccepts(scenarioId, fields, snapshot('fits', r, CAPABILITIES), roleFrom ? r : undefined),
          `${where}: a target meeting the requirement was refused`
        ).toBe(true);

        // The wrong role is refused -- including the seed, for every one.
        for (const wrong of (['masternode', 'staker', 'seed'] as const).filter((x) => x !== r)) {
          expect(
            executorAccepts(scenarioId, fields, snapshot('wrong-role', wrong, CAPABILITIES), roleFrom ? r : undefined),
            `${where}: a ${wrong} was accepted`
          ).toBe(false);
        }

        // And the missing capability is refused.
        if (capability !== undefined) {
          expect(
            executorAccepts(scenarioId, fields, snapshot('no-cap', r, others), roleFrom ? r : undefined),
            `${where}: a target without ${capability} was accepted`
          ).toBe(false);
        }
      }
    }
  });
});

/**
 * The one scenario the panel must not offer live, proven on the live plan.
 *
 * `clear-recover` plans only `fault-clear` actions, and the live executor skips
 * every one of them: clearing is recovery's job. So a live run of it would
 * start, apply nothing, and call itself run. The flag on the catalogue says
 * that; this measures it, and measures the other direction too, because a flag
 * that were `false` everywhere would hide the live mode from every scenario.
 */
describe('whether a scenario does anything live', () => {
  const lab = (id: string, role: SimulationTargetSnapshot['role']): SimulationTargetSnapshot => ({
    ...snapshot(id, role, CAPABILITIES),
    network: 'regtest',
  });
  const targets = [lab('lab-mn-1', 'masternode'), lab('lab-mn-2', 'masternode'), lab('lab-st-1', 'staker')];

  function liveFaults(scenarioId: SimulationScenarioId, parameters: Record<string, unknown>): number {
    const plan = generateDryRunPlan(
      {
        runKey: simulationRunKeyFor(`live-${scenarioId}`),
        network: 'regtest',
        scenario: { scenarioId, scenarioVersion: 1, seed: 'fixture-seed', parameters },
      },
      {
        network: 'regtest',
        currentHeight: 6_240,
        targets,
        quorumMemberTargetIds: ['lab-mn-1', 'lab-mn-2'],
        quorumThresholds: { dkg: 2, chainLock: 2 },
      }
    );
    const nowMs = 1_000_000;
    return labFaultsForPlan({
      plan,
      targetsById: new Map(targets.map((t) => [t.targetId, t])),
      runTag: 'fields-test',
      expiresAtMs: nowMs + 60_000,
      nowMs,
      strict: false,
    }).faults.length;
  }

  it('says clear-recover applies nothing live, and it does not', () => {
    const entry = scenarioDescriptors().find((d) => d.scenarioId === 'clear-recover');
    expect(entry?.liveAppliesFaults).toBe(false);
    expect(liveFaults('clear-recover', { targetIds: ['lab-mn-1'] })).toBe(0);
  });

  it('says a fault scenario does apply something live, and it does', () => {
    const entry = scenarioDescriptors().find((d) => d.scenarioId === 'mn-stop');
    expect(entry?.liveAppliesFaults).toBe(true);
    // The control for the one above: the same machinery, a real fault.
    expect(liveFaults('mn-stop', { count: 1, durationSeconds: 60, targetIds: ['lab-mn-1'] })).toBeGreaterThan(0);
  });

  it('marks only clear-recover as doing nothing live', () => {
    const inert = scenarioDescriptors().filter((d) => !d.liveAppliesFaults).map((d) => d.scenarioId);
    expect(inert).toEqual(['clear-recover']);
  });
});
