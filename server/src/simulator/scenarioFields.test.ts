import { describe, expect, it } from 'vitest';
import {
  SCENARIO_FIELDS,
  SCENARIO_PARAMETER_TEMPLATES,
  parseScenarioRequest,
} from './scenarioRegistry.js';
import type { SimulationScenarioId } from './scenarioTypes.js';

/**
 * The form metadata, held against the validator that actually decides.
 *
 * A table of field bounds maintained beside a schema drifts from it. This
 * project has already watched that happen once, in the panel's own copy of the
 * parameter defaults: it had no entry for `dsl-fault` at all and offered `{}`,
 * three required fields short, refused by the server with nothing on screen
 * saying why.
 *
 * So nothing here reads the table back to itself. Every assertion builds a real
 * request and puts it through `parseScenarioRequest` -- the same function the
 * route calls. A `min` the schema rejects, a `max` it accepts one past, an enum
 * value it does not know, a field it has never heard of: each fails here, on
 * the declaration, before it can reach a form.
 */
const ENTRIES = Object.entries(SCENARIO_FIELDS) as Array<
  [SimulationScenarioId, NonNullable<(typeof SCENARIO_FIELDS)[SimulationScenarioId]>]
>;

/** A request that satisfies the scenario, with one parameter overridden. */
function requestWith(
  scenarioId: SimulationScenarioId,
  overrides: Record<string, unknown>
): unknown {
  const parameters = { ...SCENARIO_PARAMETER_TEMPLATES[scenarioId], ...overrides };
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined) delete parameters[key];
  }
  return { scenarioId, scenarioVersion: 1, seed: 'fixture-seed', parameters };
}

const accepts = (scenarioId: SimulationScenarioId, overrides: Record<string, unknown>): boolean => {
  try {
    parseScenarioRequest(requestWith(scenarioId, overrides));
    return true;
  } catch {
    return false;
  }
};

type Fields = NonNullable<(typeof SCENARIO_FIELDS)[SimulationScenarioId]>;

/**
 * One field set to one value, with its conditional neighbours made consistent
 * -- in BOTH directions, which the first version of this helper got half right
 * and the suite caught immediately.
 *
 * Probing `param` needs a `faultKind` that admits it. Probing `faultKind` with
 * a delay kind needs a `param`, because those kinds require one; probing it
 * with a drop kind needs `param` ABSENT, because those refuse it. A helper that
 * only looked downwards reported the table as wrong when the table was right.
 */
function probe(fields: Fields, name: string, value: unknown): Record<string, unknown> {
  const overrides: Record<string, unknown> = { [name]: value };

  const self = fields.find((f) => f.name === name);
  if (self?.onlyWhen !== undefined) overrides[self.onlyWhen.field] = self.onlyWhen.values[0];

  for (const other of fields) {
    if (other.onlyWhen?.field !== name) continue;
    overrides[other.name] = other.onlyWhen.values.includes(value as string) ? other.min : undefined;
  }
  return overrides;
}

describe('scenario form fields agree with the validator', () => {
  it('describes a scenario that exists, and only fields it really has', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      expect(SCENARIO_PARAMETER_TEMPLATES[scenarioId], scenarioId).toBeDefined();
      for (const field of fields) {
        // A field the schema does not know is refused outright by `.strict()`,
        // so this catches a renamed or invented parameter.
        const value = field.kind === 'enum' ? field.values?.[0] : field.kind === 'integer' ? field.min : ['lab-mn-1'];
        expect(
          accepts(scenarioId, probe(fields, field.name, value)),
          `${scenarioId}.${field.name} is not a parameter this schema accepts`
        ).toBe(true);
      }
    }
  });

  it('states the integer bounds the schema actually enforces', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.kind !== 'integer') continue;
        expect(field.min, `${scenarioId}.${field.name} has no min`).toBeTypeOf('number');
        expect(field.max, `${scenarioId}.${field.name} has no max`).toBeTypeOf('number');
        const where = `${scenarioId}.${field.name}`;

        expect(accepts(scenarioId, probe(fields, field.name, field.min)), `${where}: min rejected`).toBe(true);
        expect(accepts(scenarioId, probe(fields, field.name, field.max)), `${where}: max rejected`).toBe(true);
        expect(
          accepts(scenarioId, probe(fields, field.name, field.min! - 1)),
          `${where}: below min accepted`
        ).toBe(false);
        expect(
          accepts(scenarioId, probe(fields, field.name, field.max! + 1)),
          `${where}: above max accepted`
        ).toBe(false);
        // Integer, not "a number": 1.5 nodes is not a quantity.
        expect(
          accepts(scenarioId, probe(fields, field.name, field.min! + 0.5)),
          `${where}: a fraction was accepted`
        ).toBe(false);
      }
    }
  });

  it('lists exactly the enum values the schema admits', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.kind !== 'enum') continue;
        expect(field.values, `${scenarioId}.${field.name} has no values`).toBeDefined();
        for (const value of field.values!) {
          expect(
            accepts(scenarioId, probe(fields, field.name, value)),
            `${scenarioId}.${field.name}: '${value}' is listed but refused`
          ).toBe(true);
        }
        expect(
          accepts(scenarioId, probe(fields, field.name, 'not-a-real-value')),
          `${scenarioId}.${field.name}: an unknown value was accepted`
        ).toBe(false);
      }
    }
  });

  it('marks a field optional only when the schema lets it be absent', () => {
    for (const [scenarioId, fields] of ENTRIES) {
      for (const field of fields) {
        if (field.onlyWhen !== undefined) continue;
        const absent = accepts(scenarioId, { [field.name]: undefined });
        expect(absent, `${scenarioId}.${field.name}: required=${field.required} disagrees with the schema`).toBe(
          !field.required
        );
      }
    }
  });

  /**
   * The conditional field, both ways round. This is the rule a form gets wrong
   * by showing the input all the time: the delay kinds require `param` and the
   * others refuse it outright, so an always-visible field produces a request
   * the server rejects for a reason the reader cannot see.
   */
  it('shows the delay field exactly when the delay kinds need it', () => {
    const fields = SCENARIO_FIELDS['dsl-fault']!;
    const param = fields.find((f) => f.name === 'param')!;
    expect(param.onlyWhen).toEqual({ field: 'faultKind', values: ['response-delay', 'report-delay'] });

    for (const faultKind of param.onlyWhen!.values) {
      expect(accepts('dsl-fault', { faultKind, param: 1 }), `${faultKind} with param`).toBe(true);
      expect(accepts('dsl-fault', { faultKind }), `${faultKind} without param`).toBe(false);
      expect(accepts('dsl-fault', { faultKind, param: 0 }), `${faultKind} with a zero delay`).toBe(false);
    }
    for (const faultKind of ['response-drop', 'report-drop', 'commitment-skip']) {
      expect(accepts('dsl-fault', { faultKind }), `${faultKind} without param`).toBe(true);
      expect(accepts('dsl-fault', { faultKind, param: 1 }), `${faultKind} with a param`).toBe(false);
    }
  });

  /**
   * The four the day names, and no more. A fifth scenario acquiring a form
   * without the target chooser day 16 builds would produce a request whose
   * target cannot be resolved -- so the absence is the contract, not an
   * oversight, and it is checked.
   */
  it('covers the four scenarios that need no target chooser', () => {
    expect(Object.keys(SCENARIO_FIELDS).sort()).toEqual(
      ['dsl-fault', 'mn-stop', 'quorum-member-outage', 'staker-stop'].sort()
    );
  });
});
