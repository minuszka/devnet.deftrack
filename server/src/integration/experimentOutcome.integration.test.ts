import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { ServiceEpoch } from '../models/ServiceEpoch.js';
import { computeOutcome } from '../services/experiment.service.js';

/**
 * The outcome's Sentinel epoch counts, over a real database.
 *
 * `computeOutcome` is a set of queries, and the one added here is a range on
 * `boundaryHeight` with counting by `status`. Both halves are things a fake
 * cannot get wrong for us: whether the range is inclusive at both ends, and
 * whether an absent row -- which has no missedCount -- is counted as judged.
 * The absent-epoch run of 2026-09-07 closed without this number in its frozen
 * outcome at all; this is the regression test for its existence and its edges.
 */
const suite = HAVE_MONGO ? describe : describe.skip;
if (!HAVE_MONGO) console.warn(`skipping experimentOutcome integration: ${NO_MONGO_REASON}`);

suite('the Sentinel epoch counts in an experiment outcome', () => {
  beforeAll(async () => {
    await connectTestMongo('expout');
    await syncIndexes([ServiceEpoch]);
  });
  afterAll(async () => {
    await dropTestMongo();
  });

  const row = (epoch: number, boundaryHeight: number, status: 'committed' | 'absent', missedCount: number | null) => ({
    epochKey: `dsl:${epoch}`,
    epoch,
    boundaryHeight,
    boundaryBlockHash: `b${boundaryHeight}`,
    status,
    missedCount,
  });

  it('counts committed and absent epochs whose boundary is inside the window, inclusive, and sums missed bits', async () => {
    await ServiceEpoch.create([
      row(1, 96, 'absent', null), // below the window
      row(2, 100, 'committed', 0), // on the lower edge: inside
      row(3, 124, 'committed', 3),
      row(4, 148, 'absent', null),
      row(5, 172, 'committed', 2), // on the upper edge: inside
      row(6, 196, 'committed', 9), // above the window
    ]);

    const outcome = await computeOutcome({ startHeight: 100, endHeight: 172 }, 300);

    expect(outcome.dsl).toEqual({
      epochs: 4,
      committed: 3,
      absent: 1,
      missedBits: 5,
      convergenceRate: 0.75,
    });
  });

  it('is null, not a zeroed object, when the window judged no epoch', async () => {
    const outcome = await computeOutcome({ startHeight: 500, endHeight: 600 }, 700);
    expect(outcome.dsl).toBeNull();
  });

  it('follows the tip when the run has no end height yet', async () => {
    // Rows from the first case are still there; the window 140..tip(172)
    // holds the absent epoch at 148 and the committed one at 172.
    const outcome = await computeOutcome({ startHeight: 140, endHeight: null }, 172);
    expect(outcome.dsl).toEqual({ epochs: 2, committed: 1, absent: 1, missedBits: 2, convergenceRate: 0.5 });
  });
});
