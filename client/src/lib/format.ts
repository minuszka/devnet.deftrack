export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US');
}

/** Health ratio as a percentage. Null means "no ratio exists", not zero. */
export function ratio(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function shortHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) return '—';
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function utc(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Satoshi string to DFCN.
 *
 * Parsed as BigInt, not Number: the supply is 1.1e17 satoshis, past the safe
 * integer range, so a float would quietly lose the low digits.
 */
export function coin(sat: string | null | undefined, decimals = 2): string {
  if (sat === null || sat === undefined) return '—';
  let v: bigint;
  try {
    v = BigInt(sat);
  } catch {
    return '—';
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = v / 100000000n;
  const frac = (v % 100000000n).toString().padStart(8, '0').slice(0, decimals);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${w}${decimals > 0 ? '.' + frac : ''}`;
}
