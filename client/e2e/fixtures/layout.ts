/**
 * Every public endpoint, answered twice: full of the longest identifiers a page
 * can be handed, and empty.
 *
 * For the layout measurements in `responsive.spec.ts`. A layout that holds for
 * `op-fixture-1` and breaks for an operator label three times as long is a
 * layout that breaks in production, so the loaded answers deliberately carry
 * the long forms: full 64-character hashes, long operator and host labels, a
 * run key and a title with nowhere to break.
 *
 * Invented, like every fixture here. The one address in it is from the
 * documentation range (RFC 5737), never a real host.
 */
import type {
  BanWaveReport,
  BlockDetail,
  DslEpochRow,
  DslSummary,
  ExperimentDetail,
  MasternodeEventRow,
  MasternodeRow,
  MasternodeVersions,
  OperatorReliabilityRow,
  TxDetail,
} from '@devnet-deftrack/shared';
import { ok, type ApiStubs } from '../harness.js';
import {
  blockArrivalReport,
  blockRow,
  blockRun,
  chainLockReport,
  experimentRow,
  FIXED_NOW_ISO,
  healthSnapshot,
  healthTimeline,
  llmqProfile,
  masternodeTimelinePoint,
  pageOf,
  peerPropagation,
  roundDetail,
  roundListItem,
  selectionFairness,
  stakingHealth,
  TIP_HEIGHT,
  txRow,
  txRun,
} from './api.js';
import { SIM_A, simReport, simRun, simRuns } from './simulations.js';

export const LONG_OPERATOR = 'op-fullnode-with-a-label-far-longer-than-any-real-operator-uses-01';
export const LONG_HOST = 'host-label-that-runs-on-well-past-any-real-one-for-the-layout-test';
/** One token, no spaces, no hyphens: nothing a browser would break at. */
export const LONG_TOKEN = `${'k'.repeat(48)}${'L'.repeat(48)}${'m'.repeat(48)}`;
export const HASH = `${'c0ffee'.repeat(10)}c0ff`;
export const LONG_RUN_KEY = `run-${LONG_TOKEN}`;
const SERVICE = '198.51.100.23:19799';

function masternode(i: number): MasternodeRow {
  return {
    proTxHash: `${String(i).padStart(4, '0')}${HASH.slice(4)}`,
    service: SERVICE,
    hostLabel: LONG_HOST,
    operatorLabel: LONG_OPERATOR,
    banned: i === 0,
    poSePenalty: i === 0 ? 152 : 0,
    poSeBanHeight: i === 0 ? TIP_HEIGHT - 10 : -1,
    poSeRevivedHeight: -1,
    missedServiceEpochs: 0,
    rewardSuspended: false,
    dslBanHeight: -1,
    registeredHeight: 5_000,
    lastPaidHeight: TIP_HEIGHT - 3,
    payoutAddress: `P${LONG_TOKEN.slice(0, 33)}`,
    lastSeenAt: FIXED_NOW_ISO,
    nodeVersion: { subversion: '/DeFCoN Core:22.1.5/', protocol: 70_230, seenAt: FIXED_NOW_ISO },
  };
}

function event(i: number): MasternodeEventRow {
  return {
    eventKey: `event-${i}`,
    proTxHash: HASH,
    type: 'banned',
    height: TIP_HEIGHT - i,
    penaltyBefore: 100,
    penaltyAfter: 152,
    serviceBefore: null,
    serviceAfter: null,
    hostLabel: LONG_HOST,
    operatorLabel: LONG_OPERATOR,
    detectedAt: FIXED_NOW_ISO,
  };
}

function banWaves(): BanWaveReport {
  return {
    hours: 168,
    gapMinutes: 30,
    waves: [
      {
        startedAt: FIXED_NOW_ISO,
        endedAt: FIXED_NOW_ISO,
        durationMinutes: 12,
        size: 21,
        maxPossibleBanAtStart: 16,
        firstHeight: TIP_HEIGHT - 20,
        lastHeight: TIP_HEIGHT - 15,
        byHost: [{ hostLabel: LONG_HOST, count: 21 }],
        byOperator: [{ operatorLabel: LONG_OPERATOR, count: 21 }],
      },
    ],
    largestWave: 21,
    totalBans: 21,
  };
}

function versions(): MasternodeVersions {
  return {
    total: 152,
    known: 150,
    stale: 1,
    unknown: 1,
    staleAfterMs: 3_600_000,
    byVersion: [{ subversion: `/DeFCoN Core:22.1.5(${LONG_TOKEN})/`, release: '22.1.5', protocol: 70_230, count: 150, share: 150 / 152 }],
    observedAt: FIXED_NOW_ISO,
  };
}

function dslSummary(): DslSummary {
  return {
    activationHeight: 5_472,
    epochInterval: 24,
    firstCommittableBoundary: 5_496,
    enforcement: { height: 8_304, active: true },
    epochsJudged: 250,
    committed: 242,
    absent: 8,
    convergenceRate: 242 / 250,
    totalMissedBits: 40,
    totalUnobservedBits: 3,
    unobservedBitsFromEpochs: 30,
    latest: { epoch: 479, boundaryHeight: TIP_HEIGHT - 4, status: 'committed', missedCount: 2 },
  };
}

