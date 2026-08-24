import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import quorumRoundRoutes from './quorumRounds.v1.routes.js';
import operatorRoutes from './operators.v1.routes.js';
import masternodeRoutes from './masternodes.v1.routes.js';
import chainRoutes from './chain.v1.routes.js';
import adminRoutes from './admin.v1.routes.js';
import stakingRoutes from './staking.v1.routes.js';
import experimentRoutes from './experiments.v1.routes.js';
import peerRoutes from './peers.v1.routes.js';
import metricsRoutes from './metrics.v1.routes.js';

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
router.use('/staking/health', heavyLimiter);
router.use('/peers/propagation', heavyLimiter);

router.use('/quorum-rounds', quorumRoundRoutes);
router.use('/operators', operatorRoutes);
router.use('/admin', adminRoutes);
router.use('/masternodes', masternodeRoutes);
router.use('/staking', stakingRoutes);
router.use('/experiments', experimentRoutes);
router.use('/peers', peerRoutes);
router.use('/metrics', metricsRoutes);
// Blocks and transactions mount at the router root: /blocks, /txs.
router.use('/', chainRoutes);

export default router;
