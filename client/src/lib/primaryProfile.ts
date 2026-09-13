/**
 * Which LLMQ profile the overview's figures are about.
 *
 * The front page asked for the health timeline with no profile at all, and the
 * server only filters when given one -- so the formation rate, the median and
 * worst health, and the failure streak were computed across every schedule this
 * devnet runs at once: llmq_50_60 every 24 blocks, llmq_60_75 every 48,
 * llmq_400_60 every 72, llmq_400_85 every 576 (which can never form here), and
 * llmq_defcon. Blending interleaved schedules invents streaks no type ever had,
 * which is the one reading this project's own notes single out as forbidden.
 *
 * The profile that matters is the one signing ChainLocks at the tip, and the
 * switchover is height-gated and one-way, so it is decidable from data the page
 * already has.
 */
export interface ChainLockSigners {
  v1: string;
  v2: string;
  activationHeight: number;
}

export type PrimaryProfile =
  | { known: true; llmqName: string; reason: 'before-activation' | 'after-activation' }
  /**
   * Not resolvable. The page says so and shows no blended figure: a number
   * covering five schedules is worse than no number, because it looks like an
   * answer.
   */
  | { known: false; reason: 'no-signers' | 'no-tip' };

export function primaryProfile(input: {
  signers: ChainLockSigners | null | undefined;
  tipHeight: number | null | undefined;
}): PrimaryProfile {
  const { signers, tipHeight } = input;
  if (!signers) return { known: false, reason: 'no-signers' };
  if (typeof tipHeight !== 'number' || !Number.isFinite(tipHeight)) {
    return { known: false, reason: 'no-tip' };
  }
  return tipHeight >= signers.activationHeight
    ? { known: true, llmqName: signers.v2, reason: 'after-activation' }
    : { known: true, llmqName: signers.v1, reason: 'before-activation' };
}

/** What went wrong reading the two inputs, when a read failed rather than came back empty. */
export interface ProfileReadFailures {
  signers?: string;
  tip?: string;
}

/**
 * Why the profile is unknown, in words that keep "absent" and "unreadable" apart.
 *
 * Both pages that resolve the profile swallowed a failed read into null, so a
 * ChainLock report that answered 500 was described as "no ChainLock report" --
 * a claim about the chain, made from a failed request. Found by the day-20
 * regression sweep.
 */
export function profileUnknownReason(
  profile: Extract<PrimaryProfile, { known: false }>,
  failures: ProfileReadFailures
): string {
  if (profile.reason === 'no-signers') {
    return failures.signers ? `the ChainLock report could not be read: ${failures.signers}` : 'no ChainLock report';
  }
  return failures.tip ? `the chain tip could not be read: ${failures.tip}` : 'no chain tip';
}
