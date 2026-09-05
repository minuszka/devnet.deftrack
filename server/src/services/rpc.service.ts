import axios, { type AxiosInstance } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { metricsService } from './metrics.service.js';

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

/**
 * What a caller is prepared to hear back.
 *
 * `tolerated` names a refusal the caller handles itself -- a condition it
 * expects now and then, and retries or does without. The call still fails
 * exactly as before; only the log line changes, from an error to information.
 * Every other refusal is still an error, because a caller that catches an
 * exception it did not name is not handling it.
 */
export interface CallOptions {
  tolerated?: RegExp;
}

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

  async call<T>(
    method: string,
    params: unknown[] = [],
    cacheKeySuffix?: string,
    options: CallOptions = {}
  ): Promise<T> {
    const ttlKey = cacheKeySuffix ? `${method}:${cacheKeySuffix}` : method;
    const ttl = CACHE_TTL_MS[ttlKey];
    const cacheKey = ttl ? `${ttlKey}|${JSON.stringify(params)}` : null;

    if (cacheKey && ttl) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.atMs < ttl) return cached.value as T;

      const pending = this.inFlight.get(cacheKey);
      if (pending) return pending as Promise<T>;
    }

    const promise = this.doCallWithRetry<T>(method, params, options);

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

  /**
   * One retry, transport failures only.
   *
   * The node drops the odd connection mid-request ("socket hang up",
   * ECONNRESET) a few times a day; every caller here is a read, so repeating
   * it is safe and the alternative is a logged error and a missed poll. An
   * error the node actually answered with -- an RPC error object or any HTTP
   * status -- is a real answer and is never retried.
   */
  private async doCallWithRetry<T>(method: string, params: unknown[], options: CallOptions): Promise<T> {
    try {
      return await this.doCall<T>(method, params, options);
    } catch (error: unknown) {
      const transient =
        error instanceof Error && /socket hang up|ECONNRESET|ETIMEDOUT|EPIPE/i.test(error.message);
      if (!transient) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      logger.warn(`RPC ${method}: transport error, retrying once`);
      return this.doCall<T>(method, params, options);
    }
  }

  private async doCall<T>(method: string, params: unknown[], options: CallOptions): Promise<T> {
    const id = ++this.requestId;
    const startedAt = performance.now();
    let failed = true;
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
      failed = false;
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

      if (options.tolerated?.test(sanitised)) {
        logger.info(`RPC ${method}: ${sanitised} (expected by the caller, which retries or does without)`);
      } else {
        logger.error(`RPC ${method} failed: ${sanitised}`);
      }
      throw new Error(`RPC ${method}: ${sanitised}`);
    } finally {
      metricsService.observeRpc(method, performance.now() - startedAt, failed);
    }
  }

  // ── chain ────────────────────────────────────────────────────────────────

  getBlockCount(): Promise<number> {
    return this.call<number>('getblockcount');
  }

  /**
   * The node's current best ChainLock, or null when none exists yet.
   *
   * "Unable to find any ChainLock" is the node's answer on a chain that has
   * not locked anything -- an ordinary state, not a failure, so it maps to
   * null instead of an error. Since v22.1.5 the response carries `llmqType`,
   * the resolved name of the profile that signed the lock; that field is what
   * lets the watcher cross-check its own signed-height resolver mirror.
   */
  async getBestChainLock(): Promise<RpcBestChainLock | null> {
    try {
      return await this.call<RpcBestChainLock>('getbestchainlock');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unable to find any ChainLock')) {
        return null;
      }
      throw error;
    }
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

  /**
   * Every registered masternode's proTxHash at a height, in the node's own
   * iteration order.
   *
   * `registered`, not `valid`: rpc/evo.cpp sets onlyValid from the type, and a
   * DSL commitment's bitfield is sized to the whole list with banned members
   * included. Asking for `valid` returns a shorter list that the indices no
   * longer address, and the mismatch would be silent.
   */
  protxListRegistered(height: number): Promise<string[]> {
    return this.call<string[]>('protx', ['list', 'registered', false, height]);
  }

  /**
   * The simplified masternode list at `height`, as `protx diff 1 <height>`
   * reports it. It is the one RPC that exposes `confirmedHash` -- the
   * detailed `protx list` state omits it -- and `isValid` is `!IsBanned()`,
   * which covers the DSL ban as well as the DKG one. Base block 1 is the
   * lowest the RPC accepts ("must not be 0") and holds no masternode, so the
   * diff is the whole list.
   */
  protxSimplifiedListAt(height: number): Promise<RpcSimplifiedMnListDiff> {
    return this.call<RpcSimplifiedMnListDiff>('protx', ['diff', 1, height]);
  }

  /**
   * A block with every transaction expanded, in one call.
   *
   * Verbosity 2 used to abort on every proof-of-stake block -- a coinstake
   * mints its reward, so inputs minus outputs is negative and `MoneyRange(fee)`
   * rejected it -- which is why indexing fetched each transaction separately.
   * Upstream #55 fixed that, so one call now replaces one per transaction.
   */
  getBlockVerbose(hash: string): Promise<RpcBlockVerbose> {
    return this.call<RpcBlockVerbose>('getblock', [hash, 2]);
  }

  getRawTransaction(txid: string): Promise<RpcTransaction> {
    return this.call<RpcTransaction>('getrawtransaction', [txid, 1]);
  }

  /** Authoritative payee for a block; empty for blocks that paid nobody. */
  masternodePayments(blockhash: string): Promise<RpcMasternodePayment[]> {
    return this.call<RpcMasternodePayment[]>('masternode', ['payments', blockhash, 1]);
  }

  getNetworkInfo(): Promise<{ version: number; subversion: string; connections: number }> {
    return this.call('getnetworkinfo');
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
  /** Present on a quorum commitment (type 6). */
  qcTx?: {
    version?: number;
    height?: number;
    commitment?: {
      version?: number;
      llmqType?: number;
      quorumHash?: string;
      validMembersCount?: number;
      signersCount?: number;
      /**
       * One bit per SELECTED member, hex-encoded. Its byte length is the only
       * thing in the commitment that bounds the quorum's real size, which is
       * min(profile size, masternodes available) and can sit far below the
       * profile's nominal size.
       */
      validMembers?: string;
    };
  };
  /** Present on a DSL service commitment (type 10). */
  poseServiceTx?: {
    version?: number;
    commitment?: {
      version?: number;
      epoch?: number;
      epochBlockHash?: string;
      llmqType?: number;
      quorumHash?: string;
      missedCount?: number;
      size?: number;
      missedIndices?: number[];
    };
  };
}

