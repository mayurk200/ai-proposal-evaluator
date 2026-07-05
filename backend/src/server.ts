import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimit';
import authRoutes from './modules/auth/auth.routes';
import proposalRoutes from './modules/proposal/proposal.routes';
import uploadRoutes from './modules/upload/upload.routes';
import aiRoutes from './modules/ai/ai.routes';
import comparisonRoutes from './modules/comparison/comparison.routes';
import settingsRoutes from './modules/settings/settings.routes';
import { initSettings, runtime } from './modules/settings/settings.service';
import { connectWithRetry, closePool, isDbReady } from './config/pg';

const app = express();

// Ensure upload directory exists
const uploadDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
// CORS origin is resolved per-request from the live settings cache so it can be
// updated at runtime without a restart. Falls back to the env default at boot.
const envCorsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl, server-to-server) with no Origin header.
    if (!origin) return callback(null, true);
    const allowed = runtime.corsOrigins();
    const list = allowed.length ? allowed : envCorsOrigins;
    callback(null, list.includes(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(uploadDir));

// Rate limiting on all API routes
app.use('/api', generalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/comparisons', comparisonRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    database: isDbReady() ? 'connected' : 'disconnected',
  });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = parseInt(env.PORT);

// Prime the runtime settings cache from persisted overrides before serving.
initSettings()
  .catch((err) => console.warn('[settings] init failed, using defaults:', err?.message ?? err))
  .finally(async () => {
    // Establish the PostgreSQL pool with retry (tolerates Docker start ordering).
    // Non-fatal: the API still boots on its existing store if Postgres is down.
    await connectWithRetry().catch((err) => console.warn('[pg] connect error:', err?.message ?? err));

    const server = app.listen(PORT, () => {
      console.log(`🚀 AgriEval API running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown: stop accepting connections, then drain the pool.
    const shutdown = (signal: string) => {
      console.log(`\n${signal} received — shutting down gracefully...`);
      server.close(async () => {
        await closePool().catch((err) => console.warn('[pg] close error:', err?.message ?? err));
        process.exit(0);
      });
      // Failsafe: force-exit if connections don't drain in time.
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

export default app;
