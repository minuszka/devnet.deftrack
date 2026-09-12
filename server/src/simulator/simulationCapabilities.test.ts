import { describe, expect, it } from 'vitest';
import { LIVE_NETWORKS, simulationCapabilitiesFrom } from './simulationCapabilities.js';

/**
 * The panel offered `live` beside `devnet`, and the server refused that pair at
 * creation. The refusal was right; offering it was the defect. These two facts
 * now come from one place, so the option the panel shows and the option the
 * server accepts cannot drift.
 */
describe('simulation capabilities', () => {
  it('names only the network a live run may use', () => {
    expect(simulationCapabilitiesFrom(true)).toEqual({
      liveExecutorConfigured: true,
      liveNetworks: ['regtest'],
    });
    expect(LIVE_NETWORKS).not.toContain('devnet');
  });

  it('offers no live network at all when no executor is configured', () => {
    expect(simulationCapabilitiesFrom(false)).toEqual({
      liveExecutorConfigured: false,
      liveNetworks: [],
    });
  });

  it('hands out a fresh list, so a caller cannot shorten the constant', () => {
    const capabilities = simulationCapabilitiesFrom(true);
    capabilities.liveNetworks.pop();
    expect(simulationCapabilitiesFrom(true).liveNetworks).toEqual(['regtest']);
  });
});
