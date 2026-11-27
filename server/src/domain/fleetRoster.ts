export function expectedFleet(value: string): ReadonlySet<string> {
  if (!value.trim()) return new Set();
  const hashes = value.split(',').map((hash) => hash.trim().toLowerCase());
  if (hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) || new Set(hashes).size !== hashes.length) {
    throw new Error('MN_EXPECTED_PROTX_HASHES requires distinct 64-digit hexadecimal hashes');
  }
  return new Set(hashes);
}
