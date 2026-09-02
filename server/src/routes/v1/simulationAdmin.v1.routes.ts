import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { requireAdminApiKey } from '../../middleware/requireAdminApiKey.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { MongoSimulationControlPersistenceRepository } from '../../services/simulationControlMongo.repository.js';
import { SimulationControlPersistenceService } from '../../services/simulationControlPersistence.service.js';
import {
  SimulationControlError,
  SimulationControlService,
} from '../../services/simulationControl.service.js';
import { SimulationControlPersistenceError } from '../../services/simulationControlPersistence.service.js';
import { SimulationStateError } from '../../domain/simulationRunState.js';
import { MongoRpcSimulationEvidenceService } from '../../services/simulationEvidence.service.js';
import { MongoSimulationPersistenceRepository } from '../../services/simulationMongo.repository.js';
import {
  SimulationPersistenceError,
  SimulationPersistenceService,
} from '../../services/simulationPersistence.service.js';
import { sendData, sendError } from '../../utils/http.js';
import { DockerLiveExecutor, dockerLabProbes } from '../../simulator/dockerLiveExecutor.js';
import {
  InvalidNetemTargetError,
  UnscheduledLiveFaultError,
  UnsupportedLiveFaultError,
} from '../../simulator/liveExecutorPlan.js';
import { fileCommandQueue } from '../../simulator/netemWrapperHost.js';

const runKeySchema = z.string().regex(/^sim_[0-9a-f]{32}$/);
const createSchema = z.object({
  network: z.enum(['regtest', 'devnet']).default('devnet'),
  mode: z.enum(['dry-run', 'live']).default('dry-run'),
  scenario: z.unknown(),
}).strict();
const armSchema = z.object({
  acknowledgedRiskClass: z.enum(['low', 'medium', 'high']),
}).strict();
const emptySchema = z.object({}).strict();

function statusFor(error: unknown): number {
  if (error instanceof SimulationControlError) {
    switch (error.code) {
      case 'RUN_NOT_FOUND': return 404;
      case 'INVALID_REQUEST': return 400;
      case 'APPROVAL_DENIED': return 403;
      case 'INVALID_STATE':
      case 'PREFLIGHT_FAILED': return 409;
      case 'EXECUTOR_NOT_AVAILABLE': return 503;
      case 'EXECUTOR_NETWORK_FORBIDDEN': return 403;
      case 'CORRUPT_ARTIFACT': return 500;
    }
  }
  // A deliberate refusal by the executor is the caller's answer, not a server
  // fault: reported as 500 these are indistinguishable from a bug, and with a
  // second fault class operators meet them routinely.
  if (
    error instanceof UnsupportedLiveFaultError ||
    error instanceof UnscheduledLiveFaultError ||
    error instanceof InvalidNetemTargetError
  ) {
    return 422;
  }
  if (error instanceof SimulationPersistenceError) {
    return error.code === 'RUN_NOT_FOUND' ? 404 : 409;
  }
  if (error instanceof SimulationControlPersistenceError || error instanceof SimulationStateError) return 409;
  if (error instanceof z.ZodError) return 400;
  return 500;
}

function publicControlMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
  }
  if (
    error instanceof SimulationControlError ||
    error instanceof SimulationPersistenceError ||
    error instanceof SimulationControlPersistenceError ||
    error instanceof SimulationStateError ||
    // A deliberate executor refusal answers 422, and used to carry the body
    // "internal error" -- which is worse than the 500 it replaced: it blames the
    // caller and then refuses to say what for. These messages name the fault kind
    // or the target and carry no host identity.
    error instanceof UnsupportedLiveFaultError ||
    error instanceof UnscheduledLiveFaultError ||
    error instanceof InvalidNetemTargetError
  ) {
    return error.message;
  }
  return 'internal error';
}

type ControlHandler = (req: Request, res: Response) => Promise<void>;
function controlRoute(handler: ControlHandler) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendError(res, statusFor(error), publicControlMessage(error));
    });
  };
}

function idempotencyKey(req: Request): string {
  const value = req.get('x-idempotency-key') ?? '';
  if (value.trim().length < 8 || value.length > 200) {
    throw new SimulationControlError(
      'INVALID_REQUEST',
      'X-Idempotency-Key must contain 8-200 characters'
    );
  }
  return value;
}

