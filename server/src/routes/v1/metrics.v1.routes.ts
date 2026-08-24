import { Router } from 'express';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { metricsService } from '../../services/metrics.service.js';
import { zmqService } from '../../services/zmq.service.js';
import { sendData } from '../../utils/http.js';

const router = Router();

/** GET /api/v1/metrics -- bounded in-process performance diagnostics. */
router.get('/', withCachePolicy('no-store'), (_req, res) => {
  sendData(res, metricsService.snapshot(zmqService.stats()));
});

export default router;
