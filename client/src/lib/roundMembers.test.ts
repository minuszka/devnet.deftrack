import { describe, expect, it } from 'vitest';
import type { RoundMemberView } from '@devnet-deftrack/shared';
import { groupByOperator } from './roundMembers.js';

function member(
  proTxHash: string,
  operatorLabel: string | null,
  valid: boolean,
  service: string | null = null
): RoundMemberView {
  return { proTxHash, operatorLabel, valid, service };
}

describe('groupByOperator', () => {
  it('counts each operator once, valid and invalid apart', () => {
    const groups = groupByOperator([
      member('a', 'op-one', true),
      member('b', 'op-one', false),
      member('c', 'op-two', true),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ operatorLabel: 'op-one', invalid: 1, total: 2 });
    expect(groups[1]).toMatchObject({ operatorLabel: 'op-two', invalid: 0, total: 1 });
  });

  // The whole point of the grouping: who failed, first.
  it('puts the operator with the most failures first, not the largest one', () => {
    const groups = groupByOperator([
      member('a', 'big', true),
      member('b', 'big', true),
      member('c', 'big', true),
      member('d', 'small', false),
    ]);

    expect(groups.map((g) => g.operatorLabel)).toEqual(['small', 'big']);
  });

  it('sorts unattributed members last however many failed', () => {
    const groups = groupByOperator([
      member('a', null, false),
      member('b', null, false),
      member('c', 'op-one', false),
    ]);

    expect(groups.map((g) => g.operatorLabel)).toEqual(['op-one', null]);
    expect(groups[1]).toMatchObject({ invalid: 2, total: 2 });
  });

  it('lists the failed members of a group before the ones that were fine', () => {
    const groups = groupByOperator([
      member('a', 'op-one', true, 'host-a:19799'),
      member('b', 'op-one', false, 'host-b:19800'),
      member('c', 'op-one', false, 'host-a:19801'),
    ]);

    expect(groups[0]!.members.map((m) => m.proTxHash)).toEqual(['c', 'b', 'a']);
  });

  it('is stable in size: every member lands in exactly one group', () => {
    const members = Array.from({ length: 60 }, (_, i) =>
      member(`p${i}`, i % 7 === 0 ? null : `op-${i % 5}`, i % 3 !== 0)
    );
    const groups = groupByOperator(members);
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(60);
    expect(groups.reduce((n, g) => n + g.invalid, 0)).toBe(members.filter((m) => !m.valid).length);
  });

  it('answers an empty round with no groups', () => {
    expect(groupByOperator([])).toEqual([]);
  });
});
