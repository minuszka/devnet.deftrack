import { Router } from 'express';
import { z } from 'zod';
import { QuorumRound } from '../../models/QuorumRound.js';
import { MasternodeState } from '../../models/MasternodeState.js';
import { selectionFairness, type RoundMembership } from '../../domain/selectionFairness.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { hostLabel } from '../../domain/hostRedaction.js';
import { hostRedactionPolicy } from '../../services/hostLabel.service.js';
import { asyncRoute, parsedQuery, sendData, validateQuery } from '../../utils/http.js';

const router = Router();

const query = z.object({
  rounds: z.coerce.number().int().min(1).max(500).default(50),
  llmqName: z.string().min(1).max(64).optional(),
});
type Query = z.infer<typeof query>;

/**
 * GET /api/v1/fairness/selection
 *
 * Who the selection reaches, and who fails once reached.
 *
 * These are separate questions and the page must not blur them: never being
 * selected is a property of the selection, while failing after selection is
 * the node's own doing. A profile change can move either, and only the second
 * is a fault -- which is precisely what the Q60 test has to be able to tell
 * apart.
 *
 * Only formed rounds are considered. A round that never formed has no member
 * list, so nobody can be counted as selected or as failing in it.
 */
router.get(
  '/selection',
  withCachePolicy('long'),
  validateQuery(query),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<Query>(res);

    const filter: Record<string, unknown> = { status: 'formed' };
    if (q.llmqName) filter.llmqName = q.llmqName;

    const [rounds, states] = await Promise.all([
      QuorumRound.find(filter)
        .sort({ expectedHeight: -1 })
        .limit(q.rounds)
        .select('members effectiveSize expectedHeight')
        .lean(),
      // The pool the selection could draw from -- active masternodes, not just
      // the ones that happened to be picked. registeredHeight travels with each
      // so the domain can hold every round against the pool that existed at
      // that round's height, not against today's list.
      MasternodeState.find({ active: { $ne: false } })
        .select('proTxHash hostIp operatorLabel registeredHeight')
        .lean(),
    ]);

    const known = new Map(
      states.map((s) => [
        s.proTxHash,
        {
          // Redacted at the input, so every host figure downstream -- the
          // per-host table, the concentration numbers -- is already a label.
          host: hostLabel(s.hostIp, hostRedactionPolicy()),
          operatorLabel: s.operatorLabel ?? null,
          registeredHeight: s.registeredHeight ?? null,
        },
      ])
    );

    const memberships: RoundMembership[] = rounds.map((r) => ({
      members: r.members.map((m) => ({
        proTxHash: m.proTxHash,
        valid: m.valid,
        operatorLabel: m.operatorLabel,
      })),
      effectiveSize: r.effectiveSize,
      expectedHeight: r.expectedHeight ?? null,
    }));

    const result = selectionFairness(memberships, known);

    sendData(res, {
      ...result,
      llmqName: q.llmqName ?? null,
      heightRange: rounds.length
        ? { from: rounds[rounds.length - 1]!.expectedHeight, to: rounds[0]!.expectedHeight }
        : null,
      // Truncated for display; the identifier is not the point of the table.
      nodes: result.nodes.slice(0, 200).map((n) => ({ ...n, proTxHash: n.proTxHash.slice(0, 16) })),
      neverSelected: result.neverSelected.slice(0, 200).map((h) => h.slice(0, 16)),
      neverSelectedCount: result.neverSelected.length,
    });
  })
);

export default router;
