import { Router } from 'express';
import { z } from 'zod';
import { Block } from '../../models/Block.js';
import { Transaction } from '../../models/Transaction.js';
import { MasternodeState } from '../../models/MasternodeState.js';
import { config } from '../../config.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, page, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';

const router = Router();

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const dec = (v: unknown): string => String(v ?? '0');

/**
 * Reward split for one block, read off the coinbase and coinstake.
 *
 * On this chain a block pays 10,000 DFCN of masternode reward, of which part
 * is burned to an OP_RETURN output and the rest goes to the payee, plus a 500
 * DFCN stake reward folded into the coinstake. Reporting the burn separately
 * matters: the totals do not add up without it, and a reader would otherwise
 * conclude the payment was smaller than the consensus rule says.
 */
/** Only the shape rewardsOf actually reads, so lean() results fit without a cast. */
interface CoinbaseLike {
  // Decimal128 in the document, a plain string once lean(); toString() is the
  // one thing both agree on.
  vout: Array<{ valueSat: { toString(): string }; scriptType: string; address: string | null }>;
}

function rewardsOf(coinbase: CoinbaseLike | undefined): {
  masternodePaidSat: string;
  burnedSat: string;
  payee: string | null;
} {
  let paid = 0n;
  let burned = 0n;
  let payee: string | null = null;

  for (const out of coinbase?.vout ?? []) {
    const value = BigInt(out.valueSat.toString());
    if (value === 0n) continue;
    if (out.scriptType === 'nulldata') burned += value;
    else {
      paid += value;
      payee ??= out.address;
    }
  }
  return { masternodePaidSat: paid.toString(), burnedSat: burned.toString(), payee };
}

/** GET /api/v1/blocks */
router.get(
  '/blocks',
  withCachePolicy('short'),
  validateQuery(pageQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof pageQuery>>(res);

    const [blocks, total] = await Promise.all([
      Block.find()
        .sort({ height: -1 })
        .skip(q.offset)
        .limit(q.limit)
        .select('height hash time nTx size isProofOfStake hasChainLock totalOutSat txids')
        .lean(),
      Block.estimatedDocumentCount(),
    ]);

    // Two queries, not one per row: the coinbase of every listed block is
    // fetched in a single lookup.
    const coinbaseIds = blocks.map((b) => b.txids[0]).filter((x): x is string => Boolean(x));
    const coinbases = new Map<string, CoinbaseLike>(
      (await Transaction.find({ txid: { $in: coinbaseIds } }).select('txid vout').lean()).map((t) => [t.txid, t])
    );

    const items = blocks.map((b) => {
      const r = rewardsOf(coinbases.get(b.txids[0] ?? ''));
      return {
        height: b.height,
        hash: b.hash,
        time: b.time,
        nTx: b.nTx,
        size: b.size,
        isProofOfStake: b.isProofOfStake,
        hasChainLock: b.hasChainLock,
        totalOutSat: dec(b.totalOutSat),
        ...r,
      };
    });

    sendData(res, page(items, total, q.limit, q.offset));
  })
);

