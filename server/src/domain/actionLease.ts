import type { SimulationActionResult } from '../models/SimulationAction.js';

/**
 * How the action repository decides what a worker may claim, renew, settle or
 * expire -- as pure filter/update builders, so the leasing logic can be tested
 * without a database and the Mongo layer stays a thin wiring around them.
 *
 * The lease is the orchestrator-side half of crash recovery: a worker takes an
 * action under a time-boxed lease, and if it dies the lease simply expires and
 * the action becomes claimable again. Nothing here removes an action's own hard
 * TTL (`expiresAtMs`); the lease only governs who is working it right now.
 */

export interface ActionClaimInput {
  claimedBy: string;
  nowMs: number;
  /** How long this claim holds the action before it must renew or lose it. */
  leaseMs: number;
}

/**
 * The next action a worker may claim: its window is still open, it has attempts
 * left, it is due, and it is either never claimed or holding a lease that has
 * expired -- in which case the previous claimant is presumed gone and this is a
 * reclaim. Leads with the indexed `status` inside the $or so each branch can use
 * the {status, notBeforeMs, leaseUntilMs} index.
 */
export function claimableActionFilter(nowMs: number): Record<string, unknown> {
  return {
    expiresAtMs: { $gt: nowMs },
    $or: [{ notBeforeMs: null }, { notBeforeMs: { $lte: nowMs } }],
    $and: [
      {
        $or: [
          { status: 'pending' },
          // A lease that has lapsed: the worker that held it never renewed, so
          // treat it as gone and let this action be taken again.
          { status: 'claimed', leaseUntilMs: { $lte: nowMs } },
        ],
      },
      // Never re-attempt past the ceiling: a crashed worker's action is reclaimed
      // only while attempts remain, otherwise it is left for the expiry sweep.
      { $expr: { $lt: ['$attempts', '$maxAttempts'] } },
    ],
  };
}

/** Taking ownership: a fresh lease, this attempt counted, revision bumped. */
export function claimActionUpdate(input: ActionClaimInput): Record<string, unknown> {
  return {
    $set: {
      status: 'claimed',
      claimedBy: input.claimedBy,
      claimedAtMs: input.nowMs,
      leaseUntilMs: input.nowMs + input.leaseMs,
    },
    $inc: { attempts: 1, revision: 1 },
  };
}

/** Only the current owner, still inside its lease, may renew. */
export function renewLeaseFilter(input: { actionId: string; claimedBy: string; nowMs: number }): Record<string, unknown> {
  return {
    actionId: input.actionId,
    status: 'claimed',
    claimedBy: input.claimedBy,
    leaseUntilMs: { $gt: input.nowMs },
  };
}

export function renewLeaseUpdate(input: { nowMs: number; leaseMs: number }): Record<string, unknown> {
  return { $set: { leaseUntilMs: input.nowMs + input.leaseMs }, $inc: { revision: 1 } };
}

export type SettledActionStatus = 'succeeded' | 'failed' | 'compensated';

/** Only the current owner may settle the action it holds. */
export function settleActionFilter(input: { actionId: string; claimedBy: string }): Record<string, unknown> {
  return { actionId: input.actionId, status: 'claimed', claimedBy: input.claimedBy };
}

/** A terminal outcome drops the lease: no one owns a settled action. */
export function settleActionUpdate(input: {
  status: SettledActionStatus;
  result: SimulationActionResult;
  executedAtMs: number;
}): Record<string, unknown> {
  return {
    $set: {
      status: input.status,
      result: input.result,
      executedAtMs: input.executedAtMs,
      leaseUntilMs: null,
    },
    $inc: { revision: 1 },
  };
}

/**
 * Actions the sweep gives up on: past their own TTL, or exhausted while nobody
 * holds a live lease. Either way they can never make progress, so they leave the
 * claimable set for good.
 */
export function expireOverdueFilter(nowMs: number): Record<string, unknown> {
  return {
    $or: [
      // Window closed while still pending or held.
      { status: { $in: ['pending', 'claimed'] }, expiresAtMs: { $lte: nowMs } },
      // Attempts exhausted and the last lease has lapsed, so no reclaim can run.
      {
        status: 'claimed',
        leaseUntilMs: { $lte: nowMs },
        $expr: { $gte: ['$attempts', '$maxAttempts'] },
      },
    ],
  };
}

export function expireOverdueUpdate(): Record<string, unknown> {
  return { $set: { status: 'expired', claimedBy: null, leaseUntilMs: null }, $inc: { revision: 1 } };
}
