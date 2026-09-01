import { Router } from 'express';
import { z } from 'zod';
import { SimulationRun } from '../../models/SimulationRun.js';
import { asyncRoute, page, parsedQuery, sendData, sendError, validateQuery } from '../../utils/http.js';
import {
  PUBLIC_SIMULATION_RUN_PROJECTION,
  toPublicSimulationRun,
  type PublicSimulationRunSource,
} from '../../simulator/simulationPublicDto.js';
import { SIMULATION_RUN_STATUSES } from '../../domain/simulationRunState.js';
import { MongoSimulationMeasurementRepository } from '../../services/simulationMeasurementMongo.repository.js';
import { SimulationMeasurementService } from '../../services/simulationMeasurement.service.js';
import { toPublicSimulationMeasurementResult } from '../../simulator/simulationMeasurementPublicDto.js';

const router = Router();
const measurementService = new SimulationMeasurementService(new MongoSimulationMeasurementRepository());
const runKeySchema = z.string().regex(/^sim_[0-9a-f]{32}$/);
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(SIMULATION_RUN_STATUSES).optional(),
}).strict();

/** GET /api/v1/simulations – public, redacted and read-only. */
router.get(
  '/',
  validateQuery(listSchema),
  asyncRoute(async (_req, res) => {
    const query = parsedQuery<z.infer<typeof listSchema>>(res);
    const filter = query.status === undefined ? {} : { 'state.status': query.status };
    const [rows, total] = await Promise.all([
      SimulationRun.find(filter)
        .sort({ createdAt: -1, runKey: 1 })
        .skip(query.offset)
        .limit(query.limit)
        .select(PUBLIC_SIMULATION_RUN_PROJECTION)
        .lean(),
      SimulationRun.countDocuments(filter),
    ]);
    sendData(res, page(rows.map((row) => toPublicSimulationRun(row as unknown as PublicSimulationRunSource)), total, query.limit, query.offset));
  })
);

/** GET /api/v1/simulations/:runKey/report – public aggregate, never private evidence. */
router.get(
  '/:runKey/report',
  asyncRoute(async (req, res) => {
    const parsed = runKeySchema.safeParse(req.params.runKey);
    if (!parsed.success) {
      sendError(res, 400, 'invalid simulation run key');
      return;
    }
    const record = await measurementService.latest(parsed.data);
    if (record === null) {
      sendError(res, 404, 'simulation measurement report not found');
      return;
    }
    sendData(res, toPublicSimulationMeasurementResult(record));
  })
);

/** GET /api/v1/simulations/:runKey – public, redacted and read-only. */
router.get(
  '/:runKey',
  asyncRoute(async (req, res) => {
    const parsed = runKeySchema.safeParse(req.params.runKey);
    if (!parsed.success) {
      sendError(res, 400, 'invalid simulation run key');
      return;
    }
    const row = await SimulationRun.findOne({ runKey: parsed.data })
      .select(PUBLIC_SIMULATION_RUN_PROJECTION)
      .lean();
    if (row === null) {
      sendError(res, 404, 'simulation run not found');
      return;
    }
    sendData(res, toPublicSimulationRun(row as unknown as PublicSimulationRunSource));
  })
);

export default router;