function runKey(req: Request): string {
  return runKeySchema.parse(String(req.params.runKey ?? ''));
}

export function createSimulationAdminRouter(service: SimulationControlService): Router {
  const router = Router();
  router.use(rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  }));
  router.use(requireAdminApiKey);
  router.use(withCachePolicy('no-store'));
  router.use((req, res, next) => {
    // The current API-key contract is deliberately non-browser. Day 10 may
    // add session + CSRF tokens on a separate adapter without weakening this.
    if (req.get('origin') || req.get('cookie')) {
      sendError(res, 403, 'browser credentials are not accepted by the simulator CLI API');
      return;
    }
    if (req.get('x-simulation-client') !== 'deftrack-cli-v1') {
      sendError(res, 400, 'X-Simulation-Client: deftrack-cli-v1 is required');
      return;
    }
    next();
  });

  router.get('/scenarios', controlRoute(async (_req, res) => {
    sendData(res, { items: service.scenarios() });
  }));

  router.post('/runs', controlRoute(async (req, res) => {
    const body = createSchema.parse(req.body);
    const result = await service.create({
      idempotencyKey: idempotencyKey(req),
      network: body.network,
      live: body.mode === 'live',
      scenario: body.scenario,
    });
    res.status(result.idempotentReplay ? 200 : 201);
    sendData(res, result);
  }));

  router.post('/runs/:runKey/validate', controlRoute(async (req, res) => {
    emptySchema.parse(req.body ?? {});
    sendData(res, await service.validate({ runKey: runKey(req), idempotencyKey: idempotencyKey(req) }));
  }));

  router.get('/runs/:runKey/dry-run', controlRoute(async (req, res) => {
    sendData(res, await service.dryRun(runKey(req)));
  }));

  router.post('/runs/:runKey/arm', controlRoute(async (req, res) => {
    const body = armSchema.parse(req.body);
    sendData(res, await service.arm({
      runKey: runKey(req),
      idempotencyKey: idempotencyKey(req),
      acknowledgedRiskClass: body.acknowledgedRiskClass,
    }));
  }));

  for (const [path, invoke] of [
    ['start', (key: string, idem: string) => service.start({ runKey: key, idempotencyKey: idem })],
    ['abort', (key: string, idem: string) => service.abort({ runKey: key, idempotencyKey: idem })],
    ['recover', (key: string, idem: string) => service.recover({ runKey: key, idempotencyKey: idem })],
  ] as const) {
    router.post(`/runs/:runKey/${path}`, controlRoute(async (req, res) => {
      emptySchema.parse(req.body ?? {});
      sendData(res, await invoke(runKey(req), idempotencyKey(req)));
    }));
  }

  router.get('/runs/:runKey', controlRoute(async (req, res) => {
    sendData(res, await service.status(runKey(req)));
  }));
  router.get('/runs/:runKey/history', controlRoute(async (req, res) => {
    sendData(res, await service.history(runKey(req)));
  }));
  return router;
}

/**
 * The live lab executor, or undefined so the control slots stay fail-closed.
 *
 * It exists only when explicitly enabled and given a wrapper command directory:
 * the control service already refuses any run that is not on the lab network, and
 * this is the second lock -- an unconfigured deployment has no executor at all,
 * not a misconfigured one that could reach a host.
 */
function buildLabExecutor(): DockerLiveExecutor | undefined {
  if (!config.simulator.labExecutorEnabled) return undefined;
  if (config.simulator.labWrapperCommandDir === '') {
    throw new Error('SIMULATION_LAB_EXECUTOR_ENABLED needs SIMULATION_LAB_WRAPPER_COMMANDS');
  }
  return new DockerLiveExecutor(
    fileCommandQueue(config.simulator.labWrapperCommandDir),
    dockerLabProbes(config.simulator.labDockerBin)
  );
}

const defaultService = new SimulationControlService(
  new SimulationPersistenceService(new MongoSimulationPersistenceRepository()),
  new SimulationControlPersistenceService(new MongoSimulationControlPersistenceRepository()),
  new MongoRpcSimulationEvidenceService(),
  {
    actor: {
      actorId: config.simulator.adminActorId,
      actorType: 'admin-session',
      displayName: null,
    },
    role: config.simulator.adminRole,
  },
  Date.now,
  buildLabExecutor()
);

export default createSimulationAdminRouter(defaultService);