function dslEpoch(i: number): DslEpochRow {
  return {
    epoch: 479 - i,
    boundaryHeight: TIP_HEIGHT - 4 - i * 24,
    status: 'committed',
    txid: HASH,
    epochBlockHash: HASH,
    quorumHash: HASH,
    missedCount: 2,
    listSize: 152,
    missedIndices: [3, 97],
    missedProTxHashes: [HASH, HASH],
    commitmentVersion: 2,
    observedCount: 150,
    unobservedIndices: [5],
    unobservedProTxHashes: [HASH],
    detectedAt: FIXED_NOW_ISO,
  };
}

function operators(): OperatorReliabilityRow[] {
  return [
    {
      operatorLabel: LONG_OPERATOR,
      vpsProvider: `provider-${LONG_TOKEN.slice(0, 40)}`,
      country: 'DE',
      masternodeCount: 10,
      roundsSelected: 40,
      memberSlots: 120,
      invalidSlots: 3,
      failureRate: 3 / 120,
    },
  ];
}

function experimentDetail(): ExperimentDetail {
  return {
    ...experimentRow({ runKey: LONG_RUN_KEY, title: `A run whose title quotes ${LONG_TOKEN}`, status: 'running', endedAt: null, endHeight: null }),
    currentParticipants: { masternodes: 152, hosts: 16, stakers: 9 },
    tipHeight: TIP_HEIGHT,
    comparison: null,
  };
}

/** A block with every hash at full length. Exported for the focus test, which delays it. */
export function blockDetail(): BlockDetail {
  const { nTx: _nTx, ...row } = blockRow({ hash: HASH, payee: `P${LONG_TOKEN.slice(0, 33)}` });
  void _nTx;
  return {
    ...row,
    previousblockhash: HASH,
    nextblockhash: null,
    mediantime: null,
    version: 536_870_912,
    merkleroot: HASH,
    bits: '1d00ffff',
    nonce: 0,
    difficulty: 0.0001,
    chainwork: HASH,
    nTx: 2,
    paidMasternode: { proTxHash: HASH, service: SERVICE, operatorLabel: LONG_OPERATOR },
    txs: [
      { txid: HASH, type: 0, isCoinbase: true, isCoinstake: false, size: 180, valueOutSat: '0', voutCount: 1, vinCount: 1 },
      { txid: HASH, type: 0, isCoinbase: false, isCoinstake: true, size: 220, valueOutSat: '50000000000', voutCount: 3, vinCount: 1 },
    ],
  };
}

function txDetail(): TxDetail {
  return {
    ...txRow({ txid: HASH }),
    blockhash: HASH,
    version: 3,
    vin: [{ txid: HASH, vout: 1, coinbase: null }],
    vout: [
      { n: 0, valueSat: '1000000000', scriptType: 'pubkeyhash', address: `P${LONG_TOKEN.slice(0, 33)}` },
      { n: 1, valueSat: '0', scriptType: 'nulldata', address: null },
    ],
  };
}