/** GET /api/v1/blocks/:id -- height or hash. */
router.get(
  '/blocks/:id',
  withCachePolicy('medium'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    const asHeight = /^\d+$/.test(id) ? Number(id) : null;

    const block =
      asHeight !== null
        ? await Block.findOne({ height: asHeight })
            .select(
              'height hash previousblockhash nextblockhash time mediantime size version merkleroot bits nonce difficulty chainwork nTx isProofOfStake hasChainLock totalOutSat paidProTxHash txids'
            )
            .lean()
        : await Block.findOne({ hash: id })
            .select(
              'height hash previousblockhash nextblockhash time mediantime size version merkleroot bits nonce difficulty chainwork nTx isProofOfStake hasChainLock totalOutSat paidProTxHash txids'
            )
            .lean();

    if (!block) {
      sendError(res, 404, 'block not found');
      return;
    }

    const txs = await Transaction.find({ blockhash: block.hash })
      .select('txid isCoinbase isCoinstake size valueOutSat vout vin')
      .lean();
    const byId = new Map(txs.map((t) => [t.txid, t]));
    const ordered = block.txids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    // Recorded at index time from `masternode payments`; the payout address in
    // the block is shared by every masternode and cannot identify one.
    const paidMasternode = block.paidProTxHash
      ? await MasternodeState.findOne({ proTxHash: block.paidProTxHash })
          .select('proTxHash service operatorLabel')
          .lean()
      : null;

    sendData(res, {
      height: block.height,
      hash: block.hash,
      previousblockhash: block.previousblockhash,
      nextblockhash: block.nextblockhash,
      time: block.time,
      mediantime: block.mediantime,
      size: block.size,
      version: block.version,
      merkleroot: block.merkleroot,
      bits: block.bits,
      nonce: block.nonce,
      difficulty: block.difficulty,
      chainwork: block.chainwork,
      nTx: block.nTx,
      isProofOfStake: block.isProofOfStake,
      hasChainLock: block.hasChainLock,
      totalOutSat: dec(block.totalOutSat),
      ...rewardsOf(ordered[0]),
      paidMasternode: paidMasternode
        ? {
            proTxHash: paidMasternode.proTxHash,
            service: paidMasternode.service,
            operatorLabel: paidMasternode.operatorLabel,
          }
        : null,
      txs: ordered.map((t) => ({
        txid: t.txid,
        isCoinbase: t.isCoinbase,
        isCoinstake: t.isCoinstake,
        size: t.size,
        valueOutSat: dec(t.valueOutSat),
        voutCount: t.vout.length,
        vinCount: t.vin.length,
      })),
    });
  })
);

/**
 * GET /api/v1/chainlocks
 *
 * Coverage and latency over recent blocks. Latency is an observation, not a
 * chain fact -- the node reports whether a block is locked, never when the
 * CLSIG arrived -- so the resolution is stated in the response rather than
 * left for the reader to assume.
 */
router.get(
  '/chainlocks',
  withCachePolicy('short'),
  validateQuery(z.object({ blocks: z.coerce.number().int().min(10).max(5000).default(500) })),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<{ blocks: number }>(res);

    // ChainLocks cannot exist before a quorum does, so coverage is measured
    // from the first lock ever seen. Counting the pre-masternode era as missed
    // locks reported 88% where the truthful figure was 99%.
    const first = await Block.findOne({ hasChainLock: true }).sort({ height: 1 }).select('height').lean();

    const recent = await Block.find({ isProofOfStake: true })
      .sort({ height: -1 })
      .limit(q.blocks)
      .select('height time hasChainLock chainLockedAt chainLockLatencySec chainLockLatencyMs chainLockSource')
      .lean();

    const eligible = first ? recent.filter((b) => b.height >= first.height) : [];
    const locked = eligible.filter((b) => b.hasChainLock);
    const missing = eligible.filter((b) => !b.hasChainLock).map((b) => b.height).sort((a, b) => a - b);

    // Contiguous runs: one long gap is an outage, scattered singles are noise.
    const gaps: Array<{ from: number; to: number; blocks: number }> = [];
    for (const h of missing) {
      const last = gaps.at(-1);
      if (last && h === last.to + 1) {
        last.to = h;
        last.blocks++;
      } else {
        gaps.push({ from: h, to: h, blocks: 1 });
      }
    }

    const measured = locked
      .map((b) => b.chainLockLatencySec)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    const pct = (p: number): number | null =>
      measured.length === 0 ? null : measured[Math.min(measured.length - 1, Math.floor(measured.length * p))]!;

    // Precise measurement: block arrival -> CLSIG arrival, both over ZMQ and
    // on this process's clock. Keep it separate from block-time -> poll-time;
    // averaging those two different quantities would be misleading.
    const eventMeasured = locked
      .filter((b) => b.chainLockSource === 'zmq')
      .map((b) => b.chainLockLatencyMs)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    const eventPct = (p: number): number | null =>
      eventMeasured.length === 0
        ? null
        : eventMeasured[Math.min(eventMeasured.length - 1, Math.floor(eventMeasured.length * p))]!;
    const sourceCounts = {
      zmq: locked.filter((b) => b.chainLockSource === 'zmq').length,
      poll: locked.filter((b) => b.chainLockSource === 'poll').length,
      unknown: locked.filter((b) => b.chainLockSource !== 'zmq' && b.chainLockSource !== 'poll').length,
    };

    sendData(res, {
      firstLockedHeight: first?.height ?? null,
      blocksConsidered: recent.length,
      eligible: eligible.length,
      locked: locked.length,
      unlocked: eligible.length - locked.length,
      coverage: eligible.length > 0 ? locked.length / eligible.length : null,
      gaps: gaps.sort((a, b) => b.blocks - a.blocks).slice(0, 20),
      // Locks seen before the watcher started count as covered but have no
      // measurable latency; they are excluded from the timings, not guessed at.
      latencyMeasured: measured.length,
      latencySec: { p50: pct(0.5), p90: pct(0.9), max: measured.at(-1) ?? null },
      eventLatencyMeasured: eventMeasured.length,
      eventLatencyMs: { p50: eventPct(0.5), p90: eventPct(0.9), max: eventMeasured.at(-1) ?? null },
      sourceCounts,
      resolutionSec: Math.round(config.chainlock.intervalMs / 1000),
      reconciliationIntervalSec: Math.round(config.chainlock.reconcileIntervalMs / 1000),
      points: eligible
        .slice(0, 150)
        .map((b) => ({
          height: b.height,
          time: b.time,
          locked: b.hasChainLock,
          latencySec: b.chainLockLatencySec,
          latencyMs: b.chainLockLatencyMs ?? null,
          source: b.chainLockSource ?? null,
        }))
        .reverse(),
    });
  })
);

