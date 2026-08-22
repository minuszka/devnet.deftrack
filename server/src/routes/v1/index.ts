import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import quorumRoundRoutes from './quorumRounds.v1.routes.js';
import operatorRoutes from './operators.v1.routes.js';
import masternodeRoutes from './masternodes.v1.routes.js';

const router = Router();

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Aggregations scan every round in the window, so they get a tighter budget
// than the plain listings.
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(apiLimiter);
router.use('/quorum-rounds/health-timeline', heavyLimiter);
router.use('/operators/reliability', heavyLimiter);
router.use('/masternodes/ban-waves', heavyLimiter);

router.use('/quorum-rounds', quorumRoundRoutes);
router.use('/operators', operatorRoutes);
router.use('/masternodes', masternodeRoutes);

export default router;
