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
import { connectWithRetry, closePool, isDbReady, isDbConfigured } from './config/pg';
import { checkPythonServiceHealth } from './utils/pythonProxy';
import { createStorageProvider } from './providers/storage/factory';
import { StorageProvider } from './providers/storage/types';

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

// Dependency probes shared by /api/health and the startup readiness summary.
let healthStorageProvider: StorageProvider | null = null;
async function storageStatus(): Promise<string> {
  try {
    healthStorageProvider ??= createStorageProvider();
    const probe = healthStorageProvider as { healthCheck?: () => Promise<void> };
    if (typeof probe.healthCheck === 'function') await probe.healthCheck();
    return `${env.STORAGE_PROVIDER} (ok)`;
  } catch (err: any) {
    return `unavailable: ${err?.message ?? err}`;
  }
}

function databaseStatus(): string {
  if (!isDbConfigured()) return 'not configured (local JSON store)';
  return isDbReady() ? 'connected' : 'disconnected';
}

// Health check. 200 only when the hard dependency (PostgreSQL, if configured)
// is up; storage/python statuses are reported so callers see exactly what is
// broken instead of a generic failure.
app.get('/api/health', async (_req, res) => {
  const [storage, pythonOk] = await Promise.all([storageStatus(), checkPythonServiceHealth()]);
  const dbHealthy = !isDbConfigured() || isDbReady();
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    database: databaseStatus(),
    storage,
    python_service: pythonOk ? 'connected' : `unreachable (${env.PYTHON_SERVICE_URL})`,
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
    await connectWithRetry().catch((err) => console.warn('[pg] connect error:', err?.message ?? err));

    // A configured-but-unreachable database is a hard error: refusing to start
    // beats silently falling back and "losing" data into the JSON store.
    if (isDbConfigured() && !isDbReady()) {
      console.error(
        '[startup] FATAL: DATABASE_URL is set but PostgreSQL is not reachable.\n' +
          '  - Is the agrieval-postgres container running? (docker compose up -d postgres)\n' +
          '  - Do the credentials in the root .env match the database? (see docs/setup.md "Password reset")\n' +
          '  - Or unset DATABASE_URL to run on the local JSON store.'
      );
      process.exit(1);
    }

    // Readiness summary for the remaining dependencies (informational — the
    // API can serve while MinIO/Python are still coming up).
    const [storage, pythonOk] = await Promise.all([storageStatus(), checkPythonServiceHealth()]);
    console.log(`[startup] PostgreSQL:     ${databaseStatus()}`);
    console.log(`[startup] Storage:        ${storage}`);
    console.log(
      `[startup] Python service: ${pythonOk ? `connected (${env.PYTHON_SERVICE_URL})` : `NOT reachable at ${env.PYTHON_SERVICE_URL} — uploads/evaluation will fail until it is up`}`
    );

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
