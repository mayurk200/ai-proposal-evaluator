import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env';

/**
 * Reusable PostgreSQL access layer for the Node backend.
 *
 * Design notes:
 * - A SINGLE shared pool is created lazily and cached in `pool`. Nothing else in
 *   the codebase should ever call `new Pool()` — import from here instead.
 * - Connecting is NON-FATAL at boot. When Postgres is configured it backs the
 *   document store in `config/database.ts` (via `pgStore.ts`); when it is not,
 *   the backend falls back to the local JSON store. If the database is
 *   unreachable the API still boots, and callers can check `isDbReady()`.
 * - The Python service owns the canonical schema in this same database, so this
 *   module intentionally performs NO DDL / migrations of its own.
 */

let pool: Pool | null = null;
let ready = false;

/**
 * Resolve pool configuration from the environment. Prefers a full
 * `DATABASE_URL`; otherwise assembles one from discrete `DB_*` parts. Returns
 * `null` when Postgres is not configured at all (so we can cleanly skip it).
 */
function resolveConnectionConfig(): PoolConfig | null {
  if (env.DATABASE_URL) {
    // node-postgres does not understand SQLAlchemy's "+asyncpg" driver suffix
    // that the Python service uses. Normalise it so the exact same URL can be
    // shared across both services.
    const connectionString = env.DATABASE_URL.replace(/^postgres(ql)?\+\w+:\/\//, 'postgresql://');
    return { connectionString, max: env.DB_POOL_MAX };
  }

  if (env.DB_HOST && env.DB_NAME && env.DB_USER) {
    return {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      max: env.DB_POOL_MAX,
    };
  }

  return null;
}

/** True when a Postgres connection has been configured via env. */
export function isDbConfigured(): boolean {
  return resolveConnectionConfig() !== null;
}

/** True once `connectWithRetry()` has successfully verified connectivity. */
export function isDbReady(): boolean {
  return ready;
}

/**
 * Return the shared pool, creating it on first use. Throws if Postgres is not
 * configured — guard with `isDbConfigured()` when that is a possibility.
 */
export function getPool(): Pool {
  if (!pool) {
    const config = resolveConnectionConfig();
    if (!config) {
      throw new Error(
        'PostgreSQL is not configured — set DATABASE_URL or DB_HOST/DB_NAME/DB_USER in the environment.'
      );
    }
    pool = new Pool({
      ...config,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    // An idle pooled client can emit an error out-of-band (e.g. the DB restarts
    // or a network blip). Without a listener node-postgres crashes the whole
    // process — log it and let the pool transparently replace the client.
    pool.on('error', (err) => {
      ready = false;
      console.error('❌ [pg] idle client error:', err.message);
    });
  }
  return pool;
}

/**
 * Establish the connection with retry/backoff to tolerate Docker start-up
 * ordering (Postgres may still be booting when the API comes up). Non-fatal:
 * returns `false` instead of throwing if it ultimately can't connect.
 */
export async function connectWithRetry(
  retries: number = env.DB_CONNECT_RETRIES,
  delayMs: number = env.DB_CONNECT_RETRY_DELAY_MS
): Promise<boolean> {
  if (!isDbConfigured()) {
    console.log('📁 [pg] No PostgreSQL configuration found — skipping (backend continues on the local JSON store).');
    return false;
  }

  const p = getPool();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await p.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      ready = true;
      console.log(`🐘 [pg] Connected to PostgreSQL (attempt ${attempt}/${retries}).`);
      return true;
    } catch (err: any) {
      console.warn(`⏳ [pg] Connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  ready = false;
  console.error(`❌ [pg] Could not connect to PostgreSQL after ${retries} attempts — continuing without it.`);
  return false;
}

/** Convenience wrapper for one-off parameterised queries against the shared pool. */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Close the pool for graceful shutdown. Safe to call when nothing was opened. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    ready = false;
    console.log('🐘 [pg] Connection pool closed.');
  }
}

export default getPool;
