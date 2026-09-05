import { Router } from 'express';
import { z } from 'zod';
import { QuorumCommitment } from '../../models/QuorumCommitment.js';
import { MasternodeEvent } from '../../models/MasternodeEvent.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, MAX_OFFSET, page, parsedQuery, sendData, validateQuery } from '../../utils/http.js';
import { hostLabel } from '../../domain/hostRedaction.js';
import { hostRedactionPolicy } from '../../services/hostLabel.service.js';

const router = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  llmqType: z.coerce.number().int().min(0).max(255).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

/**
 * GET /api/v1/quorum-commitments
 *
 * Every commitment mined, whatever its type, with the punishments that landed
 * in the same block attached to it.
 *
 * This is what turns "46 masternodes were banned" into "the InstantSend quorum
 * accepted 29 members out of 50 and punished the rest" -- and it is what showed
 * that the quorum this deployment actually measures was sitting at 80 out of 80
 * while the bans were happening. Punishment came from quorums the measurement
 * does not track, and without this the two are indistinguishable.
 */
router.get(
  '/',
  withCachePolicy('short'),
  validateQuery(listQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<ListQuery>(res);

    const filter: Record<string, unknown> = {};
    if (q.llmqType !== undefined) filter.llmqType = q.llmqType;

    const [commitments, total] = await Promise.all([
      QuorumCommitment.find(filter).sort({ minedHeight: -1 }).skip(q.offset).limit(q.limit).lean(),
      QuorumCommitment.countDocuments(filter),
    ]);

    // Punishments recorded at the same heights. Correlation by height, not
    // proof of causation -- two commitments can share a block, and the events
    // do not name which one punished them.
    const heights = commitments.map((c) => c.minedHeight);
    const events = await MasternodeEvent.find({
      height: { $in: heights },
      type: { $in: ['banned', 'penalty_up'] },
    })
      .select('height type hostIp operatorLabel')
      .lean();

    const byHeight = new Map<number, { banned: number; penalised: number; hosts: Set<string> }>();
    for (const e of events) {
      const entry = byHeight.get(e.height) ?? { banned: 0, penalised: 0, hosts: new Set<string>() };
      if (e.type === 'banned') entry.banned++;
      else entry.penalised++;
      const label = hostLabel(e.hostIp, hostRedactionPolicy());
      if (label) entry.hosts.add(label);
      byHeight.set(e.height, entry);
    }

    const items = commitments.map((c) => {
      const at = byHeight.get(c.minedHeight);
      const commitmentsAtHeight = commitments.filter((o) => o.minedHeight === c.minedHeight).length;
      return {
        llmqType: c.llmqType,
        llmqName: c.llmqName,
        quorumHash: c.quorumHash,
        quorumHeight: c.quorumHeight,
        minedHeight: c.minedHeight,
        validMembersCount: c.validMembersCount,
        signersCount: c.signersCount,
        punishedCount: c.punishedCount,
        /** Whether this deployment measures this quorum type at all. */
        tracked: c.llmqName !== null,
        punishmentsInBlock: at
          ? { banned: at.banned, penalised: at.penalised, hosts: [...at.hosts].sort() }
          : { banned: 0, penalised: 0, hosts: [] },
        /** More than one commitment in the block: the attribution is ambiguous. */
        sharesBlock: commitmentsAtHeight > 1,
      };
    });

    sendData(res, page(items, total, q.limit, q.offset));
  })
);

export default router;