export interface RpcMasternodePayment {
  height: number;
  blockhash: string;
  amount: number;
  masternodes?: Array<{ proTxHash: string; amount: number }>;
}

/** Same as RpcBlock, but `tx` carries whole transactions rather than txids. */
export interface RpcBlockVerbose extends Omit<RpcBlock, 'tx'> {
  tx: RpcTransaction[];
}

export interface RpcBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  initialblockdownload: boolean;
  /**
   * Buried deployments appear here only while reachable: v19 and v20 are
   * absent on every network where their height is `numeric_limits<int>::max()`,
   * which is all three. Absent therefore reads as inactive.
   */
  softforks?: Record<string, { type?: string; active?: boolean; height?: number }>;
}

export interface RpcSimplifiedMnListEntry {
  nVersion: number;
  nType: number;
  proRegTxHash: string;
  confirmedHash: string;
  service: string;
  pubKeyOperator: string;
  votingAddress: string;
  isValid: boolean;
}

export interface RpcSimplifiedMnListDiff {
  baseBlockHash: string;
  blockHash: string;
  deletedMNs: string[];
  mnList: RpcSimplifiedMnListEntry[];
}

export interface RpcBestChainLock {
  blockhash: string;
  height: number;
  /** Resolved signing profile name (e.g. "llmq_defcon"); present since v22.1.5. */
  llmqType?: string;
  signature: string;
  known_block: boolean;
}

export const rpc = new RpcService();
