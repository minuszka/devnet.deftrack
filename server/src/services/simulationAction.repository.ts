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

export interface SimulationActionRepository {
  claimDue(input: { claimedBy: string; nowMs: number; leaseMs: number; runKey?: string }): Promise<LeasedSimulationAction | null>;
  renewLease(input: { actionId: string; claimedBy: string; nowMs: number; leaseMs: number }): Promise<LeasedSimulationAction | null>;
  settle(input: { actionId: string; claimedBy: string; status: SettledActionStatus; result: SimulationActionResult; executedAtMs: number }): Promise<boolean>;
  expireOverdue(nowMs: number): Promise<number>;
}

export class MongoSimulationActionRepository implements SimulationActionRepository {
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
