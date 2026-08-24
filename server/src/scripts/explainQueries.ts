import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// npm workspaces normally starts this script in server/, while a direct tsx
// invocation starts it at the repository root. Load either without printing
// the URI or any credentials.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

mongoose.set('autoIndex', false);
await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });

const db = mongoose.connection.db;
if (!db) throw new Error('MongoDB connection has no database');

interface QueryProbe {
  name: string;
  collection: string;
  filter: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
const now = new Date();
const probes: QueryProbe[] = [
  {
    name: 'chainlocks',
    collection: 'blocks',
    filter: { isProofOfStake: true },
    sort: { height: -1 },
    limit: 500,
  },
  {
    name: 'transaction-list',
    collection: 'transactions',
    filter: {},
    sort: { height: -1, _id: -1 },
    limit: 100,
  },
  {
    name: 'quorum-list',
    collection: 'quorumrounds',
    filter: { llmqName: 'llmq_400_60', status: 'formed' },
    sort: { expectedHeight: -1 },
    limit: 50,
  },
  {
    name: 'quorum-reliability-7d',
    collection: 'quorumrounds',
    filter: { llmqName: 'llmq_400_60', status: 'formed', resolvedAt: { $gte: since } },
  },
  {
    name: 'payee-backfill',
    collection: 'blocks',
    filter: {
      paidProTxHash: null,
      payeeCheckedAt: null,
      height: { $gt: 0 },
      $or: [{ payeeRetryAt: null }, { payeeRetryAt: { $lte: now } }],
    },
    sort: { height: -1 },
    limit: 300,
  },
  {
    name: 'masternode-list',
    collection: 'masternodestates',
    filter: { active: { $ne: false } },
    sort: { banned: -1, poSePenalty: -1, registeredHeight: 1 },
    limit: 100,
  },
];

function planFacts(value: unknown, facts = { indexes: new Set<string>(), hasSort: false, hasCollscan: false }) {
  if (!value || typeof value !== 'object') return facts;
  const node = value as Record<string, unknown>;
  if (node.stage === 'SORT') facts.hasSort = true;
  if (node.stage === 'COLLSCAN') facts.hasCollscan = true;
  if (typeof node.indexName === 'string') facts.indexes.add(node.indexName);
  for (const child of Object.values(node)) planFacts(child, facts);
  return facts;
}

try {
  for (const probe of probes) {
    let cursor = db.collection(probe.collection).find(probe.filter, { projection: { _id: 1 } });
    if (probe.sort) cursor = cursor.sort(probe.sort);
    if (probe.limit) cursor = cursor.limit(probe.limit);

    const explanation = await cursor.explain('executionStats');
    const execution = explanation.executionStats;
    const facts = planFacts(explanation.queryPlanner?.winningPlan);
    process.stdout.write(
      `${JSON.stringify({
        query: probe.name,
        returned: execution?.nReturned ?? null,
        docsExamined: execution?.totalDocsExamined ?? null,
        keysExamined: execution?.totalKeysExamined ?? null,
        executionMs: execution?.executionTimeMillis ?? null,
        indexes: [...facts.indexes],
        inMemorySort: facts.hasSort,
        collectionScan: facts.hasCollscan,
      })}\n`
    );
  }
} finally {
  await mongoose.disconnect();
}
