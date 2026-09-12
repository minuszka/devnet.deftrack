import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_TARGET_ID,
  SCENARIO_LIMITS,
  SCENARIO_PARAMETER_TEMPLATES,
  parseScenarioRequest,
  scenarioDescriptors,
  scenarioRequestFromPreset,
} from './scenarioRegistry.js';
import { SIMULATION_SCENARIO_IDS } from './scenarioTypes.js';

describe('simulation scenario registry', () => {
  it('exposes the closed set of nine scenarios', () => {
    expect(scenarioDescriptors().map((item) => item.scenarioId)).toEqual([
      'mn-stop',
      'host-outage',
      'quorum-member-outage',
      'staker-stop',
      'restart-flapping',
      'network-degradation',
      'node-isolation',
      'clear-recover',
      'dsl-fault',
    ]);
  });

  it('rejects unknown scenarios and unknown fields at every request level', () => {
    expect(() =>
      parseScenarioRequest({ scenarioId: 'shell', scenarioVersion: 1, seed: 'x', parameters: {} })
    ).toThrow();
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'mn-stop',
        scenarioVersion: 1,
        seed: 'x',
        parameters: { count: 1, durationSeconds: 30 },
        command: 'shutdown',
      })
    ).toThrow();
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'mn-stop',
        scenarioVersion: 1,
        seed: 'x',
        parameters: { count: 1, durationSeconds: 30, script: 'anything' },
      })
    ).toThrow();
  });

  it('enforces target, duration and network impairment limits', () => {
    const base = {
      scenarioId: 'network-degradation',
      scenarioVersion: 1,
      seed: 'limits',
      parameters: {
        role: 'masternode',
        count: 1,
        durationSeconds: 30,
        latencyMs: 100,
        jitterMs: 20,
        lossPercent: 1,
        correlationPercent: 0,
      },
    };
    expect(parseScenarioRequest(base).scenarioId).toBe('network-degradation');
    expect(() =>
      parseScenarioRequest({
        ...base,
        parameters: { ...base.parameters, lossPercent: SCENARIO_LIMITS.maxPacketLossPercent + 0.01 },
      })
    ).toThrow();
    expect(() =>
      parseScenarioRequest({
        ...base,
        parameters: { ...base.parameters, latencyMs: SCENARIO_LIMITS.maxLatencyMs + 1 },
      })
    ).toThrow();
    expect(() =>
      parseScenarioRequest({
        ...base,
        parameters: { ...base.parameters, latencyMs: 0, jitterMs: 0, lossPercent: 0 },
      })
    ).toThrow(/must configure/);
    expect(() =>
      parseScenarioRequest({
        ...base,
        parameters: { ...base.parameters, latencyMs: 10, jitterMs: 11 },
      })
    ).toThrow(/jitterMs/);
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'x',
        parameters: { count: SCENARIO_LIMITS.maxTargets + 1, durationSeconds: 30 },
      })
    ).toThrow();
  });

  it('requires exact, unique explicit selections', () => {
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'x',
        parameters: { count: 2, durationSeconds: 30, targetIds: ['mn-1'] },
      })
    ).toThrow(/length must equal count/);
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'x',
        parameters: { count: 2, durationSeconds: 30, targetIds: ['mn-1', 'mn-1'] },
      })
    ).toThrow(/unique/);
  });

  it.each([
    ['dkg-minus-16', 'quorum-member-outage', 16, 'dkg'],
    ['dkg-minus-17', 'quorum-member-outage', 17, 'dkg'],
    ['chainlock-minus-19', 'quorum-member-outage', 19, 'chainlock'],
    ['chainlock-minus-20', 'quorum-member-outage', 20, 'chainlock'],
  ] as const)('creates the %s threshold preset', (presetId, scenarioId, count, phase) => {
    const request = scenarioRequestFromPreset(presetId, 'preset-seed');
    expect(request.scenarioId).toBe(scenarioId);
    expect(request.parameters).toMatchObject({ count, phase });
  });

  it('creates staker presets and requires a host anchor override', () => {
    expect(scenarioRequestFromPreset('one-staker-outage', 'x').parameters).toMatchObject({ count: 1 });
    expect(scenarioRequestFromPreset('multi-staker-outage', 'x').parameters).toMatchObject({ count: 3 });
    expect(() => scenarioRequestFromPreset('host-10-masternodes', 'x')).toThrow();
    expect(
      scenarioRequestFromPreset('host-10-masternodes', 'x', { anchorTargetId: 'mn-1' }).parameters
    ).toMatchObject({ anchorTargetId: 'mn-1', expectedMasternodes: 10 });
  });
});

