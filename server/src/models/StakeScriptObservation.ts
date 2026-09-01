import mongoose, { Schema, type Document } from 'mongoose';

/**
 * One host's claim, at one chain height, that it can produce a given coinstake
 * payout script.
 *
 * Block host-attribution used to be a read-time join against
 * `HostStatus.stakeScripts`, which every agent post overwrites -- so the same
 * immutable coinstake resolved to a different host depending on when
 * finalize/verify ran, and a re-finalize could throw an unrecoverable
 * REPORT_CONFLICT. This is the immutable, window-scoped half of that fact, the
 * same shape `PeerObservation` is for block and ChainLock sightings: keyed by
 * (height, host), append-only, and never corrected on the way in. A measured
 * height window always reads the same rows, so the attribution -- and the
 * fingerprint it feeds -- answers the same a year later.
 *
 * "Absence is not evidence": a script no host reported inside a window is left
 * unattributed, never assigned to whoever happened to have posted last.
 */
export interface StakeScriptObservationDocument extends Document {
  /** `${host}:${script}:${height}` -- one row per host per script per report height, replay-safe. */
  observationKey: string;

  /** Operator-facing label, not an address: the host list is not public. */
  host: string;
  /** Lowercased coinstake payout script (pay-to-pubkey) this host can produce. */
  script: string;
  /** The host's own chain height when it reported holding the script. */
  height: number;

  /** The host's own clock when it took the reading. */
  observedAt: Date;
  /** When the explorer accepted it, for spotting a delayed or replayed push. */
  ingestedAt: Date;
}

const stakeScriptObservationSchema = new Schema<StakeScriptObservationDocument>({
  observationKey: { type: String, required: true, unique: true },

  host: { type: String, required: true, index: true },
  script: { type: String, required: true },
  height: { type: Number, required: true },

  observedAt: { type: Date, required: true },
  ingestedAt: { type: Date, default: () => new Date() },
});

// Attribution reads every host's sighting of the scripts inside a height window.
stakeScriptObservationSchema.index({ height: 1, script: 1 });

// No TTL. Retention is at least 90 days by policy, and a concentration question
// is exactly the thing someone wants to re-examine months later.

export const StakeScriptObservation = mongoose.model<StakeScriptObservationDocument>(
  'StakeScriptObservation',
  stakeScriptObservationSchema
);
