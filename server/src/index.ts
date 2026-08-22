/**
 * devnet.deftrack API server.
 *
 * Phase 1: chain indexing. The QuorumRound collector, the DevnetOperator model
 * and the v1 routes follow.
 */
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import mongoose from 'mongoose';
import { DEVNET_NAME, type ApiEnvelope } from '@devnet-deftrack/shared';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { rpc } from './services/rpc.service.js';
import { syncService } from './services/sync.service.js';
import { quorumRoundService } from './services/quorumRound.service.js';
import { QuorumRound } from './models/QuorumRound.js';
import { SyncState } from './models/SyncState.js';
import { Block } from './models/Block.js';
import v1Routes from './routes/v1/index.js';
import { sendError } from './utils/http.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.corsOrigins }));

app.use('/api/v1', v1Routes);

app.get('/api/v1/health', async (_req, res) => {
  const [state, indexedBlocks, tip, roundsFormed, roundsFailed, roundsPending] = await Promise.all([
    SyncState.findOne({ key: 'blocks' }).lean().catch(() => null),
    Block.estimatedDocumentCount().catch(() => -1),
    rpc.getBlockCount().catch(() => -1),
    QuorumRound.countDocuments({ status: 'formed' }).catch(() => -1),
    QuorumRound.countDocuments({ status: 'failed' }).catch(() => -1),
    QuorumRound.countDocuments({ status: 'pending' }).catch(() => -1),
  ]);

  const body: ApiEnvelope<{
    status: string;
    devnet: string;
    uptimeSeconds: number;
    mongo: string;
    chainTip: number;
    indexedHeight: number;
    indexedBlocks: number;
    behind: number;
    rounds: { formed: number; failed: number; pending: number };
  }> = {
    success: true,
    data: {
      status: 'ok',
      devnet: DEVNET_NAME,
      uptimeSeconds: Math.round(process.uptime()),
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      chainTip: tip,
      indexedHeight: state?.lastSyncedHeight ?? -1,
      indexedBlocks,
      behind: tip >= 0 && state ? Math.max(0, tip - state.lastSyncedHeight) : -1,
      rounds: { formed: roundsFormed, failed: roundsFailed, pending: roundsPending },
    },
  };
  res.json(body);
});

// Anything unmatched under /api gets the same envelope as everything else,
// rather than Express's HTML 404 page.
app.use('/api', (_req, res) => sendError(res, 404, 'not found'));

async function main(): Promise<void> {
  await connectDatabase();

  const info = await rpc.getBlockchainInfo();
  logger.info(`Node reachable: chain=${info.chain} tip=${info.blocks}`);
  if (info.chain !== `devnet-${DEVNET_NAME}`) {
    throw new Error(`Refusing to index chain "${info.chain}"; expected "devnet-${DEVNET_NAME}"`);
  }

  syncService.start();
  quorumRoundService.start();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`devnet.deftrack server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    syncService.stop();
    quorumRoundService.stop();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error(`Fatal startup error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
