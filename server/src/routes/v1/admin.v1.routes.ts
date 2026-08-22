import { Router } from 'express';
import { z } from 'zod';
import { DevnetOperator } from '../../models/DevnetOperator.js';
import { MasternodeState } from '../../models/MasternodeState.js';
import { QuorumRound } from '../../models/QuorumRound.js';
import { requireAdminApiKey } from '../../middleware/requireAdminApiKey.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, sendData, sendError } from '../../utils/http.js';
import { OperatorIndex, hostOf } from '../../domain/operatorIndex.js';

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

export default router;
