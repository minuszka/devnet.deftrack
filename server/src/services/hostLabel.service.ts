import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ServerSecret } from '../models/ServerSecret.js';
import type { HostRedactionPolicy } from '../domain/hostRedaction.js';

const SECRET_KEY = 'host-label';

/**
 * Loaded once at startup and then read synchronously by every route.
 *
 * Empty until `initializeHostLabelPolicy` has run, and `hostLabel` treats an
 * empty key as "issue no label" -- so the failure mode of a missed
 * initialization is a missing field, never a published address.
 */
let policy: HostRedactionPolicy = { publishAddresses: false, secret: '' };

/**
 * Read the deployment's host-label key, generating it on first run.
 *
 * Idempotent and safe against two processes starting at once: the unique index
 * on `key` decides the winner and the loser re-reads the winner's value, so the
 * labels are the same everywhere however many workers there are.
 */
export async function initializeHostLabelPolicy(): Promise<void> {
  if (config.publicHostAddresses) {
    policy = { publishAddresses: true, secret: '' };
    logger.warn(
      'PUBLIC_HOST_ADDRESSES is on: masternode host addresses are published on the public API'
    );
    return;
  }

  const existing = await ServerSecret.findOne({ key: SECRET_KEY }).select('value').lean();
  if (existing?.value) {
    policy = { publishAddresses: false, secret: existing.value };
    return;
  }

  const generated = randomBytes(32).toString('hex');
  try {
    await ServerSecret.create({ key: SECRET_KEY, value: generated });
    policy = { publishAddresses: false, secret: generated };
    logger.info('Generated the host-label key; host addresses are redacted on the public API');
  } catch {
    // Someone else won the race. Their value is the one every label must use.
    const winner = await ServerSecret.findOne({ key: SECRET_KEY }).select('value').lean();
    if (!winner?.value) throw new Error('could not establish a host-label key');
    policy = { publishAddresses: false, secret: winner.value };
  }
}

/** The policy every public DTO redacts through. */
export function hostRedactionPolicy(): HostRedactionPolicy {
  return policy;
}

/** Test seam: set the policy directly, without a database. */
export function setHostRedactionPolicyForTest(next: HostRedactionPolicy): void {
  policy = next;
}
