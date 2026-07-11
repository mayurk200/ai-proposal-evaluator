/**
 * Settings field registry — the single source of truth for every runtime-editable
 * configuration value in the application.
 *
 * Both the backend (validation, persistence, defaults) and the frontend (generic
 * form rendering via `GET /api/settings/schema`) are driven by this registry, so
 * the two never drift out of sync. Defaults are seeded from the process
 * environment where available, otherwise from the documented service defaults.
 */

import { env } from '../../config/env';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'secret';

/** Which service actually consumes a setting — surfaced to the UI as a hint. */
export type ConsumedBy = 'backend' | 'python' | 'both' | 'ui';

export interface SettingsField {
  /** Dotted identifier: `<group>.<key>` — unique across the registry. */
  id: string;
  group: string;
  key: string;
  label: string;
  description?: string;
  type: FieldType;
  /** Options for `select` fields. */
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Secret fields are never returned in clear text; only a "set" indicator. */
  secret?: boolean;
  /** True when a change takes effect without a service restart. */
  appliesLive: boolean;
  consumedBy: ConsumedBy;
  /** Marks destructive/risky edits so the UI can warn (e.g. rotating JWT secret). */
  danger?: boolean;
}

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide-react icon name, resolved on the frontend
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: 'llm', label: 'AI & LLM', description: 'Language-model provider, model, and generation parameters.', icon: 'Sparkles' },
  { id: 'documentProcessing', label: 'Document Processing', description: 'Upload limits, supported formats, and chunking.', icon: 'FileText' },
  { id: 'ocr', label: 'OCR', description: 'Optical character recognition for scanned documents.', icon: 'ScanLine' },
  { id: 'storage', label: 'Storage', description: 'Where uploaded files and extracted artifacts are kept.', icon: 'HardDrive' },
  { id: 'security', label: 'Security & Limits', description: 'CORS origins and API rate limiting.', icon: 'Shield' },
  { id: 'secrets', label: 'Secrets & API Keys', description: 'Provider credentials. Stored server-side and never displayed.', icon: 'KeyRound' },
  { id: 'preferences', label: 'Preferences', description: 'Appearance and notification preferences.', icon: 'Palette' },
];

