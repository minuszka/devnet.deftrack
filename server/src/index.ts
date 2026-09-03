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
import { masternodePollerService } from './services/masternodePoller.service.js';
import { chainLockService } from './services/chainLock.service.js';
import { zmqService } from './services/zmq.service.js';
import { mnListDiffService } from './services/mnListDiff.service.js';
import { seedStatusService } from './services/seedStatus.service.js';
import { QuorumRound } from './models/QuorumRound.js';
import { SyncState } from './models/SyncState.js';
import { Block } from './models/Block.js';
import { MasternodeState } from './models/MasternodeState.js';
import v1Routes from './routes/v1/index.js';
import { sendError } from './utils/http.js';
import { evaluateReadiness } from './domain/readiness.js';
import { currentParticipants } from './services/experiment.service.js';
import { metricsService } from './services/metrics.service.js';
import {
  initializeSimulationPersistenceIndexes,
  MongoSimulationPersistenceRepository,
} from './services/simulationMongo.repository.js';
import { SimulationPersistenceService } from './services/simulationPersistence.service.js';
import { SimulationReconcileService } from './services/simulationReconcile.service.js';
import { defaultActionDispatcher } from './routes/v1/simulationAdmin.v1.routes.js';
import { SimulationObservationService } from './services/simulationObservation.service.js';
import { SimulationMeasurementService } from './services/simulationMeasurement.service.js';
import { MongoSimulationMeasurementRepository } from './services/simulationMeasurementMongo.repository.js';
import { SIMULATION_CONTROL_POLICY } from './simulator/simulationPolicy.js';

/**
 * Blocks the staker count looks back over. Stated in the response so a reader
 * knows what "active" means here -- it is a window, not a registry.
 */
const STAKER_WINDOW = 200;

const app = express();

app.disable('x-powered-by');
// nginx terminates TLS on the same host and forwards X-Forwarded-For. Without
// this the rate limiter throws on every proxied request and, when it does not,
// keys every visitor to nginx's own address -- one bucket for the whole world.
// 'loopback' and not `true`: only the local proxy may claim to speak for a
// client, or anyone could set the header and pick their own bucket.
app.set('trust proxy', 'loopback');
app.use(helmet());
app.use(compression());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '256kb' }));

app.use('/api/v1', v1Routes);

app.get('/api/v1/health', async (_req, res) => {
  const [state, indexedBlocks, tip, roundsFormed, roundsFailed, roundsPending, roundsImpossible, net, mnTotal, mnEnabled] =
    await Promise.all([
      SyncState.findOne({ key: 'blocks' }).lean().catch(() => null),
      Block.estimatedDocumentCount().catch(() => -1),
      rpc.getBlockCount().catch(() => -1),
      QuorumRound.countDocuments({ status: 'formed' }).catch(() => -1),
      QuorumRound.countDocuments({ status: 'failed' }).catch(() => -1),
      QuorumRound.countDocuments({ status: 'pending' }).catch(() => -1),
      // Rounds of a profile needing more members than the network has. Reported
      // apart from failures so the two are never read as one number.
      QuorumRound.countDocuments({ status: 'impossible' }).catch(() => -1),
      rpc.getNetworkInfo().catch(() => null),
      // active only: a row that left `protx list registered` is history, not
      // part of the current network size.
      MasternodeState.countDocuments({ active: { $ne: false } }).catch(() => -1),
      MasternodeState.countDocuments({ active: { $ne: false }, banned: false }).catch(() => -1),
    ]);

  // How many machines actually produced a block recently. There is no RPC for
  // "who is staking" network-wide -- getstakinginfo speaks only for this node --
  // so this is derived from who paid the coinstakes.
  //
  // The same helper the experiment records use, deliberately: this figure and
  // the one on the staking page were computed separately and drifted, so the
  // banner read 27 producers while the page read 9 machines. One definition,
  // one code path.
  const stakers =
    tip >= 0 ? await currentParticipants(tip).then((p) => p.stakers).catch(() => -1) : -1;

  const readiness = evaluateReadiness({
    mongoConnected: mongoose.connection.readyState === 1,
    chainTip: tip,
    indexedHeight: state?.lastSyncedHeight ?? -1,
    syncError: state?.error ?? null,
    lastSyncedAtMs: state?.lastSyncedAt ? new Date(state.lastSyncedAt).getTime() : null,
    nowMs: Date.now(),
    syncIntervalMs: config.sync.intervalMs,
  });

  const body: ApiEnvelope<{
    status: string;
    failing: string[];
    devnet: string;
    uptimeSeconds: number;
    mongo: string;
    chainTip: number;
    indexedHeight: number;
    indexedBlocks: number;
    behind: number;
    rounds: { formed: number; failed: number; pending: number; impossible: number };
    nodeVersion: string;
    masternodes: { total: number; enabled: number };
    stakers: { active: number; windowBlocks: number };
    observation: { zmq: ReturnType<typeof zmqService.stats> };
  }> = {
    // success reports whether the request was served, readiness whether the
    // service can be trusted -- they are different questions.
    success: true,
    data: {
      status: readiness.status,
      failing: readiness.failing,
      devnet: DEVNET_NAME,
      uptimeSeconds: Math.round(process.uptime()),
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      chainTip: tip,
      indexedHeight: state?.lastSyncedHeight ?? -1,
      indexedBlocks,
      behind: tip >= 0 && state ? Math.max(0, tip - state.lastSyncedHeight) : -1,
      rounds: {
        formed: roundsFormed,
        failed: roundsFailed,
        pending: roundsPending,
        impossible: roundsImpossible,
      },
      // "/DeFCoN:22.1.4(devnet.devnet-defcon-q60)/" -> "22.1.4"
      nodeVersion: net?.subversion?.match(/:([0-9.]+)/)?.[1] ?? 'unknown',
      masternodes: { total: mnTotal, enabled: mnEnabled },
      stakers: { active: stakers, windowBlocks: STAKER_WINDOW },
      // Where the timings came from and how much of the stream was lost --
      // a number is only as good as the collection behind it.
      observation: { zmq: zmqService.stats() },
    },
  };
  res.status(readiness.httpStatus).json(body);
});

