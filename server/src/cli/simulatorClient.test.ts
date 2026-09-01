import { describe, expect, it } from 'vitest';
import { runSimulatorCli } from './simulatorClient.js';

describe('simulator CLI', () => {
  it('runs the complete dry-run lifecycle through the private API', async () => {
    const runKey = `sim_${'a'.repeat(32)}`;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const data = path.endsWith('/runs')
        ? { run: { runKey } }
        : path.endsWith(`/runs/${runKey}`)
          ? { runKey, state: { status: 'completed' } }
          : { run: { runKey } };
      return new Response(JSON.stringify({ success: true, data }), {
        status: path.endsWith('/runs') ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const output: string[] = [];
    const result = await runSimulatorCli([
      'dry-lifecycle',
      '--scenario-json', JSON.stringify({
        scenarioId: 'mn-stop',
        scenarioVersion: 1,
        seed: 'acceptance-seed',
        parameters: { count: 1, durationSeconds: 30 },
      }),
      '--risk', 'medium',
      '--idempotency-prefix', 'acceptance-run',
    ], {
      fetchImpl,
      env: { ADMIN_API_KEY: 'test-secret', SIMULATION_API_URL: 'http://localhost:4100' },
      write: (line) => output.push(line),
    });

    expect((result as { state: { status: string } }).state.status).toBe('completed');
    expect(requests.map((item) => `${item.init?.method} ${new URL(item.url).pathname}`)).toEqual([
      'POST /api/v1/admin/simulations/runs',
      `POST /api/v1/admin/simulations/runs/${runKey}/validate`,
      `GET /api/v1/admin/simulations/runs/${runKey}/dry-run`,
      `POST /api/v1/admin/simulations/runs/${runKey}/arm`,
      `POST /api/v1/admin/simulations/runs/${runKey}/start`,
      `GET /api/v1/admin/simulations/runs/${runKey}`,
    ]);
    expect(requests.every((item) => {
      const headers = item.init?.headers as Record<string, string>;
      return headers['x-admin-api-key'] === 'test-secret' &&
        headers['x-simulation-client'] === 'deftrack-cli-v1';
    })).toBe(true);
    expect(JSON.stringify(output)).not.toContain('test-secret');
  });
});