const PROVIDER_OPTIONS = [
  { value: 'groq', label: 'Groq' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama (local)' },
];

const STORAGE_OPTIONS = [
  { value: 'local', label: 'Local disk' },
  { value: 'minio', label: 'MinIO' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * The full field registry. Order within a group defines display order.
 */
export const SETTINGS_FIELDS: SettingsField[] = [
  // ===== AI & LLM =====
  { id: 'llm.provider', group: 'llm', key: 'provider', label: 'LLM Provider', type: 'select', options: PROVIDER_OPTIONS, appliesLive: false, consumedBy: 'both', description: 'Provider used to run agent evaluations.' },
  { id: 'llm.model', group: 'llm', key: 'model', label: 'Model', type: 'text', appliesLive: true, consumedBy: 'python', placeholder: 'llama-3.3-70b-versatile', description: 'Model identifier passed to the provider.' },
  { id: 'llm.temperature', group: 'llm', key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.05, appliesLive: true, consumedBy: 'python', description: 'Higher = more creative, lower = more deterministic.' },
  { id: 'llm.maxTokens', group: 'llm', key: 'maxTokens', label: 'Max Output Tokens', type: 'number', min: 256, max: 32768, step: 128, appliesLive: true, consumedBy: 'python', unit: 'tokens' },
  { id: 'llm.maxRetries', group: 'llm', key: 'maxRetries', label: 'Max Retries', type: 'number', min: 0, max: 10, step: 1, appliesLive: true, consumedBy: 'python', description: 'Retry attempts on transient LLM failures.' },
  { id: 'llm.evaluationTimeoutSeconds', group: 'llm', key: 'evaluationTimeoutSeconds', label: 'Evaluation Timeout', type: 'number', min: 30, max: 1800, step: 10, appliesLive: true, consumedBy: 'python', unit: 'seconds' },
  { id: 'llm.ollamaBaseUrl', group: 'llm', key: 'ollamaBaseUrl', label: 'Ollama Base URL', type: 'text', appliesLive: false, consumedBy: 'backend', placeholder: 'http://localhost:11434' },

  // ===== Document Processing =====
  { id: 'documentProcessing.maxFileSizeMb', group: 'documentProcessing', key: 'maxFileSizeMb', label: 'Max File Size', type: 'number', min: 1, max: 200, step: 1, appliesLive: true, consumedBy: 'both', unit: 'MB' },
  { id: 'documentProcessing.supportedFormats', group: 'documentProcessing', key: 'supportedFormats', label: 'Supported Formats', type: 'text', appliesLive: true, consumedBy: 'python', placeholder: 'pdf,docx,txt,png', description: 'Comma-separated file extensions accepted for upload.' },
  { id: 'documentProcessing.chunkSizeTokens', group: 'documentProcessing', key: 'chunkSizeTokens', label: 'Chunk Size', type: 'number', min: 200, max: 8000, step: 100, appliesLive: true, consumedBy: 'python', unit: 'tokens' },
  { id: 'documentProcessing.chunkOverlapTokens', group: 'documentProcessing', key: 'chunkOverlapTokens', label: 'Chunk Overlap', type: 'number', min: 0, max: 2000, step: 50, appliesLive: true, consumedBy: 'python', unit: 'tokens' },

  // ===== OCR =====
  { id: 'ocr.enabled', group: 'ocr', key: 'enabled', label: 'Enable OCR', type: 'boolean', appliesLive: true, consumedBy: 'python', description: 'Run OCR on scanned/image-based documents.' },
  { id: 'ocr.language', group: 'ocr', key: 'language', label: 'OCR Language', type: 'text', appliesLive: true, consumedBy: 'python', placeholder: 'eng', description: 'Tesseract language code(s), e.g. "eng" or "eng+hin".' },
  { id: 'ocr.tesseractCmd', group: 'ocr', key: 'tesseractCmd', label: 'Tesseract Path', type: 'text', appliesLive: false, consumedBy: 'python', placeholder: 'Auto-detect', description: 'Absolute path to the tesseract binary (optional).' },

  // ===== Storage =====
  { id: 'storage.provider', group: 'storage', key: 'provider', label: 'Storage Provider', type: 'select', options: STORAGE_OPTIONS, appliesLive: false, consumedBy: 'both' },
  { id: 'storage.uploadDir', group: 'storage', key: 'uploadDir', label: 'Local Upload Directory', type: 'text', appliesLive: false, consumedBy: 'both', placeholder: 'uploads' },
  { id: 'storage.s3Bucket', group: 'storage', key: 's3Bucket', label: 'S3 / MinIO Bucket', type: 'text', appliesLive: false, consumedBy: 'both' },
  { id: 'storage.s3Region', group: 'storage', key: 's3Region', label: 'S3 Region', type: 'text', appliesLive: false, consumedBy: 'both', placeholder: 'us-east-1' },
  { id: 'storage.s3EndpointUrl', group: 'storage', key: 's3EndpointUrl', label: 'S3 Endpoint URL', type: 'text', appliesLive: false, consumedBy: 'both', placeholder: 'http://localhost:9000 (MinIO)', description: 'Custom endpoint for MinIO or S3-compatible storage.' },

  // ===== Security & Limits =====
  { id: 'security.corsOrigins', group: 'security', key: 'corsOrigins', label: 'Allowed CORS Origins', type: 'textarea', appliesLive: true, consumedBy: 'backend', placeholder: 'http://localhost:5173,http://localhost:3000', description: 'Comma-separated list of origins allowed to call the API.' },
  { id: 'security.rateLimitWindowMinutes', group: 'security', key: 'rateLimitWindowMinutes', label: 'Rate Limit Window', type: 'number', min: 1, max: 120, step: 1, appliesLive: false, consumedBy: 'backend', unit: 'minutes' },
  { id: 'security.rateLimitMaxRequests', group: 'security', key: 'rateLimitMaxRequests', label: 'Max Requests / Window', type: 'number', min: 10, max: 10000, step: 10, appliesLive: false, consumedBy: 'backend' },
  { id: 'security.evaluateRateLimitMax', group: 'security', key: 'evaluateRateLimitMax', label: 'Max Evaluations / Window', type: 'number', min: 1, max: 1000, step: 1, appliesLive: false, consumedBy: 'backend', description: 'Stricter cap for the expensive evaluation endpoints.' },

  // ===== Secrets & API Keys =====
  { id: 'secrets.groqApiKey', group: 'secrets', key: 'groqApiKey', label: 'Groq API Key', type: 'secret', secret: true, appliesLive: true, consumedBy: 'both' },
  { id: 'secrets.openaiApiKey', group: 'secrets', key: 'openaiApiKey', label: 'OpenAI API Key', type: 'secret', secret: true, appliesLive: true, consumedBy: 'both' },
  { id: 'secrets.geminiApiKey', group: 'secrets', key: 'geminiApiKey', label: 'Gemini API Key', type: 'secret', secret: true, appliesLive: true, consumedBy: 'both' },
  { id: 'secrets.awsAccessKeyId', group: 'secrets', key: 'awsAccessKeyId', label: 'AWS / S3 Access Key ID', type: 'secret', secret: true, appliesLive: false, consumedBy: 'both' },
  { id: 'secrets.awsSecretAccessKey', group: 'secrets', key: 'awsSecretAccessKey', label: 'AWS / S3 Secret Access Key', type: 'secret', secret: true, appliesLive: false, consumedBy: 'both' },
  { id: 'secrets.databaseUrl', group: 'secrets', key: 'databaseUrl', label: 'Database URL', type: 'secret', secret: true, appliesLive: false, consumedBy: 'python', description: 'PostgreSQL connection string for the Python service.' },
  { id: 'secrets.jwtSecret', group: 'secrets', key: 'jwtSecret', label: 'JWT Secret', type: 'secret', secret: true, appliesLive: false, consumedBy: 'backend', danger: true, description: 'Rotating this invalidates all existing login sessions.' },

  // ===== Preferences =====
  { id: 'preferences.theme', group: 'preferences', key: 'theme', label: 'Theme', type: 'select', options: THEME_OPTIONS, appliesLive: true, consumedBy: 'ui' },
  { id: 'preferences.notifyEvaluationComplete', group: 'preferences', key: 'notifyEvaluationComplete', label: 'Notify on evaluation complete', type: 'boolean', appliesLive: true, consumedBy: 'ui' },
  { id: 'preferences.notifyWeeklySummary', group: 'preferences', key: 'notifyWeeklySummary', label: 'Weekly summary email', type: 'boolean', appliesLive: true, consumedBy: 'ui' },
  { id: 'preferences.notifyNewFeatures', group: 'preferences', key: 'notifyNewFeatures', label: 'Product & feature updates', type: 'boolean', appliesLive: true, consumedBy: 'ui' },
];

/** Nested settings object shape. */
export type SettingsValue = string | number | boolean;
export type SettingsGroupValues = Record<string, SettingsValue>;
export type Settings = Record<string, SettingsGroupValues>;

/** Fast lookup by id. */
export const FIELD_BY_ID = new Map(SETTINGS_FIELDS.map((f) => [f.id, f]));

/** Convert env MAX_FILE_SIZE (bytes) to MB, with a safe fallback. */
function bytesToMb(bytes: string | undefined, fallback: number): number {
  const n = Number(bytes);
  return Number.isFinite(n) && n > 0 ? Math.round(n / (1024 * 1024)) : fallback;
}

/**
 * Default settings, seeded from the running environment where available so the
 * UI opens showing the values the services actually booted with.
 */
export function buildDefaults(): Settings {
  return {
    llm: {
      provider: env.LLM_PROVIDER,
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      maxTokens: 4096,
      maxRetries: 3,
      evaluationTimeoutSeconds: 300,
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
    },
    documentProcessing: {
      maxFileSizeMb: bytesToMb(env.MAX_FILE_SIZE, 50),
      supportedFormats: 'pdf,docx,doc,pptx,ppt,txt,png,jpg,jpeg,tiff,bmp',
      chunkSizeTokens: 2000,
      chunkOverlapTokens: 200,
    },
    ocr: {
      enabled: true,
      language: 'eng',
      tesseractCmd: '',
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      uploadDir: env.UPLOAD_DIR,
      s3Bucket: env.S3_BUCKET ?? '',
      s3Region: env.AWS_REGION,
      s3EndpointUrl: env.MINIO_ENDPOINT ?? '',
    },
    security: {
      corsOrigins: env.CORS_ORIGINS,
      rateLimitWindowMinutes: 15,
      rateLimitMaxRequests: 100,
      evaluateRateLimitMax: 10,
    },
    secrets: {
      groqApiKey: env.GROQ_API_KEY ?? '',
      openaiApiKey: env.OPENAI_API_KEY ?? '',
      geminiApiKey: env.GEMINI_API_KEY ?? '',
      awsAccessKeyId: env.AWS_ACCESS_KEY_ID ?? '',
      awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? '',
      databaseUrl: '',
      jwtSecret: '',
    },
    preferences: {
      theme: 'light',
      notifyEvaluationComplete: true,
      notifyWeeklySummary: false,
      notifyNewFeatures: true,
    },
  };
}

/**
 * Validate & coerce an incoming partial settings patch against the registry.
 * Unknown groups/keys are ignored. Numbers are coerced and clamped to their
 * declared [min, max]; selects are checked against their option set; booleans
 * are coerced. Empty secret values are dropped so they don't overwrite an
 * existing stored secret. Returns a clean nested patch.
 */
export function validatePatch(input: unknown): Settings {
  const patch: Settings = {};
  if (!input || typeof input !== 'object') return patch;

  for (const field of SETTINGS_FIELDS) {
    const group = (input as any)[field.group];
    if (!group || typeof group !== 'object' || !(field.key in group)) continue;

    const raw = group[field.key];
    let value: SettingsValue | undefined;

    switch (field.type) {
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          throw new ValidationError(`${field.id} must be a number`);
        }
        let clamped = n;
        if (field.min !== undefined) clamped = Math.max(field.min, clamped);
        if (field.max !== undefined) clamped = Math.min(field.max, clamped);
        value = clamped;
        break;
      }
      case 'boolean':
        value = raw === true || raw === 'true';
        break;
      case 'select': {
        const s = String(raw);
        if (field.options && !field.options.some((o) => o.value === s)) {
          throw new ValidationError(`${field.id} must be one of: ${field.options.map((o) => o.value).join(', ')}`);
        }
        value = s;
        break;
      }
      case 'secret': {
        const s = typeof raw === 'string' ? raw : '';
        // Empty string = "leave unchanged"; skip so we never blank a stored secret.
        if (s.trim() === '') continue;
        value = s;
        break;
      }
      default:
        value = String(raw);
        break;
    }

    if (value === undefined) continue;
    if (!patch[field.group]) patch[field.group] = {};
    patch[field.group][field.key] = value;
  }

  return patch;
}

/** Thrown by {@link validatePatch}; mapped to a 400 by the controller. */
export class ValidationError extends Error {}
