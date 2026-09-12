import { Router } from 'express';
import type { ExperimentDetail, ExperimentRow } from '@devnet-deftrack/shared';
import { z } from 'zod';
import {
  ExperimentRun,
  type ExperimentOutcome,
  type ExperimentRunDocument,
} from '../../models/ExperimentRun.js';
import {
  computeOutcome,
  compareOutcomes,
  currentParticipants,
  mainnetRelevantForRun,
} from '../../services/experiment.service.js';
import { formsOnV23Mainnet } from '../../config/llmq.js';
import { rpc } from '../../services/rpc.service.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, MAX_OFFSET, page, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';

const router = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  status: z.enum(['running', 'closed']).optional(),
});
type ListQuery = z.infer<typeof listQuery>;

type ExperimentViewSource = Pick<
  ExperimentRunDocument,
  | 'runKey'
  | 'title'
  | 'hypothesis'
  | 'expected'
  | 'status'
  | 'startedAt'
  | 'endedAt'
  | 'startHeight'
  | 'endHeight'
  | 'nodeVersion'
  | 'nodeGitSha'
  | 'llmqName'
  | 'llmqSize'
  | 'llmqMinSize'
  | 'llmqThreshold'
  | 'dkgInterval'
  | 'participants'
  | 'intervention'
  | 'baselineRunKey'
  | 'outcome'
  | 'notes'
>;

const EXPERIMENT_VIEW_FIELDS =
  'runKey title hypothesis expected status startedAt endedAt startHeight endHeight nodeVersion nodeGitSha llmqName llmqSize llmqMinSize llmqThreshold dkgInterval participants intervention baselineRunKey outcome notes';

/**
 * Registry facts beside the frozen figures. Whether a profile forms on the v23
 * mainnet is a property of the node's chainparams, not of the run, so it is
 * derived here on every read rather than snapshotted into the outcome -- the
 * same rule the LLMQ registry applies to the bad-votes threshold.
 */
function enrichOutcome(o: ExperimentOutcome | null | undefined): ExperimentRow['outcome'] {
  if (!o) return null;
  if (!o.byProfile) return o;
  return {
    ...o,
    byProfile: o.byProfile.map((p) => ({ ...p, formsOnV23Mainnet: formsOnV23Mainnet(p.llmqName) })),
  };
}

function view(r: ExperimentViewSource): ExperimentRow {
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
      formsOnV23Mainnet: formsOnV23Mainnet(r.llmqName),
    },
    participants: r.participants,
    intervention: r.intervention,
    baselineRunKey: r.baselineRunKey,
    outcome: enrichOutcome(r.outcome),
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
      ExperimentRun.find(filter)
        /*
         * `runKey` breaks the tie. Insurance, and named as such.
         *
         * Two runs declared in the same second -- a rollout closes one and
         * opens the next -- are ordered by nothing at all under `startedAt`
         * alone, and a paged reader makes two queries. Measured on this
         * MongoDB: with the sort NOT backed by an index, paging 8 equal-keyed
         * documents in pages of 4 returned two of them twice and two not at
         * all. With the `startedAt` index in place, as this collection has, the
         * order is deterministic and the tie-breaker changes nothing.
         *
         * So this is not the fix for an observed defect -- F04 was entirely
         * client-side. It is what stops the correctness of paging from resting
         * on an index continuing to exist and continuing to be chosen.
         */
        .sort({ startedAt: -1, runKey: -1 })
        .skip(q.offset)
        .limit(q.limit)
        .select(EXPERIMENT_VIEW_FIELDS)
        .lean(),
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

    const run = await ExperimentRun.findOne({ runKey }).select(EXPERIMENT_VIEW_FIELDS).lean();
    if (!run) {
      sendError(res, 404, 'experiment not found');
      return;
    }

    const tip = await rpc.getBlockCount().catch(() => run.endHeight ?? run.startHeight);
    // An outcome frozen before the mainnet view existed answers it from its
    // rounds now, which are still on record. Nothing is written back; a run
    // closed with the field keeps what it froze.
    const withMainnet = async (
      o: ExperimentOutcome | null | undefined,
      r: Pick<ExperimentRunDocument, 'startHeight' | 'endHeight'>
    ): Promise<ExperimentOutcome | null> =>
      o ? (o.mainnetRelevant === undefined ? { ...o, mainnetRelevant: await mainnetRelevantForRun(r, tip) } : o) : null;

    const live = await withMainnet(run.status === 'running' ? await computeOutcome(run, tip) : run.outcome, run);

    // The declared participants stay frozen -- that is the point of declaring
    // them. A running experiment also shows the network as it stands now, so a
    // change during the run is visible rather than hidden behind a stale
    // number.
    const current = run.status === 'running' ? await currentParticipants(tip) : null;

    let comparison = null;
    if (run.baselineRunKey && live) {
      const baseline = await ExperimentRun.findOne({ runKey: run.baselineRunKey })
        .select('status outcome startHeight endHeight llmqName')
        .lean();
      const baselineOutcome =
        baseline &&
        (await withMainnet(
          baseline.status === 'closed' ? baseline.outcome : await computeOutcome(baseline, tip),
          baseline
        ));
      if (baselineOutcome) {
        comparison = {
          baselineRunKey: run.baselineRunKey,
          baseline: enrichOutcome(baselineOutcome) ?? baselineOutcome,
          delta: compareOutcomes(live, baselineOutcome),
        };
      }
    }

    const body: ExperimentDetail = {
      ...view(run),
      outcome: enrichOutcome(live),
      comparison,
      currentParticipants: current,
      tipHeight: tip,
    };
    sendData(res, body);
  })
);

export default router;
