import { Router } from 'express';
import { z } from 'zod';
import { DevnetOperator } from '../../models/DevnetOperator.js';
import { MasternodeState } from '../../models/MasternodeState.js';
import { QuorumRound } from '../../models/QuorumRound.js';
import { requireAdminApiKey } from '../../middleware/requireAdminApiKey.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, sendData, sendError } from '../../utils/http.js';
import { OperatorIndex, hostOf } from '../../domain/operatorIndex.js';
import { ExperimentRun } from '../../models/ExperimentRun.js';
import { Transaction } from '../../models/Transaction.js';
import { computeOutcome, currentParticipants } from '../../services/experiment.service.js';
import { chainlockProfileAtHeight } from '../../config/llmq.js';
import { rpc } from '../../services/rpc.service.js';

const router = Router();

router.use(requireAdminApiKey);
// Operator data changes by hand, rarely; never let a proxy hold it.
router.use(withCachePolicy('no-store'));

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const operatorSchema = z.object({
  operatorLabel: z.string().min(1).max(64),
  proTxHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/i)).default([]),
  hostIps: z.array(z.string().regex(ipv4)).default([]),
  contact: z.string().max(200).nullable().default(null),
  vpsProvider: z.string().max(80).nullable().default(null),
  country: z.string().max(80).nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
});
const bulkSchema = z.object({ operators: z.array(operatorSchema).min(1).max(200) });

/**
 * PUT /api/v1/admin/operators
 *
 * Upsert by operatorLabel. Attribution is declared, never inferred: a wrong
 * guess here would put a real failure on the wrong person's name.
 */
router.put(
  '/operators',
  asyncRoute(async (req, res) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    const ops = parsed.data.operators.map((o) => ({
      updateOne: {
        filter: { operatorLabel: o.operatorLabel },
        update: { $set: o },
        upsert: true,
      },
    }));
    const result = await DevnetOperator.bulkWrite(ops, { ordered: false });

    // Apply the new mapping to what is already stored, so the change shows up
    // without waiting for the next poll.
    const mappings = await DevnetOperator.find().select('operatorLabel proTxHashes hostIps').lean();
    const index = new OperatorIndex(mappings);
    const nodes = await MasternodeState.find().select('proTxHash hostIp operatorLabel').lean();

    const relabel = nodes
      .map((n) => ({ n, label: index.resolve(n.proTxHash, n.hostIp) }))
      .filter(({ n, label }) => label !== n.operatorLabel)
      .map(({ n, label }) => ({
        updateOne: { filter: { proTxHash: n.proTxHash }, update: { $set: { operatorLabel: label } } },
      }));
    if (relabel.length > 0) await MasternodeState.bulkWrite(relabel, { ordered: false });

    // Rounds carry the label they were collected under, so a mapping added
    // later would leave every past round reading "unattributed". Relabelling
    // them is not rewriting an observation: who ran a node is metadata, and
    // which member was invalid is untouched.
    const rounds = await QuorumRound.find({ 'members.0': { $exists: true } })
      .select('roundKey members')
      .lean();
    const roundOps = [];
    for (const round of rounds) {
      const members = round.members.map((m) => ({
        ...m,
        operatorLabel: index.resolve(m.proTxHash, hostOf(m.service)),
      }));
      if (members.some((m, i) => m.operatorLabel !== round.members[i]?.operatorLabel)) {
        roundOps.push({
          updateOne: { filter: { roundKey: round.roundKey }, update: { $set: { members } } },
        });
      }
    }
    if (roundOps.length > 0) await QuorumRound.bulkWrite(roundOps, { ordered: false });

    sendData(res, {
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      masternodesRelabelled: relabel.length,
      roundsRelabelled: roundOps.length,
      unattributed: nodes.length - nodes.filter((n) => index.resolve(n.proTxHash, n.hostIp)).length,
    });
  })
);

