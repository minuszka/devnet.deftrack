import { Router } from 'express';
import { z } from 'zod';
import { PeerObservation } from '../../models/PeerObservation.js';
import { HostStatus } from '../../models/HostStatus.js';
import { propagationSpread, laggards, type HostSighting } from '../../domain/propagation.js';
import { requireIngestToken } from '../../middleware/requireIngestToken.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';

const router = Router();

const ingestSchema = z.object({
  host: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  agentVersion: z.string().max(32).default('unknown'),
  /** The agent's own NTP offset. Recorded, never used to correct a timestamp. */
  clockOffsetMs: z.number().finite().nullable().default(null),
  resolutionMs: z.number().finite().min(0).max(60_000).default(0),
  /** Connectivity, reported far less often than sightings. */
  status: z
    .object({
      peers: z.number().int().min(0).max(10_000),
      inbound: z.number().int().min(0).max(10_000).default(0),
      verifiedMasternodes: z.number().int().min(0).max(10_000).default(0),
      medianPingMs: z.number().finite().nullable().default(null),
      maxPingWaitMs: z.number().finite().nullable().default(null),
      height: z.number().int().min(0).nullable().default(null),
      stakeScripts: z.array(z.string().regex(/^[0-9a-f]{2,140}$/i)).max(200).default([]),
      nodeBuild: z.string().regex(/^[0-9a-f]{0,64}$/i).default(''),
    })
    .optional(),
  observations: z
    .array(
      z.object({
        topic: z.enum(['block', 'chainlock']),
        hash: z.string().regex(/^[0-9a-f]{64}$/i),
        height: z.number().int().min(0).nullable().default(null),
        receivedAt: z.string().datetime(),
      })
    )
    .max(500)
    .default([]),
});

/**
 * POST /api/v1/peers/observations
 *
 * One host reporting what it saw and when. Written with $setOnInsert: a
 * sighting is a fact about a moment on that host, and a retry after a failed
 * push must not move it.
 */
router.post(
  '/observations',
  requireIngestToken,
  withCachePolicy('no-store'),
  asyncRoute(async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    const body = parsed.data;
    const ingestedAt = new Date();

    const ops = body.observations.map((o) => {
      const observationKey = `${body.host}:${o.topic}:${o.hash}`;
      return {
        updateOne: {
          filter: { observationKey },
          update: {
            $setOnInsert: {
              observationKey,
              host: body.host,
              topic: o.topic,
              hash: o.hash.toLowerCase(),
              height: o.height,
              receivedAt: new Date(o.receivedAt),
              clockOffsetMs: body.clockOffsetMs,
              resolutionMs: body.resolutionMs,
              agentVersion: body.agentVersion,
              ingestedAt,
            },
          },
          upsert: true,
        },
      };
    });

    const stored = ops.length > 0 ? (await PeerObservation.bulkWrite(ops, { ordered: false })).upsertedCount : 0;

    if (body.status) {
      const { stakeScripts, ...status } = body.status;
      await HostStatus.updateOne(
        { host: body.host },
        {
          $set: {
            ...status,
            host: body.host,
            clockOffsetMs: body.clockOffsetMs,
            agentVersion: body.agentVersion,
            reportedAt: ingestedAt,
          },
          // Accumulated, never replaced. A payout script belongs to whoever
          // holds its key, permanently -- but it is invisible to the agent
          // while the coinstake that created it is still immature, which is
          // exactly the window covering the most recent blocks. Overwriting
          // would lose attribution for a key every time it went to work.
          $addToSet: { stakeScripts: { $each: stakeScripts } },
        },
        { upsert: true }
      );
    }

    sendData(res, { accepted: body.observations.length, stored });
  })
);

const spreadQuery = z.object({
  topic: z.enum(['block', 'chainlock']).default('block'),
  /** How many recent events to compare across hosts. */
  events: z.coerce.number().int().min(1).max(500).default(50),
});
type SpreadQuery = z.infer<typeof spreadQuery>;

/**
 * GET /api/v1/peers/propagation
 *
 * The same event seen from every host. A spread smaller than the combined
 * clock and poll error is reported as noise rather than as a finding.
 */
router.get(
  '/propagation',
  withCachePolicy('short'),
  validateQuery(spreadQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<SpreadQuery>(res);

    const [hosts, recent] = await Promise.all([
      PeerObservation.distinct('host'),
      PeerObservation.find({ topic: q.topic })
        .sort({ height: -1, receivedAt: -1 })
        .limit(q.events * 12)
        .select('host hash height receivedAt clockOffsetMs resolutionMs')
        .lean(),
    ]);

    const byHash = new Map<string, { height: number | null; sightings: HostSighting[] }>();
    for (const o of recent) {
      const entry = byHash.get(o.hash) ?? { height: o.height, sightings: [] };
      entry.sightings.push({
        host: o.host,
        receivedAtMs: new Date(o.receivedAt).getTime(),
        clockOffsetMs: o.clockOffsetMs,
        resolutionMs: o.resolutionMs,
      });
      byHash.set(o.hash, entry);
    }

    const expected = [...hosts].sort();
    const events = [...byHash.entries()]
      .map(([hash, e]) => ({ hash, height: e.height, ...propagationSpread(e.sightings, expected) }))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      .slice(0, q.events);

    const statuses = await HostStatus.find().sort({ host: 1 }).lean();

    sendData(res, {
      topic: q.topic,
      hostsReporting: expected,
      events,
      laggards: laggards(events),
      hosts: statuses.map((h) => ({
        host: h.host,
        peers: h.peers,
        inbound: h.inbound,
        verifiedMasternodes: h.verifiedMasternodes,
        medianPingMs: h.medianPingMs,
        height: h.height,
        clockOffsetMs: h.clockOffsetMs,
        agentVersion: h.agentVersion,
        nodeBuild: h.nodeBuild ?? '',
        reportedAt: h.reportedAt.toISOString(),
      })),
    });
  })
);

export default router;
