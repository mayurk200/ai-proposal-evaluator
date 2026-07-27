import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { assertDbReady } from './config/db';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import gatewayRoutes from './modules/gateway/gateway.routes';
import { checkPythonServiceHealth } from './utils/pythonProxy';

const app = express();

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// No `express.static('/uploads')` any more. It published every uploaded proposal
// to anyone who could guess a filename. Originals are now owned by the Python
// service's object storage and streamed through an authenticated route.

/**
 * Health reflects the system, not just this process. The AI service is a hard
 * dependency — if it is down we report it, because nothing else is going to quietly
 * take over.
 *
 * Registered BEFORE the gateway router. Express matches in order, and the gateway
 * applies `authMiddleware` to everything under /api — so mounting health after it made
 * the health check itself return 401, which is exactly the endpoint that must answer
 * when nobody is holding a token.
 */
app.get('/api/health', async (_req, res) => {
  const aiReady = await checkPythonServiceHealth();
  res.status(aiReady ? 200 : 503).json({
    status: aiReady ? 'ok' : 'degraded',
    services: { gateway: 'ok', ai: aiReady ? 'ok' : 'unreachable' },
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api', gatewayRoutes);

app.use(errorHandler);

async function start() {
  // Fail at boot, not on the first user request.
  await assertDbReady();

  if (!(await checkPythonServiceHealth())) {
    console.warn(
      'WARNING: the Python AI service is not reachable. Uploads and evaluation ' +
        'will return 503 until it is up. There is no Node-side fallback.',
    );
  }

  const port = parseInt(env.PORT, 10);
  app.listen(port, () => {
    console.log(`AgriEval gateway listening on http://localhost:${port} [${env.NODE_ENV}]`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

export default app;
