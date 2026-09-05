/**
 * Which rounds were measured while somebody was standing in the network.
 *
 * This project's own notes carry the rule and the incident behind it: reviving
 * 46 masternodes at height 2404 put them straight into the next `llmq_50_60`
 * round, before their DKG mesh had re-formed. That round closed at health 0.16
 * with 42 members punished. Nothing was wrong with the network -- the
 * measurement was taken while it was still re-connecting.
 *
 * A row that reports such a round as the profile's worst on record is telling
 * the truth about the number and a lie about the network, and the reader has no
 * way to know. So the rounds that fall inside a declared experiment window, or
 * inside the settling period after a revive, say so on the row.
 *
 * The round document's own `membershipChurn` answers a narrower question --
 * whether *this* round's punishment fell entirely on members that had just
 * joined -- and it is measured rather than declared. Both are worth showing:
 * churn catches an intervention nobody wrote down, and these badges catch an
 * intervention whose effect has not shown up in the membership yet.
 */

export interface InterventionRun {
  runKey: string;
  title: string;
  startHeight: number;
  /** null while the run is still open: everything from startHeight is inside. */
  endHeight: number | null;
}

export interface InterventionBadge {
  kind: 'experiment' | 'revive';
  /** Two or three words for the row. */
  label: string;
  /** The full sentence, for the title attribute. */
  detail: string;
  /** Where the badge leads, when it leads anywhere. */
  href: string | null;
}

export interface InterventionInput {
  expectedHeight: number;
  /** Rounds of this profile are dkgInterval blocks apart. */
  dkgInterval: number;
}

export interface InterventionContext {
  runs: InterventionRun[];
  /** Heights at which a masternode was revived, in any order. */
  reviveHeights: number[];
  /**
   * How many rounds of the profile after a revive are treated as settling.
   * Two, because the mesh is re-formed over the DKG session that follows the
   * one the revived members were first drawn into.
   */
  roundsAfterRevive?: number;
}

export const DEFAULT_ROUNDS_AFTER_REVIVE = 2;

export function interventionsFor(
  round: InterventionInput,
  context: InterventionContext
): InterventionBadge[] {
  const badges: InterventionBadge[] = [];
  const height = round.expectedHeight;

  for (const run of context.runs) {
    if (height < run.startHeight) continue;
    if (run.endHeight !== null && height > run.endHeight) continue;
    badges.push({
      kind: 'experiment',
      label: 'experiment',
      detail:
        `This round is inside the window of "${run.title}" (${run.startHeight}–` +
        `${run.endHeight ?? 'open'}). Its figures describe the run, not the profile's baseline.`,
      href: `/experiments/${encodeURIComponent(run.runKey)}`,
    });
  }

  const settling = context.roundsAfterRevive ?? DEFAULT_ROUNDS_AFTER_REVIVE;
  const span = settling * round.dkgInterval;
  // The most recent revive at or before this round; earlier ones are covered by
  // it, and one badge per round is the point.
  const latest = context.reviveHeights
    .filter((h) => h <= height && height < h + span)
    .sort((a, b) => b - a)[0];

  if (latest !== undefined) {
    badges.push({
      kind: 'revive',
      label: 'after revive',
      detail:
        `A masternode was revived at height ${latest}, within ${settling} rounds of this one ` +
        '(interval ' +
        `${round.dkgInterval} blocks). A member drawn in before its DKG mesh has re-formed is ` +
        'voted bad by peers that never reached it, so this round’s health is not comparable ' +
        'with the rounds before it.',
      href: null,
    });
  }

  return badges;
}
