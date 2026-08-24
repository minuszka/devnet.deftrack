import { Router } from 'express';
import { z } from 'zod';
import { ExperimentRun, type ExperimentRunDocument } from '../../models/ExperimentRun.js';
import { computeOutcome, compareOutcomes } from '../../services/experiment.service.js';
import { rpc } from '../../services/rpc.service.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, page, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';

const router = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['running', 'closed']).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

function view(r: ExperimentRunDocument) {
  return {
    runKey: r.runKey,
    title: r.title,
    hypothesis: r.hypothesis,
    expected: r.expected,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    startHeight: r.startHeight,
    endHeight: r.endHeight,
    nodeVersion: r.nodeVersion,
    nodeGitSha: r.nodeGitSha,
    profile: {
      llmqName: r.llmqName,
      size: r.llmqSize,
      minSize: r.llmqMinSize,
      threshold: r.llmqThreshold,
      dkgInterval: r.dkgInterval,
    },
    participants: r.participants,
    intervention: r.intervention,
    baselineRunKey: r.baselineRunKey,
    outcome: r.outcome,
    notes: r.notes,
  };
}

/** GET /api/v1/experiments */
router.get(
  '/',
  withCachePolicy('short'),
  validateQuery(listQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<ListQuery>(res);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;

    const [runs, total] = await Promise.all([
      ExperimentRun.find(filter).sort({ startedAt: -1 }).skip(q.offset).limit(q.limit),
      ExperimentRun.countDocuments(filter),
    ]);

    sendData(res, page(runs.map(view), total, q.limit, q.offset));
  })
);

/**
 * GET /api/v1/experiments/:runKey
 *
 * A closed run answers with the outcome frozen at close; a running one answers
 * with the outcome as it stands right now, recomputed from the observations. In
 * both cases the numbers are derived, so a later correction to the derivation
 * changes the answer without touching the evidence.
 */
router.get(
  '/:runKey',
  withCachePolicy('short'),
  asyncRoute(async (req, res) => {
    const runKey = String(req.params.runKey ?? '');
    if (runKey.length === 0 || runKey.length > 80) {
      sendError(res, 400, 'runKey required');
      return;
    }

    const run = await ExperimentRun.findOne({ runKey });
    if (!run) {
      sendError(res, 404, 'experiment not found');
      return;
    }

    const tip = await rpc.getBlockCount().catch(() => run.endHeight ?? run.startHeight);
    const live = run.status === 'running' ? await computeOutcome(run, tip) : run.outcome;

    let comparison = null;
    if (run.baselineRunKey && live) {
      const baseline = await ExperimentRun.findOne({ runKey: run.baselineRunKey });
      const baselineOutcome =
        baseline && (baseline.status === 'closed'
          ? baseline.outcome
          : await computeOutcome(baseline, tip));
      if (baselineOutcome) {
        comparison = {
          baselineRunKey: run.baselineRunKey,
          baseline: baselineOutcome,
          delta: compareOutcomes(live, baselineOutcome),
        };
      }
    }

    sendData(res, { ...view(run), outcome: live, comparison });
  })
);

export default router;
