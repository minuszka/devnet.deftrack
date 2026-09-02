/**
 * The guards that keep the simulator lab and the explorer apart.
 *
 * The explorer refuses to index any chain but the devnet, and the live executor
 * refuses to act on any network but the lab. Those two rules are each correct and
 * together they made the live path impassable: on devnet the server ran and the
 * executor refused, on regtest the executor would have acted and the server
 * refused to start. The lab therefore gets its OWN entrypoint rather than a mode
 * flag on the explorer -- a flag would weaken the one guard that stops the
 * production explorer ingesting a foreign chain, and it is exactly the kind of
 * switch that gets set wrong on a host.
 *
 * Two things must then be impossible rather than merely discouraged: the lab
 * pointing at the explorer's chain, and the lab writing into the explorer's
 * database. Simulation runs and their audit streams ARE the record, and a
 * regtest run filed among devnet ones is a corruption of it that no later query
 * can undo.
 */

/**
 * The database a MongoDB connection string names, or '' when it names none.
 * Percent-decoded, because that is what the driver does with it.
 */
export function mongoDatabaseName(uri: string): string {
  const match = /^mongodb(?:\+srv)?:\/\/[^/?]*(?:\/([^/?]*))?/i.exec(uri.trim());
  if (match === null) throw new Error('not a MongoDB connection string');
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return match[1] ?? '';
  }
}

/**
 * Refuse to start the lab unless it has a database of its own.
 *
 * Deliberately strict on two counts. There is no default, because a default is
 * how the lab would silently inherit the explorer's; and two different servers
 * hosting the same database NAME are refused as well, because being unable to
 * tell them apart from a connection string is precisely the situation this
 * guard exists to prevent.
 */
export function assertLabDatabaseIsolated(input: { labUri: string; explorerUri: string }): void {
  const labUri = input.labUri.trim();
  if (labUri === '') {
    throw new Error('LAB_MONGODB_URI is required: the lab never shares the explorer database');
  }
  const labDb = mongoDatabaseName(labUri);
  if (labDb === '') {
    throw new Error('LAB_MONGODB_URI must name a database of its own');
  }
  if (labUri === input.explorerUri.trim()) {
    throw new Error('LAB_MONGODB_URI is the explorer connection string; the lab needs its own database');
  }
  const explorerDb = mongoDatabaseName(input.explorerUri);
  if (explorerDb !== '' && labDb === explorerDb) {
    throw new Error(
      `LAB_MONGODB_URI names database "${labDb}", which is the explorer's own; a regtest run must not be filed among devnet ones`
    );
  }
}

/**
 * Refuse to start the lab against anything but the lab chain. The mirror of the
 * explorer's own guard, and of the executor's network refusal -- the same
 * constant feeds all three so they cannot drift apart.
 */
export function assertLabChain(chain: string, labNetwork: string): void {
  if (chain !== labNetwork) {
    throw new Error(`Refusing to run the simulator lab against chain "${chain}"; expected "${labNetwork}"`);
  }
}
