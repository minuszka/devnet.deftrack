import type { BlockDetail, ExperimentDetail, TxDetail } from '@devnet-deftrack/shared';
import { ApiError, type Api } from './api.js';
import { isAbortError, errorMessage } from './errors.js';
import { num } from './format.js';
import { RUN_KEY_PATTERN, type PublicSimulationRunView } from './simulations.js';

/**
 * The explorer's search, as pure decisions.
 *
 * What it looks up, first release: a block by height or hash, a transaction by
 * id, an experiment by run key, a simulation by run key. Nothing else -- no
 * full-text index, no masternode lookup yet.
 *
 * The rule the whole thing is built around: a 64-character hex string is a
 * block hash, a transaction id, or a proTxHash, and its shape does not say
 * which. So it is never decided from the shape. Every endpoint that could
 * answer is asked, and what each one said is kept apart -- found, not found,
 * or could not be checked -- because "no match" is a claim about the chain and
 * a 503 is not evidence for it.
 */

export type SearchTarget = 'block' | 'tx' | 'experiment' | 'simulation';

export interface Candidate {
  target: SearchTarget;
  /** The identifier as it is sent to that endpoint. */
  id: string;
}

export type ParsedSearch =
  | { kind: 'empty' }
  | { kind: 'unsupported'; query: string }
  | {
      kind: 'lookup';
      query: string;
      candidates: Candidate[];
      /** A 64-hex string could also be a proTxHash, which this search cannot look up yet. */
      couldBeProTxHash: boolean;
    };

/** The server's own rule for an experiment run key (admin route validation). */
const EXPERIMENT_RUN_KEY = /^[a-z0-9][a-z0-9._-]*$/i;
const EXPERIMENT_RUN_KEY_MAX = 80;
const HEX_64 = /^[0-9a-f]{64}$/i;
/** Well past any height this chain will reach, and inside a safe integer. */
const MAX_HEIGHT_DIGITS = 12;

export function parseSearch(raw: string): ParsedSearch {
  const query = raw.trim();
  if (query === '') return { kind: 'empty' };
  // Nothing this search looks up contains a space.
  if (/\s/.test(query)) return { kind: 'unsupported', query };

  const candidates: Candidate[] = [];
  let couldBeProTxHash = false;

  if (/^\d+$/.test(query) && query.length <= MAX_HEIGHT_DIGITS) {
    candidates.push({ target: 'block', id: String(Number(query)) });
  } else if (HEX_64.test(query)) {
    // Stored lowercase; the reader may paste either.
    const hex = query.toLowerCase();
    candidates.push({ target: 'block', id: hex }, { target: 'tx', id: hex });
    couldBeProTxHash = true;
  }

  if (RUN_KEY_PATTERN.test(query)) {
    candidates.push({ target: 'simulation', id: query });
  }
  // Independently of all the above. The server's run-key alphabet admits a
  // height, a hash and a simulation key alike, so none of those shapes rules
  // an experiment out -- and asking costs one lookup by key.
  if (EXPERIMENT_RUN_KEY.test(query) && query.length <= EXPERIMENT_RUN_KEY_MAX) {
    candidates.push({ target: 'experiment', id: query });
  }

  if (candidates.length === 0) return { kind: 'unsupported', query };
  return { kind: 'lookup', query, candidates, couldBeProTxHash };
}

/** What a found item looks like in the results. */
export interface Found {
  target: SearchTarget;
  title: string;
  /** The full identifier, for the copy button. Never shortened. */
  identifier: string;
  detail: string;
  href: string;
}

export type Outcome =
  | { status: 'found'; candidate: Candidate; found: Found }
  | { status: 'not-found'; candidate: Candidate }
  | { status: 'unverified'; candidate: Candidate; reason: string };

/**
 * Sort one failed lookup: not found, or not checked.
 *
 * Only a 404 is "not found". Any other status -- 400, 401, 429, 5xx -- and any
 * failure to get an answer at all is "could not be checked", with the reason.
 * An abort is the caller's to explain (a timeout, or a newer search), so it is
 * passed back as null rather than guessed at here.
 */
export function classifyFailure(candidate: Candidate, error: unknown): Outcome | null {
  if (isAbortError(error)) return null;
  if (error instanceof ApiError) {
    if (error.status === 404) return { status: 'not-found', candidate };
    return { status: 'unverified', candidate, reason: `HTTP ${error.status}: ${error.message}` };
  }
  return { status: 'unverified', candidate, reason: errorMessage(error) };
}

export function describeBlock(block: BlockDetail): Found {
  return {
    target: 'block',
    title: `Block ${num(block.height)}`,
    identifier: block.hash,
    detail: `${num(block.nTx)} transaction(s)${block.hasChainLock ? ' · chainlocked' : ''}`,
    href: `/block/${block.hash}`,
  };
}

export function describeTx(tx: TxDetail): Found {
  return {
    target: 'tx',
    title: 'Transaction',
    identifier: tx.txid,
    detail: `in block ${num(tx.height)}`,
    href: `/tx/${tx.txid}`,
  };
}

export function describeExperiment(run: ExperimentDetail): Found {
  return {
    target: 'experiment',
    title: run.title,
    identifier: run.runKey,
    detail: `experiment · ${run.status}`,
    href: `/experiments/${encodeURIComponent(run.runKey)}`,
  };
}

export function describeSimulation(run: PublicSimulationRunView): Found {
  return {
    target: 'simulation',
    title: run.scenario.title,
    identifier: run.runKey,
    detail: `simulation · ${run.state.status} · ${run.state.live ? 'live lab' : 'dry run'}`,
    href: `/simulations/${run.runKey}`,
  };
}

/** Ask the one endpoint a candidate names. Rejects exactly as the API client does. */
export async function lookUp(api: Api, candidate: Candidate): Promise<Found> {
  switch (candidate.target) {
    case 'block':
      return describeBlock(await api.block(candidate.id));
    case 'tx':
      return describeTx(await api.tx(candidate.id));
    case 'experiment':
      return describeExperiment(await api.experiment(candidate.id));
    case 'simulation':
      return describeSimulation(await api.simulation(candidate.id));
  }
}

/**
 * Where a finished search goes on its own, if anywhere.
 *
 * Straight to the item only when the answer is complete and single: exactly one
 * endpoint found something and every other one said "not found". One found and
 * one unchecked is not a single answer -- the unchecked one might have matched
 * too -- so the reader sees both.
 */
export function soleMatch(outcomes: readonly Outcome[]): Found | null {
  const found = outcomes.filter((o): o is Extract<Outcome, { status: 'found' }> => o.status === 'found');
  if (found.length !== 1) return null;
  if (outcomes.some((o) => o.status === 'unverified')) return null;
  return found[0]!.found;
}

export const TARGET_LABELS: Record<SearchTarget, string> = {
  block: 'blocks',
  tx: 'transactions',
  experiment: 'experiments',
  simulation: 'simulations',
};
