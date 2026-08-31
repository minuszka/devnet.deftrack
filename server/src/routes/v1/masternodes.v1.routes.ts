import { Router } from 'express';
import { z } from 'zod';
import { MasternodeState } from '../../models/MasternodeState.js';
import { MasternodeEvent } from '../../models/MasternodeEvent.js';
import { MasternodeSnapshot } from '../../models/MasternodeSnapshot.js';
import { Block } from '../../models/Block.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { asyncRoute, page, parsedQuery, sendData, validateQuery } from '../../utils/http.js';

const router = Router();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  banned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  hostIp: z.string().min(1).max(64).optional(),
  operatorLabel: z.string().min(1).max(64).optional(),
});
const hoursQuery = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 90).default(24),
});
const eventsQuery = hoursQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  type: z
    .enum([
      'registered',
      'banned',
      'revived',
      'penalty_up',
      'penalty_down',
      'service_changed',
      'removed',
      'key_changed',
      'revoked',
    ])
    .optional(),
});
/** Bans this far apart belong to different waves. */
const waveQuery = hoursQuery.extend({
  gapMinutes: z.coerce.number().int().min(1).max(720).default(30),
});

/** GET /api/v1/masternodes */
router.get(
  '/',
  withCachePolicy('short'),
  validateQuery(listQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof listQuery>>(res);
    // Rows dropped from `protx list registered` are kept for history but are
    // not part of "what the network looks like now".
    const filter: Record<string, unknown> = { active: { $ne: false } };
    if (q.banned !== undefined) filter.banned = q.banned;
    if (q.hostIp) filter.hostIp = q.hostIp;
    if (q.operatorLabel) filter.operatorLabel = q.operatorLabel;

    const [rows, total] = await Promise.all([
      MasternodeState.find(filter)
        .sort({ banned: -1, poSePenalty: -1, registeredHeight: 1 })
        .skip(q.offset)
        .limit(q.limit)
        .select(
          'proTxHash service hostIp operatorLabel banned poSePenalty poSeBanHeight poSeRevivedHeight ' +
            'missedServiceEpochs rewardSuspended dslBanHeight registeredHeight lastPaidHeight payoutAddress lastSeenAt'
        )
        .lean(),
      MasternodeState.countDocuments(filter),
    ]);

    sendData(
      res,
      page(
        rows.map((m) => ({
          proTxHash: m.proTxHash,
          service: m.service,
          hostIp: m.hostIp,
          operatorLabel: m.operatorLabel,
          banned: m.banned,
          poSePenalty: m.poSePenalty,
          poSeBanHeight: m.poSeBanHeight,
          poSeRevivedHeight: m.poSeRevivedHeight,
          missedServiceEpochs: m.missedServiceEpochs ?? 0,
          rewardSuspended: m.rewardSuspended ?? false,
          dslBanHeight: m.dslBanHeight ?? -1,
          registeredHeight: m.registeredHeight,
          lastPaidHeight: m.lastPaidHeight,
          payoutAddress: m.payoutAddress,
          lastSeenAt: m.lastSeenAt,
        })),
        total,
        q.limit,
        q.offset
      )
    );
  })
);

/** GET /api/v1/masternodes/timeline -- the count series behind the chart. */
router.get(
  '/timeline',
  withCachePolicy('short'),
  validateQuery(hoursQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof hoursQuery>>(res);
    const since = new Date(Date.now() - q.hours * 3600_000);
    const points = await MasternodeSnapshot.find({ at: { $gte: since } })
      .sort({ at: 1 })
      .select('at height total enabled banned penalised penaltyMax effectiveQuorumSize maxPossibleBan')
      .lean();

    sendData(res, {
      hours: q.hours,
      points: points.map((p) => ({
        at: p.at.toISOString(),
        height: p.height,
        total: p.total,
        enabled: p.enabled,
        banned: p.banned,
        penalised: p.penalised,
        penaltyMax: p.penaltyMax,
        effectiveQuorumSize: p.effectiveQuorumSize,
        maxPossibleBan: p.maxPossibleBan,
      })),
    });
  })
);

/** GET /api/v1/masternodes/events */
router.get(
  '/events',
  withCachePolicy('short'),
  validateQuery(eventsQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof eventsQuery>>(res);
    const filter: Record<string, unknown> = { detectedAt: { $gte: new Date(Date.now() - q.hours * 3600_000) } };
    if (q.type) filter.type = q.type;

    const [rows, total] = await Promise.all([
      MasternodeEvent.find(filter)
        .sort({ detectedAt: -1, _id: -1 })
        .skip(q.offset)
        .limit(q.limit)
        .select(
          'eventKey proTxHash type height penaltyBefore penaltyAfter serviceBefore serviceAfter hostIp operatorLabel detectedAt'
        )
        .lean(),
      MasternodeEvent.countDocuments(filter),
    ]);

    sendData(
      res,
      page(
        rows.map((e) => ({
          eventKey: e.eventKey,
          proTxHash: e.proTxHash,
          type: e.type,
          height: e.height,
          penaltyBefore: e.penaltyBefore,
          penaltyAfter: e.penaltyAfter,
          serviceBefore: e.serviceBefore,
          serviceAfter: e.serviceAfter,
          hostIp: e.hostIp,
          operatorLabel: e.operatorLabel,
          detectedAt: e.detectedAt.toISOString(),
        })),
        total,
        q.limit,
        q.offset
      )
    );
  })
);

