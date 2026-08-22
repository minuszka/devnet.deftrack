import axios, { type AxiosInstance } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Per-method cache TTL in milliseconds. Methods absent from this table are
 * never cached -- notably `getblock`, because a block is immutable and the
 * indexer reads each one exactly once.
 */
const CACHE_TTL_MS: Record<string, number> = {
  getblockcount: 3_000,
  getblockchaininfo: 5_000,
  getnetworkinfo: 5_000,
  getmempoolinfo: 3_000,
  getpeerinfo: 5_000,
  spork: 10_000,
  mnsync: 5_000,
  masternodelist: 15_000,
  'quorum:list': 15_000,
  'quorum:listextended': 15_000,
};

type CacheEntry = { value: unknown; atMs: number };

export class RpcService {
  private readonly client: AxiosInstance;
  private requestId = 0;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor() {
    this.client = axios.create({
      baseURL: `http://${config.rpc.host}:${config.rpc.port}/`,
      auth: { username: config.rpc.user, password: config.rpc.pass },
      headers: { 'Content-Type': 'application/json' },
      timeout: config.rpc.timeoutMs,
      // Keep-alive avoids fd exhaustion: indexing a block fans out one RPC per
      // transaction, and without pooling each would open a fresh TCP socket.
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 16 }),
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 16 }),
      maxRedirects: 0,
    });

    // Scrub credentials from any error before it can reach a logger that
    // serialises the axios config. Without this a stray `logger.error(err)`
    // anywhere up the stack leaks base64(user:pass).
    this.client.interceptors.response.use(undefined, (error: unknown) => {
      const cfg = (error as { config?: { headers?: Record<string, unknown>; auth?: unknown } })?.config;
      if (cfg) {
        if (cfg.headers && typeof cfg.headers === 'object') {
          if ('Authorization' in cfg.headers) cfg.headers.Authorization = '***';
          if ('authorization' in cfg.headers) cfg.headers.authorization = '***';
        }
        if (cfg.auth) cfg.auth = { username: '***', password: '***' };
      }
      return Promise.reject(error);
    });
  }

  async call<T>(method: string, params: unknown[] = [], cacheKeySuffix?: string): Promise<T> {
    const ttlKey = cacheKeySuffix ? `${method}:${cacheKeySuffix}` : method;
    const ttl = CACHE_TTL_MS[ttlKey];
    const cacheKey = ttl ? `${ttlKey}|${JSON.stringify(params)}` : null;

    if (cacheKey && ttl) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.atMs < ttl) return cached.value as T;

      const pending = this.inFlight.get(cacheKey);
      if (pending) return pending as Promise<T>;
    }

    const promise = this.doCall<T>(method, params);

    if (cacheKey) {
      this.inFlight.set(cacheKey, promise as Promise<unknown>);
      promise
        .then((value) => this.cache.set(cacheKey, { value, atMs: Date.now() }))
        // Never poison the cache on failure; let the next caller retry.
        .catch(() => undefined)
        .finally(() => this.inFlight.delete(cacheKey));
    }

    return promise;
  }

  private async doCall<T>(method: string, params: unknown[]): Promise<T> {
    const id = ++this.requestId;
    try {
      const response = await this.client.post('', { jsonrpc: '1.0', id, method, params });
      const data = response.data;

      if (data?.error) {
        const message = typeof data.error === 'object' ? data.error.message : data.error;
        throw new Error(`RPC ${method}: ${message || 'unknown RPC error'}`);
      }
      if (!data || !('result' in data)) {
        throw new Error(`RPC ${method}: response missing 'result'`);
      }
      return data.result as T;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith(`RPC ${method}:`)) throw error;

      const status = (error as { response?: { status?: number } })?.response?.status;
      const rpcError = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error;
      const raw =
        rpcError?.message ||
        (error instanceof Error ? error.message : undefined) ||
        (typeof status === 'number' ? `HTTP ${status}` : undefined) ||
        'connection failed';

      const sanitised = raw
        .replace(/\/\/[^@/]+:[^@/]+@/g, '//***:***@')
        .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic ***');

      logger.error(`RPC ${method} failed: ${sanitised}`);
      throw new Error(`RPC ${method}: ${sanitised}`);
    }
  }

  // ── chain ────────────────────────────────────────────────────────────────

  getBlockCount(): Promise<number> {
    return this.call<number>('getblockcount');
  }

  getBlockHash(height: number): Promise<string> {
    return this.call<string>('getblockhash', [height]);
  }

  /**
   * Verbosity is deliberately 1 (txids only).
   *
   * `getblock <hash> 2` aborts on this chain with
   * `Internal bug detected: "MoneyRange(fee)"` (core_write.cpp:344): it derives
   * a fee as inputs - outputs, which is negative for a coinstake because the
   * stake reward is minted, and CHECK_NONFATAL(MoneyRange(fee)) rejects it. The
   * bug hits every proof-of-stake block, mainnet included. Transactions are
   * therefore fetched one by one with getrawtransaction, which skips that path.
   */
  getBlock(hash: string): Promise<RpcBlock> {
    return this.call<RpcBlock>('getblock', [hash, 1]);
  }

  getRawTransaction(txid: string): Promise<RpcTransaction> {
    return this.call<RpcTransaction>('getrawtransaction', [txid, 1]);
  }

  getBlockchainInfo(): Promise<RpcBlockchainInfo> {
    return this.call<RpcBlockchainInfo>('getblockchaininfo');
  }
}

// ── RPC response shapes (only the fields this project consumes) ─────────────

export interface RpcBlock {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  merkleroot: string;
  time: number;
  mediantime?: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  size: number;
  previousblockhash?: string;
  nextblockhash?: string;
  /** Present only on proof-of-stake blocks. */
  blocksignature?: string;
  chainlock?: boolean;
  cbTx?: {
    version: number;
    height: number;
    merkleRootMNList?: string;
    merkleRootQuorums?: string;
  };
  tx: string[];
}

export interface RpcVin {
  coinbase?: string;
  txid?: string;
  vout?: number;
  sequence: number;
}

export interface RpcVout {
  value: number;
  valueSat: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    type: string;
    address?: string;
    addresses?: string[];
  };
}

export interface RpcTransaction {
  txid: string;
  version: number;
  type: number;
  size: number;
  locktime: number;
  vin: RpcVin[];
  vout: RpcVout[];
  blockhash?: string;
  height?: number;
  time?: number;
  blocktime?: number;
  chainlock?: boolean;
  instantlock?: boolean;
}

export interface RpcBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  initialblockdownload: boolean;
}

export const rpc = new RpcService();
