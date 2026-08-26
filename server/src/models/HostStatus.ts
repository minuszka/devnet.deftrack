import mongoose, { Schema, type Document } from 'mongoose';

/**
 * What one host could see of the network at a moment.
 *
 * A DKG that fails on a host with four peers and succeeds on one with thirty is
 * not the same finding twice. Without this the explorer can say a round failed
 * but never that a member was isolated when it did -- which is the difference
 * between blaming the protocol and blaming a machine.
 *
 * Overwritten per host: this is the current view. The history that matters is
 * already in PeerObservation and in the round record.
 */
export interface HostStatusDocument extends Document {
  host: string;

  peers: number;
  inbound: number;
  /** Peers authenticated as masternodes via MNAUTH -- the quorum mesh. */
  verifiedMasternodes: number;
  medianPingMs: number | null;
  maxPingWaitMs: number | null;
  /** The host's own chain height, for spotting one node left behind. */
  height: number | null;

  /**
   * Coinstake payout scripts this host can produce.
   *
   * A coinstake pays to the key of the output it spent, so one machine holding
   * five outputs under five keys shows up as five producers. Counting keys
   * overstates how distributed block production is, and understates
   * concentration -- the two numbers this devnet exists to measure.
   */
  stakeScripts: string[];
  /**
   * Fingerprint of the daemon binary this host is actually running.
   *
   * The version string cannot answer this -- two builds carrying different
   * consensus code report the same one, which is how eight hosts ran a binary
   * three days older than the seed's with nothing on any screen to say so.
   * Empty when the agent could not read the file: unknown, not guessed.
   */
  nodeBuild: string;

  clockOffsetMs: number | null;
  agentVersion: string;
  reportedAt: Date;
}

const hostStatusSchema = new Schema<HostStatusDocument>({
  host: { type: String, required: true, unique: true },

  peers: { type: Number, default: 0 },
  inbound: { type: Number, default: 0 },
  verifiedMasternodes: { type: Number, default: 0 },
  medianPingMs: { type: Number, default: null },
  maxPingWaitMs: { type: Number, default: null },
  height: { type: Number, default: null },

  stakeScripts: [{ type: String }],
  nodeBuild: { type: String, default: '' },

  clockOffsetMs: { type: Number, default: null },
  agentVersion: { type: String, default: 'unknown' },
  reportedAt: { type: Date, default: () => new Date(), index: true },
});

export const HostStatus = mongoose.model<HostStatusDocument>('HostStatus', hostStatusSchema);
