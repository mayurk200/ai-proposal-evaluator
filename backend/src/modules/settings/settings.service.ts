/**
 * Settings service — loads, merges, persists, and applies runtime settings.
 *
 * Effective settings = registry defaults (seeded from env) deep-merged with the
 * persisted override document. Overrides live in the `settings` collection
 * (Firestore or the local JSON store) under a single `app` document.
 *
 * An in-memory cache of the effective settings is kept so synchronous runtime
 * consumers (CORS origin check, rate-limit config) can read current values
 * without an async round-trip. The cache is refreshed on every write.
 */

import { collections } from '../../config/database';
import { env } from '../../config/env';
import {
  SETTINGS_FIELDS,
  buildDefaults,
  validatePatch,
  type Settings,
} from './settings.schema';

const SETTINGS_DOC_ID = 'app';

/** Deep-merge `override` onto `base` (one level of groups, flat values within). */
function mergeSettings(base: Settings, override: Partial<Settings>): Settings {
  const result: Settings = {};
  for (const group of Object.keys(base)) {
    result[group] = { ...base[group], ...(override?.[group] ?? {}) };
  }
  return result;
}

let cachedEffective: Settings = buildDefaults();
let initialized = false;

/** Read raw persisted overrides ({} when none). */
async function readOverrides(): Promise<Partial<Settings>> {
  try {
    const doc = await collections.settings.doc(SETTINGS_DOC_ID).get();
    if (!doc.exists) return {};
    const data = doc.data() as any;
    return (data?.overrides ?? {}) as Partial<Settings>;
  } catch {
    return {};
  }
}

async function writeOverrides(overrides: Partial<Settings>): Promise<void> {
  await collections.settings.doc(SETTINGS_DOC_ID).set({
    overrides,
    updatedAt: new Date().toISOString(),
  });
}

/** Load persisted overrides and prime the in-memory cache. Call once on boot. */
export async function initSettings(): Promise<void> {
  const overrides = await readOverrides();
  cachedEffective = mergeSettings(buildDefaults(), overrides);
  initialized = true;
}

/** Synchronous access to the current effective settings (cache-backed). */
export function getEffective(): Settings {
  return cachedEffective;
}

export function isInitialized(): boolean {
  return initialized;
}

/**
 * Effective settings with every secret redacted. Secret fields become the
 * literal `'••••••••'` when a value is set, or `''` when unset — so the UI can
 * show "configured" without ever transmitting the value.
 */
export async function getMaskedSettings(): Promise<Settings> {
  const overrides = await readOverrides();
  const effective = mergeSettings(buildDefaults(), overrides);
  cachedEffective = effective; // opportunistic refresh
  initialized = true;

  const masked: Settings = {};
  for (const group of Object.keys(effective)) {
    masked[group] = { ...effective[group] };
  }
  for (const field of SETTINGS_FIELDS) {
    if (field.secret) {
      const current = effective[field.group]?.[field.key];
      masked[field.group][field.key] = current && String(current).length > 0 ? '••••••••' : '';
    }
  }
  return masked;
}

/**
 * Apply a validated patch: merge into persisted overrides, refresh the cache,
 * and best-effort push the AI/processing subset to the Python service.
 * Returns the new masked settings.
 */
export async function updateSettings(rawPatch: unknown): Promise<Settings> {
  const patch = validatePatch(rawPatch);

  const existing = await readOverrides();
  const nextOverrides: Partial<Settings> = { ...existing };
  for (const group of Object.keys(patch)) {
    nextOverrides[group] = { ...(existing[group] ?? {}), ...patch[group] };
  }

  await writeOverrides(nextOverrides);
  cachedEffective = mergeSettings(buildDefaults(), nextOverrides);
  initialized = true;

  // Push python-consumed settings; never let a sync failure fail the save.
  void syncToPythonService(cachedEffective).catch((e) =>
    console.warn('[settings] Python sync failed (settings still saved):', e?.message ?? e),
  );

  return getMaskedSettings();
}

/** Remove all overrides, reverting to environment/code defaults. */
export async function resetSettings(): Promise<Settings> {
  await writeOverrides({});
  cachedEffective = buildDefaults();
  initialized = true;
  void syncToPythonService(cachedEffective).catch(() => undefined);
  return getMaskedSettings();
}

/**
 * Forward the subset of settings the Python service consumes so live-appliable
 * knobs (model, temperature, chunking, OCR) take effect for subsequent
 * evaluations without a restart. Best-effort: the caller ignores failures.
 */
export async function syncToPythonService(effective: Settings): Promise<void> {
  const payload = {
    LLM_PROVIDER: effective.llm.provider,
    LLM_MODEL: effective.llm.model,
    LLM_TEMPERATURE: effective.llm.temperature,
    LLM_MAX_TOKENS: effective.llm.maxTokens,
    MAX_RETRIES: effective.llm.maxRetries,
    EVALUATION_TIMEOUT_SECONDS: effective.llm.evaluationTimeoutSeconds,
    MAX_FILE_SIZE_MB: effective.documentProcessing.maxFileSizeMb,
    SUPPORTED_FORMATS: effective.documentProcessing.supportedFormats,
    CHUNK_SIZE_TOKENS: effective.documentProcessing.chunkSizeTokens,
    CHUNK_OVERLAP_TOKENS: effective.documentProcessing.chunkOverlapTokens,
    OCR_ENABLED: effective.ocr.enabled,
    OCR_LANGUAGE: effective.ocr.language,
    // Secrets are only forwarded when actually set.
    ...(effective.secrets.groqApiKey ? { GROQ_API_KEY: effective.secrets.groqApiKey } : {}),
    ...(effective.secrets.databaseUrl ? { DATABASE_URL: effective.secrets.databaseUrl } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${env.PYTHON_SERVICE_URL}/api/v1/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Python service responded ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Convenience accessors for runtime consumers. */
export const runtime = {
  corsOrigins(): string[] {
    return String(cachedEffective.security.corsOrigins)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  },
  maxFileSizeBytes(): number {
    return Number(cachedEffective.documentProcessing.maxFileSizeMb) * 1024 * 1024;
  },
};
