import { createHash } from 'node:crypto';

/**
 * Deterministic stand-ins for chain identifiers.
 *
 * A hash here is the SHA-256 of a label, so `hashOf('block:12')` is the same
 * 64-hex string in every run and every file, distinct labels never collide,
 * and a failing assertion can be read back to the thing it names.
 */
export function hashOf(label: string | number): string {
  return createHash('sha256').update(String(label)).digest('hex');
}

/** A block hash keyed on its height, so a chain can be built by arithmetic. */
export const blockHash = (height: number): string => hashOf(`block:${height}`);

/** Unix time of a block on a 150-second schedule from a fixed epoch. */
export const blockTime = (height: number): number => 1_757_000_000 + height * 150;

/**
 * The fields the Block schema requires, for tests that seed the index directly
 * rather than through the sync. Everything not named here takes the schema's
 * own default, which is the point: a test should override only what it is
 * about.
 */
export function blockRow(height: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    height,
    hash: blockHash(height),
    time: blockTime(height),
    nTx: 1,
    size: 500,
    isProofOfStake: true,
    hasChainLock: false,
    previousblockhash: height > 0 ? blockHash(height - 1) : null,
    merkleroot: hashOf(`merkle:${height}`),
    version: 4,
    bits: '1e0ffff0',
    nonce: 0,
    difficulty: 1,
    chainwork: '00',
    totalOutSat: '0',
    ...overrides,
  };
}