/** GET /api/v1/admin/operators */
router.get(
  '/operators',
  asyncRoute(async (_req, res) => {
    const [operators, nodes] = await Promise.all([
      DevnetOperator.find().sort({ operatorLabel: 1 }).lean(),
      MasternodeState.find().select('proTxHash hostIp operatorLabel').lean(),
    ]);

    sendData(res, {
      operators: operators.map((o) => ({
        operatorLabel: o.operatorLabel,
        proTxHashes: o.proTxHashes,
        hostIps: o.hostIps,
        contact: o.contact,
        vpsProvider: o.vpsProvider,
        country: o.country,
        notes: o.notes,
        matchedMasternodes: nodes.filter((n) => n.operatorLabel === o.operatorLabel).length,
      })),
      unattributedMasternodes: nodes.filter((n) => !n.operatorLabel).length,
      // Hosts seen on chain with nobody claiming them -- the gaps to fill.
      unclaimedHosts: [
        ...new Set(nodes.filter((n) => !n.operatorLabel).map((n) => n.hostIp).filter(Boolean)),
      ],
    });
  })
);

/** DELETE /api/v1/admin/operators/:label */
router.delete(
  '/operators/:label',
  asyncRoute(async (req, res) => {
    const label = String(req.params.label ?? '');
    const result = await DevnetOperator.deleteOne({ operatorLabel: label });
    if (result.deletedCount === 0) {
      sendError(res, 404, 'operator not found');
      return;
    }
    await MasternodeState.updateMany({ operatorLabel: label }, { $set: { operatorLabel: null } });
    sendData(res, { deleted: label });
  })
);


/**
 * Experiment runs.
 *
 * Declared, never inferred. The point of the record is that what was intended
 * and what was done are stated before the result is known -- a hypothesis
 * written after the fact is not a hypothesis.
 */
const experimentSchema = z.object({
  runKey: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  title: z.string().min(1).max(200),
  hypothesis: z.string().max(2000).default(''),
  expected: z.string().max(2000).default(''),
  baselineRunKey: z.string().max(80).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
  nodeGitSha: z.string().max(64).nullable().default(null),
  intervention: z
    .object({
      kind: z.string().min(1).max(80),
      description: z.string().max(1000).default(''),
      targets: z.array(z.string().max(120)).max(500).default([]),
    })
    .nullable()
    .default(null),
});

/** POST /api/v1/admin/experiments -- opens a run at the current tip. */
router.post(
  '/experiments',
  asyncRoute(async (req, res) => {
    const parsed = experimentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    const body = parsed.data;

    if (await ExperimentRun.exists({ runKey: body.runKey })) {
      sendError(res, 409, `experiment "${body.runKey}" already exists`);
      return;
    }

    const [tip, net] = await Promise.all([
      rpc.getBlockCount(),
      rpc.getNetworkInfo().catch(() => null),
    ]);
    // Resolved at the tip, not the static name: a run opened after the
    // ChainLock switchover must declare the profile actually signing.
    const profile = chainlockProfileAtHeight(tip);

    // Counted by machine rather than by payout key: a host staking five
    // outputs pays to five scripts, and a declaration that inflates its own
    // participant count is worse than none.
    const participants = await currentParticipants(tip);

    const run = await ExperimentRun.create({
      ...body,
      status: 'running',
      startedAt: new Date(),
      startHeight: tip,
      nodeVersion: net?.subversion?.match(/:([0-9.]+)/)?.[1] ?? 'unknown',
      llmqName: profile.llmqName,
      llmqSize: profile.size,
      llmqMinSize: profile.minSize,
      llmqThreshold: profile.threshold,
      dkgInterval: profile.dkgInterval,
      participants,
    });

    sendData(res, { runKey: run.runKey, startHeight: run.startHeight, status: run.status });
  })
);

