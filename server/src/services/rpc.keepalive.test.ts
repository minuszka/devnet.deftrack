import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A pooled connection the node has already given up on.
 *
 * The node's HTTP server drops a keep-alive connection after it has been idle
 * for `-rpcservertimeout` seconds (30 by default, src/httpserver.h:13). The
 * explorer's health endpoint asks for `getnetworkinfo` every 30 seconds, on a
 * pooled socket that nothing else touches in between -- so that socket reaches
 * the node's limit at the moment it is reused, and the request crosses the
 * node's close: "socket hang up". Measured on the VPS on 2026-09-14, seven times
 * in eleven minutes, every one on a :01 or :31 second.
 *
 * The node here is a raw TCP server that answers JSON-RPC over keep-alive and
 * treats a request on a connection idle for its limit the way the race ends:
 * it drops the connection without an answer. That makes the race deterministic
 * instead of a matter of luck with timers.
 */
const state = vi.hoisted(() => ({
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config.js', () => ({
  config: { rpc: { host: '127.0.0.1', port: 1, user: 'u', pass: 'p', timeoutMs: 2_000 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./metrics.service.js', () => ({ metricsService: { observeRpc: () => undefined } }));

import { RpcService } from './rpc.service.js';

const NODE_IDLE_LIMIT_MS = 300;

interface FakeNode {
  port: number;
  connections: number;
  staleReuses: number;
  /** How long the node takes to answer, for the slow-call case. */
  answerDelayMs: number;
  close: () => Promise<void>;
}

async function startFakeNode(): Promise<FakeNode> {
  const sockets = new Set<net.Socket>();
  const node: FakeNode = { port: 0, connections: 0, staleReuses: 0, answerDelayMs: 0, close: async () => undefined };
  const server = net.createServer((socket) => {
    node.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let lastAnsweredAt: number | null = null;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('latin1');
        const length = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? 0);
        if (buffer.length < end + 4 + length) return;
        const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
        buffer = buffer.subarray(end + 4 + length);
        if (lastAnsweredAt !== null && Date.now() - lastAnsweredAt >= NODE_IDLE_LIMIT_MS) {
          // The connection outlived the node's idle limit: the node has closed
          // it, and this request is the one that crossed the close.
          node.staleReuses += 1;
          socket.destroy();
          return;
        }
        const id = (JSON.parse(body) as { id: number }).id;
        const payload = JSON.stringify({ result: 'ok', error: null, id });
        const answer = () => {
          if (socket.destroyed) return;
          socket.write(
            `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: keep-alive\r\n\r\n${payload}`
          );
          lastAnsweredAt = Date.now();
        };
        if (node.answerDelayMs > 0) setTimeout(answer, node.answerDelayMs);
        else answer();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  node.port = (server.address() as net.AddressInfo).port;
  node.close = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return node;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let node: FakeNode;
beforeEach(async () => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  node = await startFakeNode();
});
afterEach(async () => {
  await node.close();
});

function client(idleSocketMs: number): RpcService {
  return new RpcService({ host: '127.0.0.1', port: node.port, user: 'u', pass: 'p', timeoutMs: 2_000, idleSocketMs });
}

describe('pooled connections and the node idle limit', () => {
  it('never reuses a connection the node has already dropped for being idle', async () => {
    const rpc = client(NODE_IDLE_LIMIT_MS / 3);
    await expect(rpc.call('uptime')).resolves.toBe('ok');
    // Past the node's limit, the way the health poll's socket sits for 30 s.
    await sleep(NODE_IDLE_LIMIT_MS + 150);
    await expect(rpc.call('uptime')).resolves.toBe('ok');

    expect(node.staleReuses, 'a request was sent on a connection the node had dropped').toBe(0);
    expect(state.logs.error).not.toHaveBeenCalled();
    expect(state.logs.warn).not.toHaveBeenCalled();
  });

  it('still reuses a connection that is in use, rather than dialling for every call', async () => {
    // The pool exists so that indexing a block, one RPC per transaction, does
    // not open a socket per call. Closing idle sockets early must not undo that.
    const rpc = client(NODE_IDLE_LIMIT_MS / 3);
    for (let i = 0; i < 5; i += 1) {
      await expect(rpc.call('uptime')).resolves.toBe('ok');
      await sleep(10);
    }
    expect(node.connections).toBe(1);
  });

  it('lets a call run longer than the idle limit, since a call in progress is not idle', async () => {
    // The idle limit is for sockets waiting in the pool. A slow answer --
    // `getblock` on a busy node -- is bounded by the request timeout alone.
    const rpc = client(100);
    node.answerDelayMs = 450;
    await expect(rpc.call('uptime')).resolves.toBe('ok');
    expect(state.logs.error).not.toHaveBeenCalled();
    expect(state.logs.warn).not.toHaveBeenCalled();
  });
});
