import { createHmac } from 'node:crypto';

/**
 * Host addresses do not belong on the public site.
 *
 * The rule is the project's own and it is written down twice: "the host
 * addresses are not public and this repository is", and targets are named "by
 * host label, never by IP". The observation pipeline honoured it, the admin API
 * honoured it, and the public DTOs did not -- `service`, `hostIp`,
 * `serviceBefore/After`, ban-wave `byHost` and the fairness tables all carried
 * raw addresses onto devnet.deftrack.xyz.
 *
 * A masternode's `service` is on-chain, so any devnet peer can read it. That is
 * an argument about who *could* learn it, not about what this site should
 * publish -- and most of these hosts also carry production mainnet services.
 *
 * What the views actually need is a stable key to group by, not an address. So
 * every address becomes a pseudonym that is stable for the life of the
 * deployment, unique per host, and not reversible: keyed HMAC, not a bare hash.
 * A bare hash of an IPv4 address is not redaction at all -- the whole space is
 * four billion values and a laptop enumerates it in seconds.
 */

/** Whether raw addresses may be published, and the key that hides them if not. */
export interface HostRedactionPolicy {
  /** Opt back in to raw addresses. Deliberate, and off by default. */
  publishAddresses: boolean;
  /** HMAC key. An empty key means no pseudonym can be issued. */
  secret: string;
}

/** How many hex characters of the HMAC a label carries. 40 bits. */
const LABEL_HEX = 10;

/**
 * A stable, non-reversible name for one host.
 *
 * Returns null rather than inventing a label when there is no address, or when
 * the deployment has no key to hide it with -- fail closed, because the failure
 * mode of the alternative is publishing the address.
 */
export function hostLabel(hostIp: string | null | undefined, policy: HostRedactionPolicy): string | null {
  if (!hostIp) return null;
  if (policy.publishAddresses) return hostIp;
  if (!policy.secret) return null;
  const digest = createHmac('sha256', policy.secret).update(hostIp).digest('hex');
  return `host-${digest.slice(0, LABEL_HEX)}`;
}

/**
 * The same treatment for a `service`, which is an address and a port.
 *
 * The port is kept: it says which instance on the host answered, it is not an
 * address, and the views read it. Anything that does not parse as
 * `<address>:<port>` is dropped entirely rather than guessed at.
 */
export function redactService(
  service: string | null | undefined,
  policy: HostRedactionPolicy
): string | null {
  if (!service) return null;
  if (policy.publishAddresses) return service;
  const separator = service.lastIndexOf(':');
  if (separator <= 0) return null;
  const address = service.slice(0, separator);
  const port = service.slice(separator + 1);
  if (!/^\d{1,5}$/.test(port)) return null;
  const label = hostLabel(address, policy);
  return label === null ? null : `${label}:${port}`;
}

/** Matches a bare IPv4 address anywhere in a string. The test's whole point. */
export const DOTTED_QUAD = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/** An identifier that IS an address, rather than one that merely contains one. */
const IS_ADDRESS = /^(?:(?:\d{1,3}\.){3}\d{1,3}|\[?[0-9a-f:]*:[0-9a-f:]*\]?)$/i;

/**
 * A vantage point's own identifier, which an operator chooses.
 *
 * `OBSERVER_HOST` is set per machine, the ingest schema accepts anything
 * hostname-shaped, and "198.51.100.11" is hostname-shaped -- so an operator
 * naming an observer after its address published that address on
 * /peers/propagation, verbatim, in six fields at once. Nothing was wrong with
 * the deployment's current labels; the endpoint simply had no rule.
 *
 * A readable label is worth keeping -- "fullnode-4" says something an HMAC does
 * not, and it is not an address -- so only something that IS an address becomes
 * a pseudonym. Everything else passes through.
 */
export function redactHostId(
  hostId: string | null | undefined,
  policy: HostRedactionPolicy
): string | null {
  if (!hostId) return null;
  if (!IS_ADDRESS.test(hostId)) return hostId;
  return hostLabel(hostId, policy);
}

/**
 * Whether any value reachable from `body` still carries an address.
 *
 * Used by the contract test that guards every public route at once: a new field
 * added to a DTO years from now is caught by this rather than by a reader
 * noticing it on the live site.
 */
export function containsHostAddress(body: unknown): boolean {
  if (typeof body === 'string') return DOTTED_QUAD.test(body);
  if (Array.isArray(body)) return body.some(containsHostAddress);
  if (body !== null && typeof body === 'object') {
    return Object.values(body as Record<string, unknown>).some(containsHostAddress);
  }
  return false;
}
