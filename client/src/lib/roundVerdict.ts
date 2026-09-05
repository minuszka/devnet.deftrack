/**
 * How one DKG round should read on the page.
 *
 * The single most important thing this site says is the difference between a
 * round that did not happen and a round that happened and punished people. The
 * tables said it backwards: a failed round was a red pill with a `0` beside it,
 * and a round that formed and punished twelve masternodes was a green pill with
 * a plain `12`. The incident was green and the non-event was red.
 *
 * Colour is not the fix on its own -- a reader who does not know the palette
 * still has to be told. So the punished column answers in words where a bare
 * number would mislead, and "formed" is never shown without saying what it did.
 */
export type RoundStatus = 'formed' | 'failed' | 'pending' | 'impossible';

export interface RoundVerdict {
  /** The pill's words. */
  label: string;
  /** Which pill class carries it. */
  tone: 'good' | 'warn' | 'muted' | 'accent';
  /** What the punished cell reads. Words, not a bare zero. */
  punished: string;
  /** True only when this round actually punished somebody. */
  incident: boolean;
}

export function roundVerdict(input: {
  status: RoundStatus;
  punishedCount: number;
}): RoundVerdict {
  if (input.status === 'formed') {
    return input.punishedCount > 0
      ? {
          label: `formed · punished ${input.punishedCount}`,
          tone: 'warn',
          punished: String(input.punishedCount),
          incident: true,
        }
      : { label: 'formed · clean', tone: 'good', punished: 'nobody', incident: false };
  }
  if (input.status === 'failed') {
    // A failed DKG mines no commitment, and the node's punishment loop is
    // guarded by a non-null commitment -- so nobody is punished. That is an
    // assertion about consensus, not a missing value, and it is the sentence
    // this site exists to be able to say.
    return { label: 'did not form', tone: 'muted', punished: 'nobody punished', incident: false };
  }
  if (input.status === 'impossible') {
    return {
      label: 'could not form',
      tone: 'muted',
      punished: 'nobody punished',
      incident: false,
    };
  }
  return { label: 'pending', tone: 'accent', punished: '—', incident: false };
}