/**
 * The claim the panel's parameter templates rest on, and the only one they make.
 *
 * The panel used to keep its own table of defaults, maintained separately from
 * this schema, and it drifted exactly as such a table does: there was no entry
 * for `dsl-fault` at all, so choosing it put `{}` in the field -- three required
 * fields short, refused by the server, with nothing in the panel saying why.
 * Moving the table next to the validator only helps if something checks that
 * they agree, which is this.
 */
describe('scenario parameter templates', () => {
  it('has one for every scenario in the registry', () => {
    expect(Object.keys(SCENARIO_PARAMETER_TEMPLATES).sort()).toEqual([...SIMULATION_SCENARIO_IDS].sort());
  });

  it.each([...SIMULATION_SCENARIO_IDS])('%s: the template satisfies its own schema', (scenarioId) => {
    const request = parseScenarioRequest({
      scenarioId,
      scenarioVersion: 1,
      seed: 'template-check',
      parameters: SCENARIO_PARAMETER_TEMPLATES[scenarioId],
    });
    expect(request.scenarioId).toBe(scenarioId);
  });

  /*
   * Satisfying the schema and naming a registered target are different
   * questions, answered in different places. A template may do the first and
   * must never look as if it has done the second.
   */
  it('marks the templates whose target ids are placeholders', () => {
    const byId = new Map(scenarioDescriptors().map((entry) => [entry.scenarioId, entry]));
    expect(byId.get('host-outage')?.templateNeedsTargetId).toBe(true);
    expect(byId.get('clear-recover')?.templateNeedsTargetId).toBe(true);
    expect(byId.get('mn-stop')?.templateNeedsTargetId).toBe(false);
    expect(byId.get('dsl-fault')?.templateNeedsTargetId).toBe(false);
    expect(JSON.stringify(byId.get('host-outage')?.parameterTemplate)).toContain(
      PLACEHOLDER_TARGET_ID
    );
  });

  it('hands out copies, so a caller cannot edit the registry', () => {
    const first = scenarioDescriptors().find((entry) => entry.scenarioId === 'mn-stop');
    (first?.parameterTemplate as Record<string, unknown>)['count'] = 99;
    const second = scenarioDescriptors().find((entry) => entry.scenarioId === 'mn-stop');
    expect(second?.parameterTemplate).toMatchObject({ count: 1 });
  });

  /*
   * The dsl-fault template is the one the panel got wrong, so it is checked
   * against the node's own rule too: a delay kind needs its delay, and a
   * non-delay kind must not carry one.
   */
  it('keeps the dsl-fault cross-field rules reachable from the template', () => {
    const template = SCENARIO_PARAMETER_TEMPLATES['dsl-fault'];
    expect(template).toMatchObject({ faultKind: 'response-drop', count: 1, epochs: 1 });
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'dsl-fault',
        scenarioVersion: 1,
        seed: 's',
        parameters: { ...template, faultKind: 'response-delay' },
      })
    ).toThrow(/needs param/);
    expect(() =>
      parseScenarioRequest({
        scenarioId: 'dsl-fault',
        scenarioVersion: 1,
        seed: 's',
        parameters: { ...template, param: 3 },
      })
    ).toThrow(/takes no param/);
  });
});
