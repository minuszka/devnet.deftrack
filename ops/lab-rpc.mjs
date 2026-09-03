/**
 * Talking to the regtest lab.
 *
 * The lab image carries no `defcon-cli`, so the only way to ask a node anything
 * is HTTP RPC on its own published loopback port, authenticated with that
 * container's own cookie. Both are read per call from the container itself --
 * never assumed, never shared between nodes -- because a helper that answers for
 * the wrong node is the one failure this lab cannot detect from the outside.
 */

import { spawnSync } from 'node:child_process';

const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const DATADIR = process.env.LAB_DATADIR ?? '/var/lib/defcon';
const CHAIN = 'regtest';
const RPC_PORT = 19798;

export function docker(args, { quiet = false } = {}) {
  const result = spawnSync(DOCKER, args, { encoding: 'utf8' });
  if (result.status !== 0 && !quiet) {
    throw new Error(`docker ${args.join(' ')}: ${(result.stderr ?? '').trim()}`);
  }
  return (result.stdout ?? '').trim();
}

export function endpointOf(container) {
  const published = docker([...['port', container, String(RPC_PORT)]]).split('\n')[0] ?? '';
  const port = /:(\d+)\s*$/.exec(published.trim())?.[1];
  if (port === undefined) throw new Error(`${container} publishes no RPC port`);
  return `http://127.0.0.1:${port}/`;
}

export function cookieOf(container) {
  return docker(['exec', container, 'cat', `${DATADIR}/${CHAIN}/.cookie`]);
}

export async function rpc(container, method, params = []) {
  const response = await fetch(endpointOf(container), {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      authorization: `Basic ${Buffer.from(cookieOf(container)).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'lab', method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${container} ${method}: ${body.error.message}`);
  return body.result;
}

/** Polls until `predicate` holds, then returns. Throws with `label` on timeout. */
export async function waitUntil(label, predicate, { timeoutMs = 30_000, sleepMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}
