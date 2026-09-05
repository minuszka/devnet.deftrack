import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS_AFTER_REVIVE, interventionsFor } from './interventions.js';

const run = { runKey: 'run-1', title: 'Outage of five', startHeight: 7000, endHeight: 7100 };
const open = { runKey: 'run-2', title: 'Still running', startHeight: 7200, endHeight: null };

describe('interventionsFor', () => {
  it('marks a round inside a closed run window', () => {
    const badges = interventionsFor(
      { expectedHeight: 7050, dkgInterval: 24 },
      { runs: [run], reviveHeights: [] }
    );
    expect(badges.map((b) => b.kind)).toEqual(['experiment']);
    expect(badges[0]!.href).toBe('/experiments/run-1');
    expect(badges[0]!.detail).toContain('Outage of five');
  });

  it('leaves a round outside the window alone', () => {
    expect(
      interventionsFor({ expectedHeight: 6999, dkgInterval: 24 }, { runs: [run], reviveHeights: [] })
    ).toEqual([]);
    expect(
      interventionsFor({ expectedHeight: 7101, dkgInterval: 24 }, { runs: [run], reviveHeights: [] })
    ).toEqual([]);
  });

  it('treats an open run as covering everything from its start', () => {
    const badges = interventionsFor(
      { expectedHeight: 999_999, dkgInterval: 24 },
      { runs: [open], reviveHeights: [] }
    );
    expect(badges).toHaveLength(1);
  });

  // The incident the badge exists for: a revive at 2404 and the very next round
  // closing at health 0.16 with 42 members punished.
  it('marks the settling rounds after a revive, and only those', () => {
    const context = { runs: [], reviveHeights: [2404] };
    const inside = interventionsFor({ expectedHeight: 2424, dkgInterval: 24 }, context);
    expect(inside.map((b) => b.kind)).toEqual(['revive']);
    expect(inside[0]!.detail).toContain('2404');

    // Two rounds of 24 blocks: 2404..2451 inclusive, and 2452 is clear.
    expect(interventionsFor({ expectedHeight: 2451, dkgInterval: 24 }, context)).toHaveLength(1);
    expect(interventionsFor({ expectedHeight: 2452, dkgInterval: 24 }, context)).toHaveLength(0);
    expect(interventionsFor({ expectedHeight: 2403, dkgInterval: 24 }, context)).toHaveLength(0);
  });

  it('scales the settling span with the profile interval, not with blocks', () => {
    const context = { runs: [], reviveHeights: [7000] };
    // llmq_400_60 runs every 72 blocks, so two of its rounds are 144 blocks.
    expect(interventionsFor({ expectedHeight: 7143, dkgInterval: 72 }, context)).toHaveLength(1);
    expect(interventionsFor({ expectedHeight: 7144, dkgInterval: 72 }, context)).toHaveLength(0);
    // The same height is already clear for a 24-block profile.
    expect(interventionsFor({ expectedHeight: 7143, dkgInterval: 24 }, context)).toHaveLength(0);
  });

  it('shows one revive badge even when several revives overlap', () => {
    const badges = interventionsFor(
      { expectedHeight: 7010, dkgInterval: 24 },
      { runs: [], reviveHeights: [7000, 7005, 7008] }
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]!.detail).toContain('7008');
  });

  it('can carry both an experiment and a revive', () => {
    const badges = interventionsFor(
      { expectedHeight: 7050, dkgInterval: 24 },
      { runs: [run], reviveHeights: [7040] }
    );
    expect(badges.map((b) => b.kind)).toEqual(['experiment', 'revive']);
  });

  it('settles for two rounds unless told otherwise', () => {
    expect(DEFAULT_ROUNDS_AFTER_REVIVE).toBe(2);
    const context = { runs: [], reviveHeights: [7000], roundsAfterRevive: 1 };
    expect(interventionsFor({ expectedHeight: 7023, dkgInterval: 24 }, context)).toHaveLength(1);
    expect(interventionsFor({ expectedHeight: 7024, dkgInterval: 24 }, context)).toHaveLength(0);
  });
});
