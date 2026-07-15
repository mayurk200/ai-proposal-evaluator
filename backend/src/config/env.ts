import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Env-file precedence (highest → lowest): real OS environment variables →
// backend/.env (service-specific) → repo-root .env (shared values, single
// source of truth). dotenv never overwrites keys that are already set, so
// listing backend/.env first makes it win over the root file.
dotenv.config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../../../.env')],
});

const envSchema = z.object({
  JWT_SECRET: z.string().min(10),
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Authentication
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().default(30),
  AUTH_MAX_FAILED_LOGINS: z.coerce.number().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().default(15),
  // Cookie Secure flag: defaults to true in production, false otherwise.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  
  // LLM Provider
  LLM_PROVIDER: z.enum(['groq', 'openai', 'gemini', 'ollama']).default('groq'),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  
  // Python Service
  PYTHON_SERVICE_URL: z.string().default('http://localhost:8000'),

  // PostgreSQL — either a full DATABASE_URL (preferred; the "+asyncpg" suffix
  // used by the Python service is tolerated) or discrete DB_* parts. When none
  // are set, Postgres is simply skipped and the backend runs on the local
  // JSON store.
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().default(10),
  DB_CONNECT_RETRIES: z.coerce.number().default(5),
  DB_CONNECT_RETRY_DELAY_MS: z.coerce.number().default(2000),

  // CORS: comma-separated list of allowed origins
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  
  // Storage Provider
  STORAGE_PROVIDER: z.enum(['local', 'minio']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_FILE_SIZE: z.string().default('10485760'),
  
  // S3/MinIO
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  MINIO_ENDPOINT: z.string().optional(),
  // Public (host-reachable) MinIO endpoint used to build browser-openable URLs.
  MINIO_PUBLIC_ENDPOINT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Whether auth cookies should carry the Secure flag. */
export const cookieSecure =
  env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';
