/**
 * Types and constants shared between the server and the client.
 *
 * Phase 0: only the API envelope and the devnet identity live here. The
 * QuorumRound / DevnetOperator view types arrive with Phase 1.
 */

/** Devnet network name. Every node must pass the identical `-devnet=` value. */
export const DEVNET_NAME = 'defcon-q60';

/** Shown in the client header so devnet data can never be mistaken for mainnet. */
export const DEVNET_BANNER = 'DEVNET — test network, coins have no value';

/** Successful response envelope used by every v1 endpoint. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/**
 * Page envelope. `total` is the true match count, not the size of `items` --
 * the production `/events` endpoint truncates at its limit with no indication
 * in the response, and this project does not repeat that.
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
