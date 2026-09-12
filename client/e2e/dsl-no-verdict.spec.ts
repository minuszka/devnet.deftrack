import { expect, ok, test, type ApiStubs } from './harness.js';
import { shellStubs } from './fixtures/stubs.js';

/**
 * The Sentinel page must not call an unjudged masternode healthy.
 *
 * The collector and the table already keep "missed" and "no verdict" apart.
 * What this covers is the part of the page a reader takes in without reading:
 * the headline figures and the colour strip. A page that counts missed bits in
 * a tile but leaves the unjudged out of the tiles entirely still answers "how
 * did the network do" with the old, flattering number, and a strip that paints
 * an epoch with unjudged members the same green as a fully vouched one makes
 * the same claim in colour that version 1 of the format made in bits.
 *
 * The rows here are the three kinds a reader will meet: an epoch with members
 * nobody judged, a fully judged one, and a row whose second bitfield has not
 * been read back -- which must never render as a number.
 */
function epochRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    epoch: 500,
    boundaryHeight: 12768,
    status: 'committed',
    txid: 'aa'.repeat(32),
    epochBlockHash: 'bb'.repeat(32),
    quorumHash: 'cc'.repeat(32),
    missedCount: 3,
    listSize: 152,
    missedIndices: [1, 2, 3],
    missedProTxHashes: [],
    commitmentVersion: 2,
    observedCount: 150,
    unobservedIndices: [9, 10],
    unobservedProTxHashes: [],
    detectedAt: '2026-09-13T12:00:00.000Z',
    ...over,
  };
}

const UNREAD = epochRow({
  epoch: 502,
  boundaryHeight: 12816,
  commitmentVersion: null,
  observedCount: null,
  unobservedIndices: [],
});
const WITH_NONE_JUDGED = epochRow({ epoch: 501, boundaryHeight: 12792 });
const FULLY_JUDGED = epochRow({
  epoch: 400,
  boundaryHeight: 12000,
  commitmentVersion: 1,
  observedCount: 152,
  unobservedIndices: [],
  missedCount: 0,
  missedIndices: [],
});

function dslStubs(): ApiStubs {
  const items = [UNREAD, WITH_NONE_JUDGED, FULLY_JUDGED];
  return {
    ...shellStubs(),
    '/api/v1/dsl/summary': {
      body: ok({
        activationHeight: 5472,
        epochInterval: 24,
        firstCommittableBoundary: 5496,
        enforcement: { height: 8304, active: true },
        epochsJudged: 3,
        committed: 3,
        absent: 0,
        convergenceRate: 1,
        totalMissedBits: 6,
        totalUnobservedBits: 2,
        unobservedBitsFromEpochs: 2,
        latest: { epoch: 502, boundaryHeight: 12816, status: 'committed', missedCount: 3 },
      }),
    },
    '/api/v1/dsl/epochs': { body: ok({ items, total: items.length, limit: 50, offset: 0 }) },
  };
}

test.describe('the Sentinel page and the unjudged', () => {
  test('puts the unjudged in the headline, with the epochs it was read from', async ({ app, page }) => {
    app.stub(dslStubs());
    await app.goto('/dsl');

    const tiles = page.locator('dd-stat');
    await expect(tiles.filter({ hasText: 'Missed bits' })).toContainText('6');
    // The number version 1 could not express, beside the missed count rather
    // than folded into it -- and never without saying how many epochs it covers.
    const noVerdict = tiles.filter({ hasText: 'No verdict' });
    await expect(noVerdict).toContainText('2');
    await expect(noVerdict).toContainText('2 epochs read');
  });

  test('colours an epoch with unjudged members apart from a healthy one', async ({ app, page }) => {
    app.stub(dslStubs());
    await app.goto('/dsl');

    // The strip draws oldest-first: fully judged, then unjudged, then unread.
    const bars = page.locator('svg rect');
    await expect(bars).toHaveCount(3);
    await expect(bars.nth(0)).toHaveAttribute('fill', 'var(--accent)');
    await expect(bars.nth(1)).toHaveAttribute('fill', 'var(--info)');
    // A row nobody has read back is unknown, and unknown is not healthy.
    await expect(bars.nth(2)).toHaveAttribute('fill', 'var(--info)');
    await expect(page.locator('.legend')).toContainText('some with no verdict');
  });

  test('says what the distinction means, in the page and in the row', async ({ app, page }) => {
    app.stub(dslStubs());
    await app.goto('/dsl');

    await expect(page.locator('.caveat').first()).toContainText('silence read as a clean bill of health');

    const rows = page.locator('tbody tr');
    await expect(rows.nth(0)).toContainText('not read');
    await expect(rows.nth(1)).toContainText('3 / 152');
    await expect(rows.nth(1)).toContainText('2');
    await expect(rows.nth(2)).toContainText('0 / 152');
  });
});
