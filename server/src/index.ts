/**
 * devnet.deftrack API server.
 *
 * Phase 0: liveness endpoint only. Mongo connection, RPC service, the
 * QuorumRound collector and the v1 routes land in Phase 1.
 */
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import { DEVNET_NAME, type ApiEnvelope } from '@devnet-deftrack/shared';
import { config } from './config.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(cors({ origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean) }));

app.get('/api/v1/health', (_req, res) => {
  const body: ApiEnvelope<{ status: string; devnet: string; uptimeSeconds: number }> = {
    success: true,
    data: {
      status: 'ok',
      devnet: DEVNET_NAME,
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
  res.json(body);
});

app.listen(config.port, config.host, () => {
  console.log(`devnet.deftrack server listening on http://${config.host}:${config.port}`);
});