/** GET /api/v1/txs */
router.get(
  '/txs',
  withCachePolicy('short'),
  validateQuery(pageQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof pageQuery>>(res);
    const [txs, total] = await Promise.all([
      Transaction.find()
        .sort({ height: -1, _id: -1 })
        .skip(q.offset)
        .limit(q.limit)
        .select('txid height time size isCoinbase isCoinstake hasChainLock valueOutSat vout.n vin.txid')
        .lean(),
      Transaction.estimatedDocumentCount(),
    ]);

    sendData(
      res,
      page(
        txs.map((t) => ({
          txid: t.txid,
          height: t.height,
          time: t.time,
          size: t.size,
          isCoinbase: t.isCoinbase,
          isCoinstake: t.isCoinstake,
          hasChainLock: t.hasChainLock,
          valueOutSat: dec(t.valueOutSat),
          voutCount: t.vout.length,
          vinCount: t.vin.length,
        })),
        total,
        q.limit,
        q.offset
      )
    );
  })
);

/** GET /api/v1/txs/:txid */
router.get(
  '/txs/:txid',
  withCachePolicy('long'),
  asyncRoute(async (req, res) => {
    const txid = String(req.params.txid ?? '');
    const tx = await Transaction.findOne({ txid })
      .select(
        'txid blockhash height time version type size isCoinbase isCoinstake hasChainLock valueOutSat vin.txid vin.vout vin.coinbase vout.n vout.valueSat vout.scriptType vout.address'
      )
      .lean();
    if (!tx) {
      sendError(res, 404, 'transaction not found');
      return;
    }

    sendData(res, {
      txid: tx.txid,
      blockhash: tx.blockhash,
      height: tx.height,
      time: tx.time,
      version: tx.version,
      type: tx.type,
      size: tx.size,
      isCoinbase: tx.isCoinbase,
      isCoinstake: tx.isCoinstake,
      hasChainLock: tx.hasChainLock,
      valueOutSat: dec(tx.valueOutSat),
      vin: tx.vin.map((i) => ({ txid: i.txid, vout: i.vout, coinbase: i.coinbase })),
      vout: tx.vout.map((o) => ({
        n: o.n,
        valueSat: dec(o.valueSat),
        scriptType: o.scriptType,
        address: o.address,
      })),
    });
  })
);

export default router;