// Anything unmatched under /api gets the same envelope as everything else,
// rather than Express's HTML 404 page.
app.use('/api', (_req, res) => sendError(res, 404, 'not found'));

async function main(): Promise<void> {
  await connectDatabase();
  await initializeSimulationPersistenceIndexes();
  metricsService.start();

  const info = await rpc.getBlockchainInfo();
  logger.info(`Node reachable: chain=${info.chain} tip=${info.blocks}`);
  if (info.chain !== `devnet-${DEVNET_NAME}`) {
    throw new Error(`Refusing to index chain "${info.chain}"; expected "devnet-${DEVNET_NAME}"`);
  }

  syncService.start();
  quorumRoundService.start();
  masternodePollerService.start();
  mnListDiffService.start();
  chainLockService.start();
  zmqService.start();
  seedStatusService.start();

  const simulationReconcileRepository = new MongoSimulationPersistenceRepository();
  const simulationReconcileService = new SimulationReconcileService(
    new SimulationPersistenceService(simulationReconcileRepository),
    (nowMs) => simulationReconcileRepository.findReconcilableRunKeys(nowMs),
    { logger }
  );
  simulationReconcileService.start();

  // Nothing entered `observing` and nothing finalized a measurement, so a run
  // could go from arming to cooldown and produce no result at all. Both steps are
  // height-driven, so they are swept rather than timed.
  const simulationObservationService = new SimulationObservationService(
    new SimulationPersistenceService(simulationReconcileRepository),
    new SimulationMeasurementService(new MongoSimulationMeasurementRepository()),
    {
      findObservationCandidates: () => simulationReconcileRepository.findObservationCandidateRunKeys(),
      findFinalizeCandidates: () => simulationReconcileRepository.findFinalizeCandidateRunKeys(),
      chainTip: async () => {
        const height = await rpc.getBlockCount();
        return { height, hash: await rpc.getBlockHash(height) };
      },
      warmupBlocks: SIMULATION_CONTROL_POLICY.measurement.warmupBlocks,
      logger,
    }
  );
  simulationObservationService.start();
  // Performs the actions a plan scheduled for after activation -- a flapping
  // cycle, a staggered reconnect. Without it the executor refuses any plan whose
  // actions are not all immediate, because collapsing a cycle into a single stop
  // would report every action applied while measuring none of them.
  defaultActionDispatcher.start();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`devnet.deftrack server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    syncService.stop();
    quorumRoundService.stop();
    masternodePollerService.stop();
    mnListDiffService.stop();
    chainLockService.stop();
    await zmqService.stop();
    seedStatusService.stop();
    simulationReconcileService.stop();
    metricsService.stop();
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
