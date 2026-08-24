import { Router } from 'express';
import { z } from 'zod';
import type { OperatorReliabilityRow } from '@devnet-deftrack/shared';
import { QuorumRound } from '../../models/QuorumRound.js';
import { DevnetOperator } from '../../models/DevnetOperator.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, parsedQuery, sendData, validateQuery } from '../../utils/http.js';

const router = Router();

const reliabilityQuery = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  llmqName: z.string().min(1).max(64).optional(),
});
type ReliabilityQuery = z.infer<typeof reliabilityQuery>;

/**
 * GET /api/v1/operators/reliability
 *
 * Separates a protocol problem from an infrastructure problem: if failures
 * cluster on one operator, the quorum is not what is broken. Rounds that never
 * formed are excluded -- they have no member list, so nobody can be blamed for
 * them, and counting them against operators would invent attribution.
 */
router.get(
  '/reliability',
  withCachePolicy('long'),
  validateQuery(reliabilityQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<ReliabilityQuery>(res);
    const since = new Date(Date.now() - q.hours * 3600_000);

    // Windowed on resolvedAt so the set of rounds considered does not shift
    // just because the collector looked at them again.
    const filter: Record<string, unknown> = { status: 'formed', resolvedAt: { $gte: since } };
    if (q.llmqName) filter.llmqName = q.llmqName;

    const [rounds, operators] = await Promise.all([
      QuorumRound.find(filter).select('members').lean(),
      DevnetOperator.find().lean(),
    ]);

    type Acc = { memberSlots: number; invalidSlots: number; rounds: Set<string> };
    const acc = new Map<string, Acc>();
    const get = (label: string): Acc => {
      let a = acc.get(label);
      if (!a) {
        a = { memberSlots: 0, invalidSlots: 0, rounds: new Set() };
        acc.set(label, a);
      }
      return a;
    };

    for (const [index, round] of rounds.entries()) {
      for (const member of round.members) {
        // Unattributed members are grouped so the total still adds up; a gap in
        // the operator map must be visible, not silently dropped.
        const label = member.operatorLabel ?? '(unattributed)';
        const a = get(label);
        a.memberSlots++;
        if (!member.valid) a.invalidSlots++;
        a.rounds.add(String(index));
      }
    }

    const byLabel = new Map(operators.map((o) => [o.operatorLabel, o]));

    const rows: OperatorReliabilityRow[] = [...acc.entries()]
      .map(([operatorLabel, a]) => {
        const op = byLabel.get(operatorLabel);
        return {
          operatorLabel,
          vpsProvider: op?.vpsProvider ?? null,
          country: op?.country ?? null,
          masternodeCount: op?.proTxHashes.length ?? 0,
          roundsSelected: a.rounds.size,
          memberSlots: a.memberSlots,
          invalidSlots: a.invalidSlots,
          failureRate: a.memberSlots > 0 ? a.invalidSlots / a.memberSlots : null,
        };
      })
      // Worst first: this table exists to point at the problem.
      .sort((x, y) => (y.failureRate ?? -1) - (x.failureRate ?? -1));

    // Operators with no selected rounds still belong in the list; their absence
    // from the data is itself a finding.
    for (const op of operators) {
      if (acc.has(op.operatorLabel)) continue;
      rows.push({
        operatorLabel: op.operatorLabel,
        vpsProvider: op.vpsProvider,
        country: op.country,
        masternodeCount: op.proTxHashes.length,
        roundsSelected: 0,
        memberSlots: 0,
        invalidSlots: 0,
        failureRate: null,
      });
    }

    sendData(res, { hours: q.hours, roundsConsidered: rounds.length, operators: rows });
  })
);

export default router;
