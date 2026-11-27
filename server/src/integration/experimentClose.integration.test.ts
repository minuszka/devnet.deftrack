import type { Server } from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Block } from '../models/Block.js';
import { ExperimentRun } from '../models/ExperimentRun.js';
import { QuorumRound } from '../models/QuorumRound.js';
import { ServiceEpoch } from '../models/ServiceEpoch.js';
import { SyncState } from '../models/SyncState.js';
import { blockHash, blockRow } from './fixtures.js';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI } from './mongo.js';

const start = 100;
const end = 110;
function epoch(height: number) {
  return { epochKey: `dsl:${height / 5 - 1}`, epoch: height / 5 - 1, boundaryHeight: height,
    boundaryBlockHash: blockHash(height), status: height === 105 ? 'absent' : 'committed', missedCount: height === 105 ? null : 0 };
}

function latch() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

describe.skipIf(!HAVE_MONGO)('freezing and withdrawing a published experiment', () => {
  let server: Server;
  let url: string;
  let rpc: typeof import('../services/rpc.service.js').rpc;
  const headers = { 'x-admin-api-key': 'integration-only', 'content-type': 'application/json' };
  const close = (height = end, extra: Record<string, unknown> = {}) =>
    fetch(url + '/close', { method: 'POST', headers, body: JSON.stringify({ endHeight: height, ...extra }) });
  const withdraw = () => fetch(url, { method: 'DELETE', headers });

  beforeAll(async () => {
    const db = await connectTestMongo('close');
    vi.stubEnv('MONGODB_URI', MONGO_URI + '/' + db);
    vi.stubEnv('ADMIN_API_KEY', headers['x-admin-api-key']);
    vi.stubEnv('DSL_ACTIVATION_HEIGHT', '5');
    vi.stubEnv('DSL_EPOCH_INTERVAL', '5');
    vi.stubEnv('TRACKED_LLMQ_NAMES', 'llmq_50_60');
    ({ rpc } = await import('../services/rpc.service.js'));
    const { default: routes } = await import('../routes/v1/admin.v1.routes.js');
    const app = express().use(express.json()).use('/admin', routes);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected a TCP port');
    url = `http://127.0.0.1:${addr.port}/admin/experiments/test`;
    await Block.insertMany(Array.from({ length: end - start + 1 }, (_, i) => blockRow(start + i)));
  });
  beforeEach(async () => {
    vi.spyOn(rpc, 'getBlockCount').mockResolvedValue(end);
    vi.spyOn(rpc, 'getBlockHash').mockImplementation(async (height) => blockHash(height));
    await ExperimentRun.create({ runKey: 'test', title: 'Test', startedAt: new Date(), startHeight: start,
      nodeVersion: 'test', llmqName: 'llmq_50_60', llmqSize: 50, llmqMinSize: 30, llmqThreshold: 30, dkgInterval: 24 });
    await SyncState.insertMany(['blocks', 'mndiff'].map((key) => ({ key, lastSyncedHeight: end })));
    await ServiceEpoch.insertMany([100, 105, 110].map(epoch));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([ExperimentRun.deleteMany({}), SyncState.deleteMany({}), ServiceEpoch.deleteMany({})]);
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await dropTestMongo();
    vi.unstubAllEnvs();
  });

  it('keeps the run open through index, list-diff and interior Sentinel gaps, then freezes the complete result', async () => {
    await SyncState.updateMany({}, { lastSyncedHeight: start });
    await ServiceEpoch.deleteOne({ boundaryHeight: 105 });
    for (const key of ['blocks', 'mndiff']) {
      const reply = await close();
      expect(reply.status).toBe(409);
      expect(await reply.json()).toMatchObject({ success: false, error: expect.stringContaining(`${key} indexed to 100`) });
      await SyncState.updateOne({ key }, { lastSyncedHeight: end });
    }
    const gap = await close();
    expect(gap.status).toBe(409);
    expect(await gap.json()).toMatchObject({ success: false, error: expect.stringContaining('Sentinel epoch at height 105') });
    expect(await ExperimentRun.findOne({ runKey: 'test' }).lean()).toMatchObject({ status: 'running', outcome: null, endHeight: null });
    await ServiceEpoch.create(epoch(105));
    await ServiceEpoch.updateOne({ boundaryHeight: 110 }, { missedCount: null });
    const unknown = await close();
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toMatchObject({ error: expect.stringContaining('Missing Sentinel missed count at height 110') });
    await ServiceEpoch.updateOne({ boundaryHeight: 110 }, { missedCount: 0 });
    expect((await close()).status).toBe(200);
    expect(await ExperimentRun.findOne({ runKey: 'test' }).lean()).toMatchObject({
      status: 'closed', endHeight: end, outcome: { blocks: 11, dsl: { epochs: 3, committed: 2, absent: 1 }, unobserved: [] },
    });
  });

  it('publishes a window with evidence no collector can write any more only on the operator word', async () => {
    // At tip 168 llmq_50_60 (two active quorums) plans nothing below 168 - 48 = 120,
    // so the round at 96 can never be written.
    vi.mocked(rpc.getBlockCount).mockResolvedValue(168);
    await ExperimentRun.updateOne({ runKey: 'test' }, { startHeight: 96 });
    await Block.insertMany([96, 97, 98, 99].map((height) => blockRow(height)));
    try {
      const refused = await close(100);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        error: expect.stringMatching(/can no longer be collected: Missing quorum round 1:96:0\b.*acceptUnobserved true/),
      });
      expect(await ExperimentRun.findOne().lean()).toMatchObject({ status: 'running', outcome: null });
      const accepted = await close(100, { acceptUnobserved: true });
      expect(accepted.status).toBe(200);
      expect(await ExperimentRun.findOne().lean()).toMatchObject({
        status: 'closed', endHeight: 100,
        outcome: { unobserved: [{ kind: 'quorum-round', height: 96, roundKey: '1:96:0', reason: 'missing' }] },
      });
    } finally {
      await Block.deleteMany({ height: { $lt: start } });
    }
  });

  it('never lets the operator waive evidence that is still on its way', async () => {
    await ExperimentRun.updateOne({ runKey: 'test' }, { startHeight: 96 });
    await Block.insertMany([96, 97, 98, 99].map((height) => blockRow(height)));
    try {
      const reply = await close(100, { acceptUnobserved: true });
      expect(reply.status).toBe(409);
      expect(await reply.json()).toMatchObject({
        error: expect.stringMatching(/^Missing quorum round 1:96:0\. Retry with endHeight 100/),
      });
      expect(await ExperimentRun.findOne().lean()).toMatchObject({ status: 'running', outcome: null });
    } finally {
      await Block.deleteMany({ height: { $lt: start } });
    }
  });

  it('requires a scheduled round, accepts a genuinely pending one and waits for missing member details', async () => {
    // 96 starts a 24-block round; at 100 its mining window is still open.
    await ExperimentRun.updateOne({ runKey: 'test' }, { startHeight: 96 });
    await Block.insertMany([96, 97, 98, 99].map((height) => blockRow(height)));
    try {
      const missing = await close(100);
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ error: expect.stringContaining('Missing quorum round') });
      const round = await QuorumRound.create({
        roundKey: '1:96:0', llmqType: 1, llmqName: 'llmq_50_60', expectedHeight: 96,
        size: 50, minSize: 30, threshold: 30, dkgInterval: 24, formed: true, status: 'formed', detailsComplete: false,
      });
      const partial = await close(100);
      expect(partial.status).toBe(409);
      expect(await partial.json()).toMatchObject({ error: expect.stringContaining('member details') });
      await QuorumRound.updateOne({ _id: round._id }, { status: 'pending', formed: false });
      expect((await close(100)).status).toBe(200);
      expect(await ExperimentRun.findOne().lean()).toMatchObject({ outcome: { rounds: { pending: 1 } } });
    } finally {
      await QuorumRound.deleteMany({});
      await Block.deleteMany({ height: { $lt: start } });
    }
  });

  it('rejects a stale indexed branch even when both cursors reached the cutoff', async () => {
    vi.mocked(rpc.getBlockHash).mockResolvedValueOnce(blockHash(end + 1));
    expect((await close()).status).toBe(409);
    expect((await ExperimentRun.findOne())?.outcome).toBeNull();
  });

  it('preserves the first published window when two closes overlap', async () => {
    const reached = latch(), resume = latch();
    vi.mocked(rpc.getBlockHash).mockImplementationOnce(async (height) => {
      reached.release();
      await resume.wait;
      return blockHash(height);
    });
    const later = close();
    try {
      await reached.wait;
      expect((await close(105)).status).toBe(200);
    } finally { resume.release(); }
    expect((await later).status).toBe(409);
    expect(await ExperimentRun.findOne().lean()).toMatchObject({ endHeight: 105, outcome: { blocks: 6 } });
  });

  it('refuses a withdrawal that read the open run before close published it', async () => {
    const reached = latch(), resume = latch();
    const remove = ExperimentRun.deleteOne.bind(ExperimentRun);
    vi.spyOn(ExperimentRun, 'deleteOne').mockImplementationOnce((filter) => remove(filter).pre(async () => {
      reached.release();
      await resume.wait;
    }));
    const deleting = withdraw();
    try {
      await reached.wait;
      expect((await close()).status).toBe(200);
    } finally { resume.release(); }
    expect((await deleting).status).toBe(409);
    expect(await ExperimentRun.findOne().lean()).toMatchObject({ status: 'closed', outcome: { blocks: 11 } });
  });

  it('cannot close or recreate a run withdrawn during computation', async () => {
    const reached = latch(), resume = latch();
    vi.mocked(rpc.getBlockHash).mockImplementationOnce(async (height) => {
      reached.release();
      await resume.wait;
      return blockHash(height);
    });
    const closing = close();
    try {
      await reached.wait;
      expect((await withdraw()).status).toBe(200);
    } finally { resume.release(); }
    expect((await closing).status).toBe(409);
    expect(await ExperimentRun.countDocuments()).toBe(0);
  });
});