/**
 * GET /api/v1/masternodes/ban-waves
 *
 * The headline number of the whole project: how many masternodes a single
 * episode actually took down, next to how many the profile structurally
 * allows. On mainnet the largest measured wave was 145 against a ceiling of
 * 146 -- the point of Q60 is to move the ceiling, so the ceiling is reported
 * with every wave rather than left implicit.
 */
router.get(
  '/ban-waves',
  withCachePolicy('medium'),
  validateQuery(waveQuery),
  asyncRoute(async (_req, res) => {
    const q = parsedQuery<z.infer<typeof waveQuery>>(res);
    const since = new Date(Date.now() - q.hours * 3600_000);

    const [bansByDetection, snapshots] = await Promise.all([
      MasternodeEvent.find({ type: 'banned', detectedAt: { $gte: since } })
        .sort({ detectedAt: 1 })
        .select('detectedAt height hostIp operatorLabel')
        .lean(),
      MasternodeSnapshot.find({ at: { $gte: since } })
        .sort({ at: 1 })
        .select('at maxPossibleBan')
        .lean(),
    ]);

    // Chain time, not observation time: a backfilled hour of history lands in
    // Mongo in seconds, and grouped by detection it would read as one giant
    // wave happening now. Each ban is dated by its block's own timestamp; the
    // detection time stays on the event for the observation story. Fetching by
    // detectedAt is a superset (observation never precedes occurrence), and
    // the chain-time filter below cuts it to the asked-for window.
    const heights = [...new Set(bansByDetection.map((b) => b.height))];
    const heightBlocks = await Block.find({ height: { $in: heights } })
      .select('height time')
      .lean();
    const chainTime = new Map(heightBlocks.map((b) => [b.height, new Date(b.time * 1000)]));
    const bans = bansByDetection
      .map((b) => ({ ...b, occurredAt: chainTime.get(b.height) ?? b.detectedAt }))
      .filter((b) => b.occurredAt.getTime() >= since.getTime())
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const gapMs = q.gapMinutes * 60_000;
    type Wave = {
      startedAt: Date;
      endedAt: Date;
      size: number;
      heights: number[];
      byHost: Record<string, number>;
      byOperator: Record<string, number>;
    };
    const waves: Wave[] = [];

    for (const ban of bans) {
      const last = waves.at(-1);
      if (last && ban.occurredAt.getTime() - last.endedAt.getTime() <= gapMs) {
        last.endedAt = ban.occurredAt;
        last.size++;
        last.heights.push(ban.height);
      } else {
        waves.push({
          startedAt: ban.occurredAt,
          endedAt: ban.occurredAt,
          size: 1,
          heights: [ban.height],
          byHost: {},
          byOperator: {},
        });
      }
      const w = waves.at(-1)!;
      const host = ban.hostIp ?? '(unknown)';
      const op = ban.operatorLabel ?? '(unattributed)';
      w.byHost[host] = (w.byHost[host] ?? 0) + 1;
      w.byOperator[op] = (w.byOperator[op] ?? 0) + 1;
    }

    // The ceiling in force when the wave began, not the one in force now.
    const ceilingAt = (t: Date): number | null => {
      let best: number | null = null;
      for (const s of snapshots) {
        if (s.at.getTime() <= t.getTime()) best = s.maxPossibleBan;
        else break;
      }
      return best;
    };

    const rows = waves
      .map((w) => ({
        startedAt: w.startedAt.toISOString(),
        endedAt: w.endedAt.toISOString(),
        durationMinutes: Math.round((w.endedAt.getTime() - w.startedAt.getTime()) / 60_000),
        size: w.size,
        maxPossibleBanAtStart: ceilingAt(w.startedAt),
        firstHeight: Math.min(...w.heights),
        lastHeight: Math.max(...w.heights),
        byHost: Object.entries(w.byHost).map(([hostIp, count]) => ({ hostIp, count })).sort((a, b) => b.count - a.count),
        byOperator: Object.entries(w.byOperator).map(([operatorLabel, count]) => ({ operatorLabel, count })).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.size - a.size);

    sendData(res, {
      hours: q.hours,
      gapMinutes: q.gapMinutes,
      waves: rows,
      largestWave: rows[0]?.size ?? 0,
      totalBans: bans.length,
    });
  })
);

export default router;
