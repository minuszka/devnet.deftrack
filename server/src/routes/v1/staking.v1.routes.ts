import { Router } from 'express';
import { z } from 'zod';
import { Block } from '../../models/Block.js';
import { Transaction } from '../../models/Transaction.js';
import { stakingHealth, type BlockSample } from '../../domain/stakingHealth.js';
import { HostStatus } from '../../models/HostStatus.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, parsedQuery, sendData, validateQuery } from '../../utils/http.js';

const router = Router();

const healthQuery = z.object({
  blocks: z.coerce.number().int().min(10).max(5000).default(500),
});
type HealthQuery = z.infer<typeof healthQuery>;

/**
 * GET /api/v1/staking/health
 *
 * Whether the chain is moving, and whether it is moving because of one machine.
 * The second question is the one that decides whether any measurement taken on
 * this devnet means anything: a chain minted entirely by the seed node says
 * nothing about a network.
 *
 * Keyed on the output script rather than the address: coinstake payouts are
 * pay-to-pubkey and the RPC reports no address for them, so counting addresses
 * returned zero while the chain was plainly being staked.
 */
router.get(
  '/health',
  withCachePolicy('short'),
  validateQuery(healthQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<HealthQuery>(res);

    const tip = await Block.findOne().sort({ height: -1 }).select('height').lean();
    if (!tip) {
      sendData(res, { ...stakingHealth([]), windowBlocks: q.blocks, stakers: [] });
      return;
    }

    const from = Math.max(0, tip.height - q.blocks + 1);

    const [blocks, coinstakes] = await Promise.all([
      Block.find({ height: { $gte: from, $lte: tip.height }, isProofOfStake: true })
        .select('height time')
        .lean(),
      Transaction.find({ isCoinstake: true, height: { $gte: from, $lte: tip.height } })
        .select('height vout')
        .lean(),
    ]);

    // A coinstake marks itself with an empty first output; the payee is the
    // first output that actually pays something.
    const payeeByHeight = new Map<number, string>();
    for (const tx of coinstakes) {
      for (const out of tx.vout) {
        const script = out.scriptHex;
        if (typeof script === 'string' && script.length > 0 && Number(out.valueSat) > 0) {
          payeeByHeight.set(tx.height, script);
          break;
        }
      }
    }

    const samples: BlockSample[] = blocks.map((b) => ({
      height: b.height,
      time: b.time,
      payee: payeeByHeight.get(b.height) ?? null,
    }));

    // Who owns which payout script, so production can be counted per machine
    // rather than per key. A host staking five outputs pays to five different
    // scripts, and counting those as five producers would overstate how
    // distributed block production is.
    const statuses = await HostStatus.find().select('host stakeScripts').lean();
    const owners = new Map<string, string>();
    for (const h of statuses) {
      for (const script of h.stakeScripts ?? []) owners.set(script.toLowerCase(), h.host);
    }

    const health = stakingHealth(samples, owners);

    sendData(res, {
      ...health,
      windowBlocks: q.blocks,
      // The script is an identifier, not something to display in full.
      stakers: health.stakers.map((s) => ({
        ...s,
        payee: s.payee.slice(0, 16),
        host: owners.get(s.payee.toLowerCase()) ?? null,
      })),
    });
  })
);

export default router;
