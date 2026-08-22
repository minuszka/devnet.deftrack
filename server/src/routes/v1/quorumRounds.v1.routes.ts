import { Router } from 'express';
import { z } from 'zod';
import type {
  HealthTimeline,
  HealthTimelinePoint,
  QuorumRoundDetail,
  QuorumRoundListItem,
} from '@devnet-deftrack/shared';
import { QuorumRound, type QuorumRoundDocument } from '../../models/QuorumRound.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, page, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';

const router = Router();

const listQuery = z.object({
  // Bounded so no caller can ask for the whole collection in one request.
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  llmqName: z.string().min(1).max(64).optional(),
  status: z.enum(['pending', 'formed', 'failed']).optional(),
  /** Kept for readability: ?formed=false is the failure view. */
  formed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
type ListQuery = z.infer<typeof listQuery>;

const timelineQuery = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 90).default(24),
  llmqName: z.string().min(1).max(64).optional(),
});
type TimelineQuery = z.infer<typeof timelineQuery>;

function baseView(r: QuorumRoundDocument) {
  return {
    roundKey: r.roundKey,
    llmqName: r.llmqName,
    llmqType: r.llmqType,
    quorumIndex: r.quorumIndex,
    expectedHeight: r.expectedHeight,
    status: r.status,
    formed: r.formed,
    quorumHash: r.quorumHash,
    minedBlockHash: r.minedBlockHash,
    size: r.size,
    minSize: r.minSize,
    threshold: r.threshold,
    dkgInterval: r.dkgInterval,
    effectiveSize: r.effectiveSize,
    numValidMembers: r.numValidMembers,
    healthRatio: r.healthRatio,
    punishedCount: r.punishedCount,
    maxPossibleBan: r.maxPossibleBan,
    consecutiveFailures: r.consecutiveFailures,
    detectedAt: r.detectedAt.toISOString(),
  };
}

/** Who the invalid members belonged to -- the question the table has to answer. */
function failuresByOperator(r: QuorumRoundDocument): Array<{ operatorLabel: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const m of r.members) {
    if (m.valid) continue;
    counts.set(m.operatorLabel, (counts.get(m.operatorLabel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([operatorLabel, count]) => ({ operatorLabel, count }))
    .sort((a, b) => b.count - a.count);
}

/** GET /api/v1/quorum-rounds */
router.get(
  '/',
  withCachePolicy('medium'),
  validateQuery(listQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<ListQuery>(res);

    const filter: Record<string, unknown> = {};
    if (q.llmqName) filter.llmqName = q.llmqName;
    if (q.status) filter.status = q.status;
    if (q.formed !== undefined) filter.formed = q.formed;

    const [rounds, total] = await Promise.all([
      QuorumRound.find(filter).sort({ expectedHeight: -1 }).skip(q.offset).limit(q.limit),
      QuorumRound.countDocuments(filter),
    ]);

    const items: QuorumRoundListItem[] = rounds.map((r) => ({
      ...baseView(r),
      invalidMemberCount: r.invalidMembers.length,
      failuresByOperator: failuresByOperator(r),
    }));

    sendData(res, page(items, total, q.limit, q.offset));
  })
);

/**
 * GET /api/v1/quorum-rounds/health-timeline
 *
 * Declared before the /:roundKey route so "health-timeline" is not swallowed
 * as an identifier.
 */
router.get(
  '/health-timeline',
  withCachePolicy('medium'),
  validateQuery(timelineQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<TimelineQuery>(res);
    const since = new Date(Date.now() - q.hours * 3600_000);

    const filter: Record<string, unknown> = { detectedAt: { $gte: since } };
    if (q.llmqName) filter.llmqName = q.llmqName;

    const rounds = await QuorumRound.find(filter).sort({ expectedHeight: 1 });

    const points: HealthTimelinePoint[] = rounds.map((r) => ({
      expectedHeight: r.expectedHeight,
      detectedAt: r.detectedAt.toISOString(),
      status: r.status,
      // Deliberately null, not 0: a round that never formed has no health
      // ratio, and plotting it as zero would invent a data point.
      healthRatio: r.status === 'formed' ? r.healthRatio : null,
      numValidMembers: r.numValidMembers,
      effectiveSize: r.effectiveSize,
      punishedCount: r.punishedCount,
    }));

    const formed = rounds.filter((r) => r.status === 'formed');
    const failed = rounds.filter((r) => r.status === 'failed');
    const pending = rounds.filter((r) => r.status === 'pending');

    const ratios = formed
      .map((r) => r.healthRatio)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    const median = ratios.length
      ? ratios.length % 2 === 1
        ? ratios[(ratios.length - 1) / 2]!
        : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2
      : null;

    let streak = 0;
    let longest = 0;
    for (const r of rounds) {
      if (r.status === 'failed') longest = Math.max(longest, ++streak);
      else if (r.status === 'formed') streak = 0;
    }

    const decided = formed.length + failed.length;

    const body: HealthTimeline = {
      points,
      hours: q.hours,
      llmqName: q.llmqName ?? (rounds[0]?.llmqName ?? ''),
      summary: {
        rounds: rounds.length,
        formed: formed.length,
        failed: failed.length,
        pending: pending.length,
        // Pending rounds are excluded rather than counted as failures: a round
        // still inside its mining window has not failed yet.
        formationRate: decided > 0 ? formed.length / decided : null,
        medianHealthRatio: median,
        worstHealthRatio: ratios.length ? ratios[0]! : null,
        longestFailureStreak: longest,
      },
    };

    sendData(res, body);
  })
);

/** GET /api/v1/quorum-rounds/:roundKey -- also accepts a quorumHash. */
router.get(
  '/:id',
  withCachePolicy('medium'),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '');
    if (id.length === 0 || id.length > 128) {
      sendError(res, 400, 'id must be a roundKey or a quorumHash');
      return;
    }

    const round =
      (await QuorumRound.findOne({ roundKey: id })) ?? (await QuorumRound.findOne({ quorumHash: id }));

    if (!round) {
      sendError(res, 404, 'round not found');
      return;
    }

    const detail: QuorumRoundDetail = {
      ...baseView(round),
      invalidMembers: round.invalidMembers,
      members: round.members.map((m) => ({
        proTxHash: m.proTxHash,
        service: m.service,
        valid: m.valid,
        operatorLabel: m.operatorLabel,
      })),
    };

    sendData(res, detail);
  })
);

export default router;
