import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { ServiceEpoch } from '../../models/ServiceEpoch.js';
import { firstCommittableBoundary } from '../../domain/dslSchedule.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, page, parsedQuery, sendData, validateQuery } from '../../utils/http.js';

const router = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['committed', 'absent']).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

/**
 * GET /api/v1/dsl/epochs
 *
 * Every DSL observation epoch whose boundary block has been indexed, newest
 * first. A `committed` row is a converged epoch; an `absent` row is the
 * fail-open datum -- the quorum did not converge on one report set, or the
 * block producer's pool did not reproduce the signed hash. Nobody is
 * penalised by an absent epoch, and distinguishing "the layer paused" from
 * "the layer punished" is the same obligation the DKG view carries.
 */
router.get(
  '/epochs',
  withCachePolicy('short'),
  validateQuery(listQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<ListQuery>(res);

    const filter: Record<string, unknown> = {};
    if (q.status !== undefined) filter.status = q.status;

    const [epochs, total] = await Promise.all([
      ServiceEpoch.find(filter).sort({ boundaryHeight: -1 }).skip(q.offset).limit(q.limit).lean(),
      ServiceEpoch.countDocuments(filter),
    ]);

    const items = epochs.map((e) => ({
      epoch: e.epoch,
      boundaryHeight: e.boundaryHeight,
      status: e.status,
      txid: e.txid,
      epochBlockHash: e.epochBlockHash,
      quorumHash: e.quorumHash,
      missedCount: e.missedCount,
      listSize: e.listSize,
      missedIndices: e.missedIndices,
      missedProTxHashes: e.missedProTxHashes ?? [],
      detectedAt: e.detectedAt,
    }));

    sendData(res, page(items, total, q.limit, q.offset));
  })
);

/**
 * GET /api/v1/dsl/summary
 *
 * The convergence measurement itself: of the boundaries that could legally
 * carry a commitment, how many did. Committed and absent are always reported
 * together -- a convergence rate without its denominator would repeat the
 * formationRate-without-health mistake this project documents.
 */
router.get(
  '/summary',
  withCachePolicy('short'),
  asyncRoute(async (_req, res) => {
    const [committed, absent, missedAgg, latest] = await Promise.all([
      ServiceEpoch.countDocuments({ status: 'committed' }),
      ServiceEpoch.countDocuments({ status: 'absent' }),
      ServiceEpoch.aggregate<{ _id: null; totalMissedBits: number }>([
        { $match: { status: 'committed' } },
        { $group: { _id: null, totalMissedBits: { $sum: '$missedCount' } } },
      ]),
      ServiceEpoch.findOne().sort({ boundaryHeight: -1 }).lean(),
    ]);

    const judged = committed + absent;
    sendData(res, {
      // Declared, never inferred: these are the devnet's consensus parameters,
      // keyed in config exactly like the LLMQ profiles.
      activationHeight: config.dsl.activationHeight,
      epochInterval: config.dsl.epochInterval,
      firstCommittableBoundary:
        config.dsl.activationHeight > 0
          ? firstCommittableBoundary(config.dsl.activationHeight, config.dsl.epochInterval)
          : null,
      enforcement: false, // shadow: the chain records, nobody is penalised

      epochsJudged: judged,
      committed,
      absent,
      /** committed / judged; null until the first boundary is judged at all. */
      convergenceRate: judged > 0 ? committed / judged : null,
      totalMissedBits: missedAgg[0]?.totalMissedBits ?? 0,

      latest: latest
        ? {
            epoch: latest.epoch,
            boundaryHeight: latest.boundaryHeight,
            status: latest.status,
            missedCount: latest.missedCount,
          }
        : null,
    });
  })
);

export default router;