/** Everything a public page asks for, answered with long identifiers. */
export function loadedLayoutStubs(): ApiStubs {
  const rounds = Array.from({ length: 5 }, (_unused, i) =>
    roundListItem({
      expectedHeight: 11_400 - i * 24,
      failuresByOperator: [{ operatorLabel: LONG_OPERATOR, count: 3 }],
    })
  );
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/block-arrival': { body: ok(blockArrivalReport()) },
    '/api/v1/quorum-rounds': { body: ok(pageOf(rounds, { total: 900 })) },
    '/api/v1/quorum-rounds/health-timeline': { body: ok(healthTimeline()) },
    '/api/v1/quorum-rounds/profiles': { body: ok({ items: [llmqProfile()] }) },
    '/api/v1/quorum-rounds/*': {
      body: ok(
        roundDetail({
          members: Array.from({ length: 4 }, (_unused, i) => ({
            proTxHash: HASH,
            service: SERVICE,
            valid: i !== 0,
            operatorLabel: LONG_OPERATOR,
          })),
        })
      ),
    },
    '/api/v1/masternodes': { body: ok(pageOf(Array.from({ length: 5 }, (_unused, i) => masternode(i)), { total: 152 })) },
    '/api/v1/masternodes/timeline': { body: ok({ hours: 168, points: [masternodeTimelinePoint()] }) },
    '/api/v1/masternodes/events': { body: ok(pageOf(Array.from({ length: 5 }, (_unused, i) => event(i)))) },
    '/api/v1/masternodes/ban-waves': { body: ok(banWaves()) },
    '/api/v1/masternodes/versions': { body: ok(versions()) },
    '/api/v1/dsl/summary': { body: ok(dslSummary()) },
    '/api/v1/dsl/epochs': { body: ok(pageOf(Array.from({ length: 5 }, (_unused, i) => dslEpoch(i)), { total: 250 })) },
    '/api/v1/staking/health': {
      body: ok(
        stakingHealth({
          stakers: [{ payee: `P${LONG_TOKEN.slice(0, 33)}`, blocks: 80, share: 0.16, host: LONG_HOST }],
        })
      ),
    },
    '/api/v1/peers/propagation': {
      body: ok(
        peerPropagation({
          hostsReporting: [LONG_HOST, 'host-b'],
          laggards: [{ host: LONG_HOST, samples: 12, meanDelayMs: 380, lastPlaceShare: 0.75 }],
        })
      ),
    },
    '/api/v1/operators/reliability': { body: ok({ hours: 168, roundsConsidered: 40, operators: operators() }) },
    '/api/v1/fairness/selection': { body: ok(selectionFairness()) },
    '/api/v1/experiments': {
      body: ok(
        pageOf([
          experimentRow({ runKey: LONG_RUN_KEY, title: `A run whose title quotes ${LONG_TOKEN}`, status: 'running', endedAt: null, endHeight: null }),
          experimentRow(),
        ])
      ),
    },
    '/api/v1/experiments/*': { body: ok(experimentDetail()) },
    '/api/v1/simulations': { body: ok(pageOf(simRuns(3))) },
    '/api/v1/simulations/*': (url) =>
      url.pathname.endsWith('/report') ? { body: ok(simReport('matched')) } : { body: ok(simRun()) },
    '/api/v1/blocks': { body: ok(pageOf(blockRun(5), { total: TIP_HEIGHT + 1 })) },
    '/api/v1/blocks/*': { body: ok(blockDetail()) },
    '/api/v1/txs': { body: ok(pageOf(txRun(5), { total: 40_000 })) },
    '/api/v1/txs/*': { body: ok(txDetail()) },
  };
}

/**
 * The same endpoints with nothing in them: a network that has just started.
 *
 * Details still answer -- an empty list has no detail to link to, but a
 * direct URL can still be typed, and that page has to hold its width too.
 */
export function emptyLayoutStubs(): ApiStubs {
  const loaded = loadedLayoutStubs();
  return {
    ...loaded,
    '/api/v1/chainlocks': { body: ok(chainLockReport({ blocksConsidered: 0, eligible: 0, locked: 0, coverage: null, latencyMeasured: 0, eventLatencyMeasured: 0 })) },
    '/api/v1/quorum-rounds': { body: ok(pageOf([])) },
    '/api/v1/quorum-rounds/health-timeline': { body: ok(healthTimeline({ points: [], summary: { rounds: 0, formed: 0, failed: 0, pending: 0, formationRate: null, medianHealthRatio: null, worstHealthRatio: null, longestFailureStreak: 0 } })) },
    '/api/v1/masternodes': { body: ok(pageOf([])) },
    '/api/v1/masternodes/timeline': { body: ok({ hours: 168, points: [] }) },
    '/api/v1/masternodes/events': { body: ok(pageOf([])) },
    '/api/v1/masternodes/ban-waves': { body: ok({ hours: 168, gapMinutes: 30, waves: [], largestWave: 0, totalBans: 0 }) },
    '/api/v1/masternodes/versions': { body: ok({ total: 0, known: 0, stale: 0, unknown: 0, staleAfterMs: 3_600_000, byVersion: [], observedAt: FIXED_NOW_ISO }) },
    '/api/v1/dsl/summary': { body: ok({ ...dslSummary(), epochsJudged: 0, committed: 0, absent: 0, convergenceRate: null, totalMissedBits: 0, totalUnobservedBits: 0, unobservedBitsFromEpochs: 0, latest: null }) },
    '/api/v1/dsl/epochs': { body: ok(pageOf([])) },
    '/api/v1/staking/health': { body: ok(stakingHealth({ blocks: 0, distinctStakers: 0, stakers: [], medianIntervalSec: null, meanIntervalSec: null, longestGapSec: null, hhi: null, gini: null, topStakerShare: null, byHost: null })) },
    '/api/v1/peers/propagation': { body: ok(peerPropagation({ hostsReporting: [], events: [], laggards: [], hosts: [] })) },
    '/api/v1/operators/reliability': { body: ok({ hours: 168, roundsConsidered: 0, operators: [] }) },
    '/api/v1/fairness/selection': { body: ok(selectionFairness({ roundsConsidered: 0, nodes: [], hosts: [], neverSelected: [], neverSelectedCount: 0, heightRange: null, totals: { nodesCounted: 0, timesSelected: 0, timesInvalid: 0, worstInvalidRate: null } })) },
    '/api/v1/experiments': { body: ok(pageOf([])) },
    '/api/v1/simulations': { body: ok(pageOf([])) },
    '/api/v1/blocks': { body: ok(pageOf([])) },
    '/api/v1/txs': { body: ok(pageOf([])) },
  };
}

export { SIM_A };
