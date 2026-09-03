import type { FilterQuery, UpdateQuery } from 'mongoose';
import {
  SimulationAction,
  type SimulationActionDocument,
  type SimulationActionResult,
} from '../models/SimulationAction.js';
import {
  claimActionUpdate,
  claimableActionFilter,
  expireOverdueFilter,
  expireOverdueUpdate,
  renewLeaseFilter,
  renewLeaseUpdate,
  settleActionFilter,
  settleActionUpdate,
  type SettledActionStatus,
} from '../domain/actionLease.js';

/**
 * A leased view of one action, as a worker needs to act on it. The full document
 * is never handed out -- only the fields that drive execution and the lease.
 */
export interface LeasedSimulationAction {
  actionId: string;
  runKey: string;
  sequence: number;
  targetId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  leaseUntilMs: number;
  expiresAtMs: number;
}

type LeanAction = Pick<
  SimulationActionDocument,
  'actionId' | 'runKey' | 'sequence' | 'targetId' | 'kind' | 'payload' | 'attempts' | 'maxAttempts' | 'leaseUntilMs' | 'expiresAtMs'
>;

const LEASED_PROJECTION = 'actionId runKey sequence targetId kind payload attempts maxAttempts leaseUntilMs expiresAtMs';

function toLeased(row: LeanAction | null): LeasedSimulationAction | null {
  if (row === null || row.leaseUntilMs === null) return null;
  return {
    actionId: row.actionId,
    runKey: row.runKey,
    sequence: row.sequence,
    targetId: row.targetId,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    leaseUntilMs: row.leaseUntilMs,
    expiresAtMs: row.expiresAtMs,
  };
}

/** One action a run scheduled for later, as it is written to the queue. */
export interface ScheduledActionRow {
  actionId: string;
  runKey: string;
  sequence: number;
  targetId: string;
  kind: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
  notBeforeMs: number;
  expiresAtMs: number;
  maxAttempts: number;
}

export interface SimulationActionRepository {
  /** Write a run's schedule. Idempotent: a repeat inserts nothing. */
  enqueue(rows: readonly ScheduledActionRow[]): Promise<number>;
  /** Retire everything still waiting for a run, so nothing lands after recovery. */
  cancelPending(input: { runKey: string; nowMs: number }): Promise<number>;
  claimDue(input: { claimedBy: string; nowMs: number; leaseMs: number; runKey?: string }): Promise<LeasedSimulationAction | null>;
  renewLease(input: { actionId: string; claimedBy: string; nowMs: number; leaseMs: number }): Promise<LeasedSimulationAction | null>;
  settle(input: { actionId: string; claimedBy: string; status: SettledActionStatus; result: SimulationActionResult; executedAtMs: number }): Promise<boolean>;
  expireOverdue(nowMs: number): Promise<number>;
}

export class MongoSimulationActionRepository implements SimulationActionRepository {
  /**
   * Writes the schedule, once.
   *
   * `$setOnInsert` on the action id rather than a plain insert: activation can be
   * retried -- a start that timed out after the executor had already run, a
   * reconcile resuming -- and a second write must not reset an action that has
   * already been claimed or performed.
   */
  async enqueue(rows: readonly ScheduledActionRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await SimulationAction.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { actionId: row.actionId },
          update: { $setOnInsert: { ...row, status: 'pending', revision: 0, attempts: 0 } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return result.upsertedCount ?? 0;
  }

  /**
   * Retires everything still waiting once a run is over.
   *
   * Without this a fault lands AFTER recovery proved the lab clean -- the run
   * reports all-clear and a node stops seconds later. Only work that has not
   * started is touched: an action already claimed is settled by the worker
   * holding it, and overwriting that would lose its outcome.
   */
  async cancelPending(input: { runKey: string; nowMs: number }): Promise<number> {
    const result = await SimulationAction.updateMany(
      { runKey: input.runKey, status: 'pending' },
      {
        $set: {
          status: 'compensated',
          executedAtMs: input.nowMs,
          result: {
            code: 'already-clear',
            publicMessage: 'Cancelled: the run ended before this action was due.',
            privateDetail: null,
            wrapperVersion: null,
            finishedAtMs: input.nowMs,
          },
        },
        $inc: { revision: 1 },
      }
    );
    return result.modifiedCount ?? 0;
  }

  /**
   * Atomically take the single next due action. findOneAndUpdate does the match
   * and the lease write in one step, so two workers racing for the same action
   * cannot both win it. Earliest-due, lowest-sequence first, so a run's actions
   * are worked in order.
   */
  async claimDue(input: { claimedBy: string; nowMs: number; leaseMs: number; runKey?: string }): Promise<LeasedSimulationAction | null> {
    const filter = { ...claimableActionFilter(input.nowMs) } as FilterQuery<SimulationActionDocument>;
    if (input.runKey !== undefined) filter.runKey = input.runKey;
    const claimed = await SimulationAction.findOneAndUpdate(
      filter,
      claimActionUpdate({ claimedBy: input.claimedBy, nowMs: input.nowMs, leaseMs: input.leaseMs }) as UpdateQuery<SimulationActionDocument>,
      { new: true, sort: { notBeforeMs: 1, sequence: 1 }, projection: LEASED_PROJECTION }
    ).lean<LeanAction | null>();
    return toLeased(claimed);
  }

  /** Extend the lease, but only if this worker still holds a live one. */
  async renewLease(input: { actionId: string; claimedBy: string; nowMs: number; leaseMs: number }): Promise<LeasedSimulationAction | null> {
    const renewed = await SimulationAction.findOneAndUpdate(
      renewLeaseFilter(input) as FilterQuery<SimulationActionDocument>,
      renewLeaseUpdate({ nowMs: input.nowMs, leaseMs: input.leaseMs }) as UpdateQuery<SimulationActionDocument>,
      { new: true, projection: LEASED_PROJECTION }
    ).lean<LeanAction | null>();
    return toLeased(renewed);
  }

  /** Record a terminal outcome, but only from the worker that holds the action. */
  async settle(input: { actionId: string; claimedBy: string; status: SettledActionStatus; result: SimulationActionResult; executedAtMs: number }): Promise<boolean> {
    const settled = await SimulationAction.findOneAndUpdate(
      settleActionFilter(input) as FilterQuery<SimulationActionDocument>,
      settleActionUpdate({ status: input.status, result: input.result, executedAtMs: input.executedAtMs }) as UpdateQuery<SimulationActionDocument>,
      { new: true, projection: 'actionId' }
    ).lean<{ actionId: string } | null>();
    return settled !== null;
  }

  /** Retire every action that can no longer make progress. Returns how many. */
  async expireOverdue(nowMs: number): Promise<number> {
    const result = await SimulationAction.updateMany(
      expireOverdueFilter(nowMs) as FilterQuery<SimulationActionDocument>,
      expireOverdueUpdate() as UpdateQuery<SimulationActionDocument>
    );
    return result.modifiedCount ?? 0;
  }
}
