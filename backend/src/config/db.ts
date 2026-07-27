import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

/**
 * Postgres connection pool.
 *
 * This replaces the previous Firestore-or-local-JSON-file store. That store was
 * a fallback chain: with no Firebase credentials present it silently degraded to
 * writing JSON files under backend/data/, which is not something you want a
 * system that runs for years and holds funding decisions to be doing.
 *
 * The gateway reads and writes exactly one table — `users`. Every other table is
 * owned by the Python service, which also creates the schema. The gateway must
 * not run DDL; it waits for the schema to exist.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // A pooled connection dying in the background must not take the process with
  // it — the pool will replace it on the next checkout.
  console.error('Unexpected Postgres pool error:', err.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Block until Postgres answers, so the process fails loudly at boot rather than
 * on the first user request.
 */
export async function assertDbReady(retries = 10, delayMs = 1_500): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('Postgres connected');
      return;
    } catch (err: any) {
      if (attempt === retries) {
        throw new Error(
          `Could not reach Postgres at ${env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')} ` +
            `after ${retries} attempts: ${err.message}`,
        );
      }
      console.warn(`Postgres not ready (attempt ${attempt}/${retries}), retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export default pool;
