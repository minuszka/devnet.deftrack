import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { rpc } from './services/rpc.service.js';
import { syncService } from './services/sync.service.js';
import { masternodePollerService } from './services/masternodePoller.service.js';
import { mnListDiffService } from './services/mnListDiff.service.js';
import { quorumRoundService } from './services/quorumRound.service.js';
import { assertLabChain, assertLabDatabaseIsolated } from './domain/labIsolation.js';
import { EXECUTOR_LAB_NETWORK } from './services/simulationControl.service.js';
import simulationAdminRoutes from './routes/v1/simulationAdmin.v1.routes.js';
import peersRoutes from './routes/v1/peers.v1.routes.js';
import {
  initializeSimulationPersistenceIndexes,
  MongoSimulationPersistenceRepository,
} from './services/simulationMongo.repository.js';
import { SimulationPersistenceService } from './services/simulationPersistence.service.js';
import { SimulationReconcileService } from './services/simulationReconcile.service.js';
import { SimulationObservationService } from './services/simulationObservation.service.js';
import { SimulationMeasurementService } from './services/simulationMeasurement.service.js';
import { MongoSimulationMeasurementRepository } from './services/simulationMeasurementMongo.repository.js';
import { SIMULATION_CONTROL_POLICY } from './simulator/simulationPolicy.js';
import { sendError } from './utils/http.js';

/**
 * The simulator lab's own entrypoint.
 *
 * The explorer refuses to index anything but the devnet chain, and the live
 * executor refuses to act on anything but the lab network. Both rules are right,
 * and together they left the live path impassable end to end: on devnet the
 * server started and the executor refused; on regtest the executor would have
 * acted and the server refused to start. The manual Docker acceptance script did
 * not catch it because it calls the executor directly, stepping over the API, the
 * control service and Mongo -- a green check on a path nobody can walk.
 *
 * So the lab gets a process rather than a flag. A mode switch on the explorer
 * would weaken the single guard that stops it ingesting a foreign chain, and it
 * is exactly the kind of switch that is set wrong on a host once and never
 * noticed.
 *
 * It composes the simulation control API, its persistence, its reconcile sweep,
 * the observation ingest, and the collectors the preflight reads -- against the
 * lab chain and the lab's OWN database, so nothing here can read or write the
 * devnet record. ZMQ and the public explorer views stay out: the lab has no use
 * for them.
 *
 * The collectors are here because the preflight requires their output, and a
 * gate nothing can pass is worse than no gate. `explorer-synced` reads SyncState
 * and indexed blocks; `target-resolved` needs a MasternodeState row before a
 * masternode target can be resolved at all; the quorum and baseline checks read
 * QuorumRound. The first version of this file started none of them, on the
 * reasoning that isolation demanded it -- but isolation is the separate
 * database's job, not the collectors' absence.
 */

async function main(): Promise<void> {
  // Before anything opens a connection: the lab must have a database of its own.
  assertLabDatabaseIsolated({ labUri: config.lab.mongoUri, explorerUri: config.mongoUri });

  await connectDatabase(config.lab.mongoUri);
  await initializeSimulationPersistenceIndexes();

  const info = await rpc.getBlockchainInfo();
  logger.info(`Lab node reachable: chain=${info.chain} tip=${info.blocks}`);
  // The mirror of the explorer's guard, and of the executor's network refusal.
  // The same constant feeds all three, so they cannot drift apart.
  assertLabChain(info.chain, EXECUTOR_LAB_NETWORK);

  const reconcileRepository = new MongoSimulationPersistenceRepository();
  const reconcileService = new SimulationReconcileService(
    new SimulationPersistenceService(reconcileRepository),
    (nowMs) => reconcileRepository.findReconcilableRunKeys(nowMs),
    { logger }
  );
  reconcileService.start();
  // The lab needs this more than the devnet does: a scenario suite is only a
  // suite if each run ends in a report that can be compared with the next.
  const observationService = new SimulationObservationService(
    new SimulationPersistenceService(reconcileRepository),
    new SimulationMeasurementService(new MongoSimulationMeasurementRepository()),
    {
      findObservationCandidates: () => reconcileRepository.findObservationCandidateRunKeys(),
      findFinalizeCandidates: () => reconcileRepository.findFinalizeCandidateRunKeys(),
      chainTip: async () => {
        const height = await rpc.getBlockCount();
        return { height, hash: await rpc.getBlockHash(height) };
      },
      warmupBlocks: SIMULATION_CONTROL_POLICY.measurement.warmupBlocks,
      logger,
    }
  );
  observationService.start();
  // Indexes the LAB chain into the LAB database. The devnet record is out of
  // reach by construction: this process never opened that connection.
  syncService.start();
  // What the preflight reads: masternode identity and state, the deterministic
  // list diff behind it, and the DKG rounds the baseline is measured over.
  masternodePollerService.start();
  mnListDiffService.start();
  quorumRoundService.start();

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '64kb' }));
  // No CORS: the lab API is driven by the CLI on the lab host, never a browser
  // on another origin.
  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { lab: true, chain: info.chain, network: EXECUTOR_LAB_NETWORK } });
  });
  app.use('/api/v1/simulations', simulationAdminRoutes);
  // The observation ingest, so lab telemetry arrives by the SAME path the fleet
  // uses. The preflight's observer-fresh check then measures the same thing here
  // as it does on the devnet; a lab that synthesised HostStatus rows directly
  // would be forging the very signal the check exists to read.
  app.use('/api/v1/peers', peersRoutes);
  app.use((_req, res) => sendError(res, 404, 'not found'));

  const server = app.listen(config.lab.port, config.lab.host, () => {
    logger.info(`simulator lab listening on http://${config.lab.host}:${config.lab.port}`);
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, stopping the simulator lab`);
    reconcileService.stop();
    syncService.stop();
    masternodePollerService.stop();
    mnListDiffService.stop();
    quorumRoundService.stop();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error(`simulator lab failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
