import mongoose, { Schema, type Document } from 'mongoose';

/**
 * One deliberate experiment on this devnet, from hypothesis to outcome.
 *
 * Without this the explorer is a status page: it says what the network is doing
 * but not what was done to it, so a result cannot be reproduced or compared. A
 * measurement that cannot be repeated is an anecdote.
 *
 * What the run *declares* is written once and frozen -- the code under test,
 * the profile parameters, who took part, what was done to them, and what was
 * expected. What the run *found* is derived from the underlying rounds and
 * events and can be recomputed at any time; it is snapshotted at close only so
 * a published result stays quotable, never so that it becomes the only copy.
 */
/**
 * One quorum type's share of a run.
 *
 * Kept separate rather than folded into the totals because the profiles do not
 * run at the same rate: llmq_50_60 closes a round every 24 blocks and
 * llmq_400_60 every 72, so a single blended figure is dominated by whichever
 * type is most frequent and hides which one actually degraded. The revive run
 * is the case in point -- llmq_400_60 stayed at health 1.00 throughout while
 * llmq_50_60 fell to 0.16.
 */
export interface ProfileOutcome {
  llmqName: string;
  dkgInterval: number;
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;
  /** Members marked invalid in this profile's rounds, distinct. */
  membersPunished: number;
}

export interface ExperimentOutcome {
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  /** Excludes pending: a round still inside its window has not failed. */
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;

  banEvents: number;
  revivalEvents: number;
  penaltyIncreases: number;
  /** Masternodes distinct across all recorded punishments in the window. */
  masternodesPunished: number;

  blocks: number;
  medianBlockIntervalSec: number | null;
  distinctStakers: number;

  chainLockedBlocks: number;
  chainLockCoverage: number | null;

  /**
   * The same window seen per quorum type. Absent on outcomes snapshotted
   * before the collector tracked more than one profile -- those runs measured
   * a single type and cannot be broken down after the fact.
   */
  byProfile?: ProfileOutcome[];
}

export interface ExperimentRunDocument extends Document {
  runKey: string;
  title: string;
  hypothesis: string;
  /** What the run was expected to show, recorded before it ran. */
  expected: string;

  status: 'running' | 'closed';

  startedAt: Date;
  endedAt: Date | null;
  startHeight: number;
  endHeight: number | null;

  // What the code and the rules were. A profile change between two runs is the
  // most important thing a comparison can be wrong about.
  nodeVersion: string;
  nodeGitSha: string | null;
  llmqName: string;
  llmqSize: number;
  llmqMinSize: number;
  llmqThreshold: number;
  dkgInterval: number;

  participants: {
    masternodes: number;
    hosts: number;
    stakers: number;
  };

  /**
   * What was deliberately done. `kind` is free text on purpose: the useful
   * vocabulary is not known in advance, and an enum would push the next kind of
   * experiment into "other".
   */
  intervention: {
    kind: string;
    description: string;
    /** proTxHashes, host labels, or whatever identifies what was touched. */
    targets: string[];
  } | null;

  /** Another run to compare against; null for a baseline run itself. */
  baselineRunKey: string | null;

  /** Frozen at close. Recomputable from rounds and events at any time. */
  outcome: ExperimentOutcome | null;

  notes: string | null;
}

const outcomeSchema = new Schema<ExperimentOutcome>(
  {
    rounds: {
      formed: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      // A round whose profile needed more members than the network had. Counted
      // apart from failures so it cannot depress a formation rate.
      impossible: { type: Number, default: 0 },
    },
    formationRate: { type: Number, default: null },
    medianHealthRatio: { type: Number, default: null },
    worstHealthRatio: { type: Number, default: null },
    longestFailureStreak: { type: Number, default: 0 },

    banEvents: { type: Number, default: 0 },
    revivalEvents: { type: Number, default: 0 },
    penaltyIncreases: { type: Number, default: 0 },
    masternodesPunished: { type: Number, default: 0 },

    blocks: { type: Number, default: 0 },
    medianBlockIntervalSec: { type: Number, default: null },
    distinctStakers: { type: Number, default: 0 },

    chainLockedBlocks: { type: Number, default: 0 },
    chainLockCoverage: { type: Number, default: null },

    byProfile: {
      type: [
        new Schema<ProfileOutcome>(
          {
            llmqName: { type: String, required: true },
            dkgInterval: { type: Number, required: true },
            rounds: {
              formed: { type: Number, default: 0 },
              failed: { type: Number, default: 0 },
              pending: { type: Number, default: 0 },
              impossible: { type: Number, default: 0 },
            },
            formationRate: { type: Number, default: null },
            medianHealthRatio: { type: Number, default: null },
            worstHealthRatio: { type: Number, default: null },
            longestFailureStreak: { type: Number, default: 0 },
            membersPunished: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: undefined,
    },
  },
  { _id: false }
);

const experimentRunSchema = new Schema<ExperimentRunDocument>(
  {
    runKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    hypothesis: { type: String, default: '' },
    expected: { type: String, default: '' },

    status: { type: String, enum: ['running', 'closed'], default: 'running', index: true },

    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },
    startHeight: { type: Number, required: true, index: true },
    endHeight: { type: Number, default: null },

    nodeVersion: { type: String, default: 'unknown' },
    nodeGitSha: { type: String, default: null },
    llmqName: { type: String, required: true },
    llmqSize: { type: Number, required: true },
    llmqMinSize: { type: Number, required: true },
    llmqThreshold: { type: Number, required: true },
    dkgInterval: { type: Number, required: true },

    participants: {
      masternodes: { type: Number, default: 0 },
      hosts: { type: Number, default: 0 },
      stakers: { type: Number, default: 0 },
    },

    intervention: {
      type: new Schema(
        {
          kind: { type: String, required: true },
          description: { type: String, default: '' },
          targets: [{ type: String }],
        },
        { _id: false }
      ),
      default: null,
    },

    baselineRunKey: { type: String, default: null },
    outcome: { type: outcomeSchema, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// No TTL: an experiment record outliving the data it describes is the point.

export const ExperimentRun = mongoose.model<ExperimentRunDocument>(
  'ExperimentRun',
  experimentRunSchema
);
