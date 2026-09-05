import mongoose from 'mongoose';

/**
 * A real MongoDB for the tests that cannot be answered without one.
 *
 * Everything else in this suite runs against fakes, and should: they are fast
 * and they test our own logic. But three of the claims this project makes are
 * claims about the DATABASE, not about our code --
 *
 *   - `roundKey` is unique, so a restart cannot duplicate a round;
 *   - `$setOnInsert` keeps a first observation immutable;
 *   - `eventKey` makes the ban-event collector idempotent across restarts
 *     (CLAUDE.md says it "produces zero duplicates across restarts", audited,
 *     and until now nothing checked it).
 *
 * A fake repository cannot fail any of those, because a fake has no unique
 * index. It answers whatever it was written to answer, which is the definition
 * of a test that cannot fail.
 *
 * Where the server comes from: `MONGODB_TEST_URI`. CI runs a MongoDB service
 * container; locally, any throwaway instance will do -- and it must be a
 * throwaway, because these tests drop the database they create. They never
 * touch `deftrack_devnet`: the database name is generated per run, and a URI
 * naming the dev database is refused outright.
 */
const FORBIDDEN_DATABASES = ['deftrack_devnet', 'deftrack', 'deftrack_prod'];

export const MONGO_URI = process.env.MONGODB_TEST_URI ?? '';
export const HAVE_MONGO = MONGO_URI.length > 0;

/**
 * The message a skipped integration run prints. It says how to get one rather
 * than passing quietly, because a suite that silently skips is a suite that
 * silently stops being a gate.
 */
export const NO_MONGO_REASON =
  'MONGODB_TEST_URI is not set. CI always sets it (a MongoDB service container); ' +
  'locally, start a throwaway instance and export ' +
  'MONGODB_TEST_URI=mongodb://127.0.0.1:27018 to run these.';

/** Connect to a fresh, uniquely named database on the test server. */
export async function connectTestMongo(label: string): Promise<string> {
  if (!HAVE_MONGO) throw new Error(NO_MONGO_REASON);

  // Parsed rather than sliced with a regular expression: the first attempt cut
  // "mongodb://host:port" down to "mongodb:/" and the failure looked like a bad
  // environment variable rather than a bad test helper.
  const url = new URL(MONGO_URI);
  const named = url.pathname.replace(/^\//, '');
  if (FORBIDDEN_DATABASES.includes(named)) {
    throw new Error(
      `MONGODB_TEST_URI names ${named}. These tests drop the database they use; point them at a throwaway server.`
    );
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const dbName = `deftrack_itest_${label}_${suffix}`;
  url.pathname = `/${dbName}`;

  await mongoose.connect(url.toString(), { serverSelectionTimeoutMS: 5_000 });
  return dbName;
}

/**
 * Build the indexes the models declare.
 *
 * Mongoose creates indexes in the background at first use, and a test that
 * writes before they exist would pass against a collection with no unique
 * constraint at all -- proving the opposite of what it set out to prove.
 */
export async function syncIndexes(models: Array<{ syncIndexes: () => Promise<unknown> }>): Promise<void> {
  for (const model of models) await model.syncIndexes();
}

export async function dropTestMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
