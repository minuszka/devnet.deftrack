import { readFile } from 'node:fs/promises';

type FetchLike = typeof fetch;

export interface SimulatorCliDependencies {
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  write?: (line: string) => void;
  readTextFile?: (path: string) => Promise<string>;
}

interface CliOptions {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseOptions(args: string[]): CliOptions {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(name) || flags.has(name)) {
      throw new Error(`invalid or duplicate option: ${value}`);
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function stringFlag(options: CliOptions, name: string, required = false): string | undefined {
  const value = options.flags.get(name);
  if (value === true) throw new Error(`--${name} requires a value`);
  if (required && value === undefined) throw new Error(`--${name} is required`);
  return value;
}

async function scenarioFrom(options: CliOptions, readTextFile: (path: string) => Promise<string>) {
  const inline = stringFlag(options, 'scenario-json');
  const file = stringFlag(options, 'scenario-file');
  if ((inline === undefined) === (file === undefined)) {
    throw new Error('exactly one of --scenario-json or --scenario-file is required');
  }
  return JSON.parse(inline ?? await readTextFile(file!)) as unknown;
}

function runKeyFrom(data: unknown): string {
  const key = (data as { run?: { runKey?: unknown } })?.run?.runKey;
  if (typeof key !== 'string') throw new Error('server response did not contain a run key');
  return key;
}

export async function runSimulatorCli(
  argv: string[],
  dependencies: SimulatorCliDependencies = {}
): Promise<unknown> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const write = dependencies.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const readTextFile = dependencies.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
  const apiKey = env.ADMIN_API_KEY ?? '';
  if (apiKey.length === 0) throw new Error('ADMIN_API_KEY is required');
  const baseUrl = (env.SIMULATION_API_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
  const [command, ...rest] = argv;
  if (command === undefined) throw new Error('simulator command is required');
  const options = parseOptions(rest);

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<unknown> => {
    const headers: Record<string, string> = {
      'x-admin-api-key': apiKey,
      'x-simulation-client': 'deftrack-cli-v1',
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['x-idempotency-key'] = idempotencyKey;
    const response = await fetchImpl(`${baseUrl}/api/v1/admin/simulations${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as { success?: boolean; data?: unknown; error?: string };
    if (!response.ok || envelope.success !== true) {
      throw new Error(envelope.error ?? `simulator API returned HTTP ${response.status}`);
    }
    return envelope.data;
  };

  let result: unknown;
  if (command === 'scenarios') {
    result = await request('GET', '/scenarios');
  } else if (command === 'create') {
    const scenario = await scenarioFrom(options, readTextFile);
    result = await request('POST', '/runs', {
      network: stringFlag(options, 'network') ?? 'devnet',
      mode: options.flags.has('live') ? 'live' : 'dry-run',
      scenario,
    }, stringFlag(options, 'idempotency-key', true));
  } else if (command === 'dry-lifecycle') {
    const scenario = await scenarioFrom(options, readTextFile);
    const risk = stringFlag(options, 'risk', true)!;
    const prefix = stringFlag(options, 'idempotency-prefix', true)!;
    const created = await request('POST', '/runs', {
      network: stringFlag(options, 'network') ?? 'devnet',
      mode: 'dry-run',
      scenario,
    }, `${prefix}-create`);
    const key = runKeyFrom(created);
    await request('POST', `/runs/${key}/validate`, {}, `${prefix}-validate`);
    await request('GET', `/runs/${key}/dry-run`);
    await request('POST', `/runs/${key}/arm`, { acknowledgedRiskClass: risk }, `${prefix}-arm`);
    await request('POST', `/runs/${key}/start`, {}, `${prefix}-start`);
    result = await request('GET', `/runs/${key}`);
  } else {
    const key = options.positional[0];
    if (key === undefined || !/^sim_[0-9a-f]{32}$/.test(key)) {
      throw new Error(`${command} requires a simulation run key`);
    }
    if (command === 'dry-run' || command === 'status' || command === 'history') {
      const suffix = command === 'dry-run' ? '/dry-run' : command === 'history' ? '/history' : '';
      result = await request('GET', `/runs/${key}${suffix}`);
    } else if (command === 'validate' || command === 'start' || command === 'abort' || command === 'recover') {
      result = await request(
        'POST',
        `/runs/${key}/${command}`,
        {},
        stringFlag(options, 'idempotency-key', true)
      );
    } else if (command === 'arm') {
      result = await request('POST', `/runs/${key}/arm`, {
        acknowledgedRiskClass: stringFlag(options, 'risk', true),
      }, stringFlag(options, 'idempotency-key', true));
    } else {
      throw new Error(`unknown simulator command: ${command}`);
    }
  }
  write(JSON.stringify(result, null, 2));
  return result;
}
