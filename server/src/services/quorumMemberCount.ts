import type { CallOptions } from './rpc.service.js';

/** The one refusal this resolver expects: the quorum is not (yet) in the node's cache. */
export const QUORUM_NOT_FOUND = /quorum not found/i;

export interface MemberCountRpc {
  call<T>(method: string, params: unknown[], cacheKeySuffix?: string, options?: CallOptions): Promise<T>;
}

export interface ResolveOptions {
  /**
   * Ask again, briefly, when the node says the quorum is not found.
   *
   * Meant for the block the commitment was mined in: the block notification
   * runs a few hundred milliseconds ahead of the node's quorum cache, so the
   * first question at the tip lands too early. Measured on the lab: a new
   * quorum is listed about 200 ms after its block and describable about 200 ms
   * after that, and the sync had asked 15 ms after the block, every time. For
   * a historical block the refusal is final and a wait would only slow the
   * sync down.
   */
  retryBriefly: boolean;
}

/**
 * How many members a quorum actually seated, from `quorum info`.
 *
 * This is the number Core punishes over, and nothing in the commitment carries
 * it: the profile size is an upper bound the chain rarely reaches, and the
 * validMembers bitfield is allocated at that same profile size regardless of
 * how many members were selected.
 *
 * Only a resolved count is cached. A failure used to be cached too, as null,
 * which turned one question asked too early into an answer the process kept
 * for its lifetime.
 */
export class QuorumMemberCountResolver {
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly rpc: MemberCountRpc,
    private readonly retry: { attempts: number; delayMs: number } = { attempts: 3, delayMs: 300 },
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))
  ) {}

  async resolve(llmqType: number, quorumHash: string, options: ResolveOptions): Promise<number | null> {
    const key = `${llmqType}:${quorumHash}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const attempts = options.retryBriefly ? this.retry.attempts : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const info = await this.rpc.call<{ members?: unknown[] }>(
          'quorum',
          ['info', llmqType, quorumHash],
          undefined,
          { tolerated: QUORUM_NOT_FOUND }
        );
        if (!Array.isArray(info?.members)) return null;
        this.cache.set(key, info.members.length);
        return info.members.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!QUORUM_NOT_FOUND.test(message) || attempt === attempts) return null;
        await this.sleep(this.retry.delayMs);
      }
    }
    return null;
  }
}
