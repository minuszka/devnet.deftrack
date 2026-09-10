import { describe, expect, it } from 'vitest';
import { mainnetRelevantStats, type MainnetRelevantRound } from './mainnetRelevant.js';

const round = (
  llmqName: string,
  status: MainnetRelevantRound['status'],
  healthRatio: number | null = null,
  invalidMembers: string[] = []
): MainnetRelevantRound => ({ llmqName, status, healthRatio, invalidMembers });

// The devnet's four punishing profiles against the two v23 mainnet forms.
const mainnet = (name: string): boolean => name === 'llmq_defcon' || name === 'llmq_400_60';

describe('counting a window as the v23 mainnet would', () => {
  it('holds out the devnet-only profiles, punishments included', () => {
    // The 2026-09-10 roll in miniature: every punished member sat in a
    // llmq_50_60 round. Counted the devnet's way that is three punished;
    // counted mainnet's way it is none, and the formation rate and health are
    // those of the profiles mainnet actually forms.
    const rounds: MainnetRelevantRound[] = [
      round('llmq_50_60', 'formed', 0.94, ['a', 'b', 'c']),
      round('llmq_defcon', 'failed'),
      round('llmq_400_60', 'formed', 1.0),
      round('llmq_60_75', 'formed', 0.98, ['a']),
      round('llmq_defcon', 'formed', 1.0),
      round('llmq_400_85', 'impossible'),
    ];
    const s = mainnetRelevantStats(rounds, mainnet);
    expect(s.profiles).toEqual(['llmq_400_60', 'llmq_defcon']);
    expect(s.rounds).toEqual({ formed: 2, failed: 1, pending: 0, impossible: 0 });
    expect(s.formationRate).toBeCloseTo(2 / 3, 6);
    expect(s.medianHealthRatio).toBe(1.0);
    expect(s.worstHealthRatio).toBe(1.0);
    expect(s.membersPunished).toBe(0);
  });

  it('takes the streak per profile, never across the interleaved schedules', () => {
    // Two profiles each fail once in a row: no type ever had a streak of two.
    const rounds: MainnetRelevantRound[] = [
      round('llmq_defcon', 'failed'),
      round('llmq_400_60', 'failed'),
      round('llmq_defcon', 'formed', 1.0),
      round('llmq_400_60', 'formed', 1.0),
    ];
    expect(mainnetRelevantStats(rounds, mainnet).longestFailureStreak).toBe(1);

    const twice: MainnetRelevantRound[] = [
      round('llmq_defcon', 'failed'),
      round('llmq_400_60', 'formed', 1.0),
      round('llmq_defcon', 'failed'),
    ];
    expect(mainnetRelevantStats(twice, mainnet).longestFailureStreak).toBe(2);
  });

  it('counts distinct members across the counted profiles only', () => {
    const rounds: MainnetRelevantRound[] = [
      round('llmq_defcon', 'formed', 0.95, ['x', 'y']),
      round('llmq_400_60', 'formed', 0.99, ['y', 'z']),
      round('llmq_50_60', 'formed', 0.9, ['q']),
    ];
    expect(mainnetRelevantStats(rounds, mainnet).membersPunished).toBe(3);
  });

  it('says nothing was counted rather than inventing a rate', () => {
    const s = mainnetRelevantStats([round('llmq_50_60', 'formed', 1.0)], mainnet);
    expect(s.profiles).toEqual([]);
    expect(s.rounds).toEqual({ formed: 0, failed: 0, pending: 0, impossible: 0 });
    expect(s.formationRate).toBeNull();
    expect(s.medianHealthRatio).toBeNull();
    expect(s.membersPunished).toBe(0);
  });

  it('never widens on a name the predicate does not know', () => {
    const s = mainnetRelevantStats([round('llmq_typo', 'failed')], mainnet);
    expect(s.profiles).toEqual([]);
    expect(s.rounds.failed).toBe(0);
  });
});
