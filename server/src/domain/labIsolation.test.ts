import { describe, expect, it } from 'vitest';
import { assertLabChain, assertLabDatabaseIsolated, mongoDatabaseName } from './labIsolation.js';

const EXPLORER = 'mongodb://devnet_app:pw@127.0.0.1:27017/deftrack_devnet?authSource=admin';
const LAB = 'mongodb://devnet_app:pw@127.0.0.1:27017/deftrack_lab?authSource=admin';

describe('mongoDatabaseName', () => {
  it('reads the database a connection string names', () => {
    expect(mongoDatabaseName(EXPLORER)).toBe('deftrack_devnet');
    expect(mongoDatabaseName('mongodb://host:27017/plain')).toBe('plain');
    expect(mongoDatabaseName('mongodb+srv://u:p@cluster.example/dbx?retryWrites=true')).toBe('dbx');
  });

  it('answers empty when the string names no database', () => {
    expect(mongoDatabaseName('mongodb://127.0.0.1:27017')).toBe('');
    expect(mongoDatabaseName('mongodb://127.0.0.1:27017/')).toBe('');
    expect(mongoDatabaseName('mongodb://127.0.0.1:27017/?authSource=admin')).toBe('');
  });

  it('refuses something that is not a connection string', () => {
    expect(() => mongoDatabaseName('postgres://host/db')).toThrow(/MongoDB/);
  });
});

describe('assertLabDatabaseIsolated', () => {
  it('accepts a lab database of its own', () => {
    expect(() => assertLabDatabaseIsolated({ labUri: LAB, explorerUri: EXPLORER })).not.toThrow();
  });

  it('refuses an unset lab connection string rather than defaulting to the explorer', () => {
    // A default is precisely how the lab would silently inherit the explorer's
    // database, so there is none.
    expect(() => assertLabDatabaseIsolated({ labUri: '', explorerUri: EXPLORER })).toThrow(/required/);
    expect(() => assertLabDatabaseIsolated({ labUri: '   ', explorerUri: EXPLORER })).toThrow(/required/);
  });

  it('refuses the explorer connection string verbatim', () => {
    expect(() => assertLabDatabaseIsolated({ labUri: EXPLORER, explorerUri: EXPLORER }))
      .toThrow(/explorer connection string/);
  });

  it('refuses the explorer database NAME even on a different server', () => {
    // Being unable to tell two deployments apart from a connection string is the
    // situation the guard exists to prevent, so name equality is enough to refuse.
    const elsewhere = 'mongodb://other-host:27017/deftrack_devnet';
    expect(() => assertLabDatabaseIsolated({ labUri: elsewhere, explorerUri: EXPLORER }))
      .toThrow(/is the explorer's own/);
  });

  it('refuses a lab string that names no database at all', () => {
    expect(() => assertLabDatabaseIsolated({ labUri: 'mongodb://127.0.0.1:27017', explorerUri: EXPLORER }))
      .toThrow(/must name a database/);
  });
});

describe('assertLabChain', () => {
  it('accepts the lab network and refuses every other chain', () => {
    expect(() => assertLabChain('regtest', 'regtest')).not.toThrow();
    // The devnet in particular: the lab must never be pointed at the real chain.
    expect(() => assertLabChain('devnet-defcon-q60', 'regtest')).toThrow(/Refusing to run the simulator lab/);
    expect(() => assertLabChain('main', 'regtest')).toThrow(/Refusing/);
  });
});