/**
 * PATCH /api/v1/admin/experiments/:runKey -- records what the run concluded.
 *
 * Notes only, and deliberately writable after close: the numbers freeze at
 * close, but what they turned out to mean is often only clear afterwards, and
 * a finding kept outside the record is a finding that gets lost. Nothing the
 * run declared beforehand can be edited here -- a hypothesis that can be
 * rewritten once the answer is known is not a hypothesis.
 */
const notesSchema = z.object({ notes: z.string().max(2000).nullable() });

router.patch(
  '/experiments/:runKey',
  asyncRoute(async (req, res) => {
    const parsed = notesSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    const run = await ExperimentRun.findOneAndUpdate(
      { runKey: String(req.params.runKey ?? '') },
      { $set: { notes: parsed.data.notes } },
      { new: true }
    );
    if (!run) {
      sendError(res, 404, 'experiment not found');
      return;
    }

    sendData(res, { runKey: run.runKey, notes: run.notes });
  })
);

/**
 * POST /api/v1/admin/experiments/:runKey/close -- freezes the outcome.
 *
 * `endHeight` is optional and defaults to the tip. It exists because a run
 * left open keeps absorbing whatever the network does next: a baseline opened
 * at height 1458 and closed at 2475 had swallowed two ban waves and 78 bans,
 * which is precisely what a baseline must not contain. Closing at the height
 * where a run stopped describing what it was opened to describe is the only
 * way to recover one, and it cannot be done by closing late.
 *
 * Bounded at both ends: never before the run started, never past the tip. A
 * window that runs backwards or into unmined chain would produce an outcome
 * over blocks that do not exist.
 */
const closeSchema = z.object({ endHeight: z.coerce.number().int().min(0).optional() });

router.post(
  '/experiments/:runKey/close',
  asyncRoute(async (req, res) => {
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }

    const run = await ExperimentRun.findOne({ runKey: String(req.params.runKey ?? '') });
    if (!run) {
      sendError(res, 404, 'experiment not found');
      return;
    }
    if (run.status === 'closed') {
      sendError(res, 409, 'experiment already closed');
      return;
    }

    const tip = await rpc.getBlockCount();
    const requested = parsed.data.endHeight;
    if (requested !== undefined) {
      if (requested < run.startHeight) {
        sendError(res, 400, `endHeight ${requested} is below startHeight ${run.startHeight}`);
        return;
      }
      if (requested > tip) {
        sendError(res, 400, `endHeight ${requested} is above the tip ${tip}`);
        return;
      }
    }

    run.endHeight = requested ?? tip;
    run.endedAt = new Date();
    // Snapshotted so a published result stays quotable -- not so it becomes the
    // only copy. Everything here is recomputable from the rounds and events.
    run.outcome = await computeOutcome(run, tip);
    run.status = 'closed';
    await run.save();

    sendData(res, { runKey: run.runKey, endHeight: run.endHeight, outcome: run.outcome });
  })
);

/**
 * DELETE /api/v1/admin/experiments/:runKey -- withdraws a run that has not
 * concluded anything.
 *
 * The declaration freeze protects hypotheses from being rewritten once the
 * answer is known; it must not preserve a declaration that was wrong at birth
 * (the profile-snapshot bug that stamped llmq_400_60 on a post-switchover run
 * is the founding example). Withdrawing is therefore allowed only while the
 * run is still open and has no frozen outcome -- a closed run is a published
 * result and stays.
 */
router.delete(
  '/experiments/:runKey',
  asyncRoute(async (req, res) => {
    const run = await ExperimentRun.findOne({ runKey: String(req.params.runKey ?? '') });
    if (!run) {
      sendError(res, 404, 'experiment not found');
      return;
    }
    if (run.status === 'closed' || run.outcome !== null) {
      sendError(res, 409, 'a closed experiment is a published result; it cannot be withdrawn');
      return;
    }
    await ExperimentRun.deleteOne({ _id: run._id });
    sendData(res, { withdrawn: run.runKey });
  })
);

export default router;
