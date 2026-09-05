import type { RoundMemberView } from '@devnet-deftrack/shared';

/**
 * A round's members, grouped the way the question is actually asked.
 *
 * The list the server sends is in quorum-member order, which answers nothing a
 * reader wants: the question is always "whose nodes failed in this round", and
 * this project attributes failures to operators. Sixty rows in member order
 * make that a counting exercise; grouped, the answer is the first line.
 *
 * Unattributed members sort last whatever their count. They are the ones no
 * operator has claimed -- a gap in the attribution table, not an operator with
 * a bad night, and putting them at the top would read as the latter.
 */
export interface OperatorGroup {
  /** null when no operator has claimed these nodes. */
  operatorLabel: string | null;
  members: RoundMemberView[];
  /** Members this round marked invalid: what the group is sorted on. */
  invalid: number;
  total: number;
}

export function groupByOperator(members: RoundMemberView[]): OperatorGroup[] {
  const groups = new Map<string, OperatorGroup>();

  for (const member of members) {
    const key = member.operatorLabel ?? '\u0000unattributed';
    let group = groups.get(key);
    if (!group) {
      group = { operatorLabel: member.operatorLabel, members: [], invalid: 0, total: 0 };
      groups.set(key, group);
    }
    group.members.push(member);
    group.total += 1;
    if (!member.valid) group.invalid += 1;
  }

  for (const group of groups.values()) {
    // Inside a group the invalid members come first: that is what the reader
    // opened the group for.
    group.members.sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? 1 : -1;
      return (a.service ?? a.proTxHash).localeCompare(b.service ?? b.proTxHash);
    });
  }

  return [...groups.values()].sort((a, b) => {
    if ((a.operatorLabel === null) !== (b.operatorLabel === null)) {
      return a.operatorLabel === null ? 1 : -1;
    }
    if (a.invalid !== b.invalid) return b.invalid - a.invalid;
    if (a.total !== b.total) return b.total - a.total;
    return (a.operatorLabel ?? '').localeCompare(b.operatorLabel ?? '');
  });
}
