import type { LlmqProfile } from '../config/llmq.js';
import { selectQuorumMembers, type QuorumSelectionMasternode } from './quorumMemberSelection.js';
import type { QuorumMembershipObservation } from './quorumTargetSnapshot.js';

/**
 * The quorum whose DKG is running right now -- the "next" quorum a target
 * snapshot can name -- resolved from the chain rather than predicted.
 *
 * Below v20 the node selects members from the cycle base block's hash and the
 * masternode list at that block (`ComputeQuorumMembers`, src/llmq/utils.cpp),
 * so the membership of a quorum is undefined until its base block is mined and
 * fully determined from that block on. Between the base block and the mined
 * commitment no RPC on a non-masternode lists it; this module computes it, and
 * only offers the result after reproducing a quorum the chain has already
 * committed to. A selection that cannot reproduce the formed quorum is not
 * trusted with the forming one -- the project's own verifiers have answered
 * cleanly and wrongly before, and a member list that is nearly right would
 * stop the wrong masternodes.
 */

export interface QuorumChainSource {
  getBlockHash(height: number): Promise<string>;
  /** The deterministic masternode list as the node holds it after connecting `height`. */
  masternodeListAt(height: number): Promise<readonly QuorumSelectionMasternode[]>;
}

export interface FormedQuorumEvidence {
  quorumHash: string;
  expectedHeight: number;
  /** In the order `quorum info` listed them; the node's selection order. */
  memberProTxHashes: readonly string[];
}

export interface FormingQuorumSelfCheck {
  verifiedAgainst: { quorumHash: string; expectedHeight: number };
  /** The recomputed member set equals the committed one. */
  passed: boolean;
  /** Stricter than `passed`: the node's order was reproduced too. Informational. */
  orderMatched: boolean;
  detail: string | null;
}

export interface FormingQuorumResolution {
  next: QuorumMembershipObservation | null;
  nextUnavailableReason: string | null;
  selfCheck: FormingQuorumSelfCheck | null;
}

export interface FormingQuorumInput {
  tipHeight: number;
  profile: LlmqProfile;
  v20Active: boolean;
  /** The newest formed quorum of this profile, or null when none is recorded. */
  current: FormedQuorumEvidence | null;
  source: QuorumChainSource;
}

/** The cycle whose DKG the tip is inside of; index 0 because no profile here rotates. */
export function formingCycleBaseHeight(tipHeight: number, profile: LlmqProfile): number {
  if (!Number.isSafeInteger(tipHeight) || tipHeight < 0) throw new Error(`tip height is invalid: ${tipHeight}`);
  return tipHeight - (tipHeight % profile.dkgInterval);
}

function unavailable(reason: string, selfCheck: FormingQuorumSelfCheck | null = null): FormingQuorumResolution {
  return { next: null, nextUnavailableReason: reason, selfCheck };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(left.map((value) => value.toLowerCase()));
  return right.every((value) => seen.has(value.toLowerCase()));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.toLowerCase() === right[index]!.toLowerCase());
}

async function reproduceFormedQuorum(input: FormingQuorumInput, current: FormedQuorumEvidence): Promise<FormingQuorumSelfCheck> {
  const verifiedAgainst = { quorumHash: current.quorumHash.toLowerCase(), expectedHeight: current.expectedHeight };
  const baseHash = (await input.source.getBlockHash(current.expectedHeight)).toLowerCase();
  if (baseHash !== verifiedAgainst.quorumHash) {
    return {
      verifiedAgainst,
      passed: false,
      orderMatched: false,
      detail: `block ${current.expectedHeight} is ${baseHash} on the node but the recorded quorum hash is ${verifiedAgainst.quorumHash}`,
    };
  }
  const recomputed = selectQuorumMembers({
    llmqType: input.profile.llmqType,
    size: input.profile.size,
    useRotation: input.profile.useRotation,
    v20Active: input.v20Active,
    cycleBaseBlockHash: baseHash,
    masternodes: await input.source.masternodeListAt(current.expectedHeight),
  });
  const passed = sameSet(recomputed, current.memberProTxHashes);
  return {
    verifiedAgainst,
    passed,
    orderMatched: passed && sameOrder(recomputed, current.memberProTxHashes),
    detail: passed
      ? null
      : `recomputed ${recomputed.length} member(s) for the formed quorum at ${current.expectedHeight}, the chain committed ${current.memberProTxHashes.length}, and the sets differ`,
  };
}

/**
 * Names the members of the quorum forming at the tip, or says exactly why it
 * cannot. Every refusal is a statement about the chain or the evidence, never
 * a guess about members.
 */
export async function resolveFormingQuorum(input: FormingQuorumInput): Promise<FormingQuorumResolution> {
  const { profile } = input;
  if (profile.useRotation) {
    return unavailable(`${profile.llmqName} rotates its members; that selection is not reproduced here.`);
  }
  if (input.v20Active) {
    return unavailable('v20 is active, so member selection depends on the work block ChainLock signature; not reproduced here.');
  }
  const cycleBaseHeight = formingCycleBaseHeight(input.tipHeight, profile);
  if (profile.formationGateHeight !== undefined && cycleBaseHeight < profile.formationGateHeight) {
    return unavailable(
      `${profile.llmqName} cannot form below height ${profile.formationGateHeight}; the cycle at ${cycleBaseHeight} holds no session.`
    );
  }
  if (input.current === null) {
    return unavailable(
      `No formed ${profile.llmqName} quorum is recorded, so the member selection cannot be verified before it is trusted.`
    );
  }
  const selfCheck = await reproduceFormedQuorum(input, input.current);
  if (!selfCheck.passed) {
    return unavailable(
      `Member selection failed to reproduce the formed ${profile.llmqName} quorum at ${input.current.expectedHeight}; no forming quorum is offered.`,
      selfCheck
    );
  }
  if (input.current.expectedHeight >= cycleBaseHeight) {
    const nextBase = cycleBaseHeight + profile.dkgInterval;
    return unavailable(
      `The ${profile.llmqName} quorum of cycle ${cycleBaseHeight} is already committed; the next cycle's base block ` +
        `${nextBase} is ${nextBase - input.tipHeight} block(s) away and its members are undefined until it is mined.`,
      selfCheck
    );
  }
  const quorumHash = (await input.source.getBlockHash(cycleBaseHeight)).toLowerCase();
  const memberProTxHashes = selectQuorumMembers({
    llmqType: profile.llmqType,
    size: profile.size,
    useRotation: profile.useRotation,
    v20Active: input.v20Active,
    cycleBaseBlockHash: quorumHash,
    masternodes: await input.source.masternodeListAt(cycleBaseHeight),
  });
  if (memberProTxHashes.length === 0) {
    return unavailable(`No eligible masternode existed at ${cycleBaseHeight}, so no ${profile.llmqName} session can run.`, selfCheck);
  }
  return {
    next: {
      llmqType: profile.llmqType,
      llmqName: profile.llmqName,
      quorumHash,
      expectedHeight: cycleBaseHeight,
      quorumIndex: 0,
      capturedAtHeight: input.tipHeight,
      memberProTxHashes,
      provenance: 'computed',
      verifiedAgainstQuorumHash: selfCheck.verifiedAgainst.quorumHash,
    },
    nextUnavailableReason: null,
    selfCheck,
  };
}
