import { isDbConfigured } from './pg';
import { createPgCollection } from './pgStore';
import { createLocalCollection } from './localStore';

/**
 * Document store wiring. PostgreSQL (the shared "agrieval" database, managed
 * via pgAdmin) is the primary store; the local JSON store remains as a
 * zero-config fallback for development without a database.
 */
const usePostgres = isDbConfigured();

if (usePostgres) {
  console.log('🐘 PostgreSQL configured — using Postgres document store');
} else {
  console.log('📁 No PostgreSQL configuration found — using local JSON store');
  console.log('   To use Postgres: set DATABASE_URL (or DB_HOST/DB_NAME/DB_USER) in backend/.env');
}

// Create collections — Postgres or local fallback
function makeCollection(name: string) {
  if (usePostgres) {
    return createPgCollection(name) as any;
  }
  return createLocalCollection(name) as any;
}

export const collections = {
  users: makeCollection('users'),
  proposals: makeCollection('proposals'),
  evaluations: makeCollection('evaluations'),
  comparisons: makeCollection('comparisons'),
  aiLogs: makeCollection('ai_logs'),
  settings: makeCollection('settings'),
};
