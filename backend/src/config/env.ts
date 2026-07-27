import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Gateway configuration.
 *
 * The Node tier no longer holds LLM credentials or a document pipeline — all AI
 * work lives in the Python service and there is no fallback. There are therefore
 * no GROQ/OPENAI/GEMINI/OLLAMA keys here any more, and no Firebase.
 */
const envSchema = z.object({
  JWT_SECRET: z.string().min(10),
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Single system of record, shared with the Python service.
  DATABASE_URL: z
    .string()
    .default('postgresql://agrieval:agrieval123@localhost:5432/agrieval'),

  // The Python service is a hard dependency. If it is down, evaluation is down —
  // and we say so, rather than quietly scoring against a different rubric.
  PYTHON_SERVICE_URL: z.string().default('http://localhost:8000'),

  // Storage Provider
  STORAGE_PROVIDER: z.enum(['local', 's3', 'minio', 'cloudinary']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_FILE_SIZE: z.string().default('52428800'),

  // S3/MinIO
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  MINIO_ENDPOINT: z.string().optional(),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Seeded operator accounts. Passwords come from the environment so a real
  // deployment never silently inherits a hardcoded credential.
  ADMIN_EMAIL: z.string().default('admin@agrieval.local'),
  ADMIN_PASSWORD: z.string().default('ChangeMe!Admin1'),
  DESK2_EMAIL: z.string().default('desk2@agrieval.local'),
  DESK2_PASSWORD: z.string().default('ChangeMe!Desk2'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
