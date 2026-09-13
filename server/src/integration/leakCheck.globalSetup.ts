import mongoose from 'mongoose';

/**
 * Fails the integration run if it leaves a test database behind.
 *
 * Every file drops the database it created, and for months eleven of the
 * fifteen did not in fact end up without one: 167 of them had piled up on the
 * local throwaway server by day 20. Each held only empty collections and their
 * indexes -- Mongoose's automatic index builds, still running when the drop
 * went through, recreated the database a moment later. Nothing failed, so
 * nothing said so.
 *
 * The check is taken here, once, after every file has finished, rather than in
 * each file's teardown: a recreation lands milliseconds after the drop, so a
 * per-file check could pass while the database it just checked reappeared
 * behind it. Only databases that did not exist when the run began count, so a
 * pile left by an older checkout does not fail a clean run.
 */
const PREFIX = 'deftrack_itest_';

async function testDatabases(uri: string): Promise<string[]> {
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
    return databases.map((d) => d.name).filter((name) => name.startsWith(PREFIX));
  } finally {
    await client.close();
  }
}

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const uri = process.env.MONGODB_TEST_URI;
  // Without a server the suite skips itself, and says why; nothing to check.
  if (!uri) return undefined;
  const before = new Set(await testDatabases(uri));

  return async function teardown(): Promise<void> {
    const leaked = (await testDatabases(uri)).filter((name) => !before.has(name));
    if (leaked.length > 0) {
      // Measured: vitest prints an error thrown here as "error during close"
      // and still exits 0, which in CI is a pass. The exit code is what fails
      // the run; the error is what says why.
      process.exitCode = 1;
      throw new Error(
        `the integration run left ${leaked.length} test database(s) behind: ${leaked.join(', ')}. ` +
          'A drop that runs while an index build is still going is undone by the build.'
      );
    }
  };
}
