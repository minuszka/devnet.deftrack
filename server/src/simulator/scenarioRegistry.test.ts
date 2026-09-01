import { describe, expect, it } from 'vitest';
import {
  SCENARIO_LIMITS,
  parseScenarioRequest,
  scenarioDescriptors,
  scenarioRequestFromPreset,
} from './scenarioRegistry.js';

describe('simulation scenario registry', () => {
  it('exposes the closed set of eight scenarios', () => {
    expect(scenarioDescriptors().map((item) => item.scenarioId)).toEqual([
      'mn-stop',
      'host-outage',
      'quorum-member-outage',
      'staker-stop',
      'restart-flapping',
      'network-degradation',
      'node-isolation',
      'clear-recover',
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
