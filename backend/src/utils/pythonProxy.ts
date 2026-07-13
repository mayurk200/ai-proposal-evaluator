/**
 * Proxy to the Python AI service.
 *
 * The Python service is the only implementation of extraction, metadata,
 * similarity and evaluation. There is no Node-side fallback: when Python is
 * down, the gateway returns 503 and says so. The previous behaviour — silently
 * failing over to a Node agent pipeline that scored against an entirely
 * different rubric — produced numbers that looked authoritative and were not
 * comparable to anything else in the database.
 *
 * `mapPythonResponseToLegacy` is gone with it. It flattened the seven real AIAIC
 * parameter scores back onto legacy names (innovation/market/financial/...), so
 * the frontend was reading a lossy projection of the evaluation.
 */

import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

/** Identity of the caller, forwarded so Python can attribute decisions. */
export interface ProxyActor {
  userId?: string;
  userRole?: string;
}

/**
 * Purpose-sized timeouts. A read is not a 5-minute operation, and an evaluation
 * is not a 15-second one; a single global timeout gets one of them wrong.
 */
export const TIMEOUTS = {
  read: 15_000,
  write: 60_000,
  evaluate: 300_000,
  health: 5_000,
} as const;

/** Transient by nature — worth another attempt. Anything else fails fast. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function actorHeaders(actor?: ProxyActor): Record<string, string> {
  const headers: Record<string, string> = {};
  if (actor?.userId) headers['X-User-Id'] = actor.userId;
  if (actor?.userRole) headers['X-User-Role'] = actor.userRole;
  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return (body as any)?.detail ?? (body as any)?.message ?? JSON.stringify(body);
  } catch {
    return response.statusText;
  }
}

interface CallOptions {
  method?: string;
  // The only two shapes we ever send: a JSON string, or multipart for uploads.
  // (`BodyInit` is a DOM type and this project compiles against ES2022 + Node.)
  body?: string | FormData;
  headers?: Record<string, string>;
  timeoutMs?: number;
  actor?: ProxyActor;
  /** Retries on transient failures only. 0 disables. */
  retries?: number;
}

/**
 * One call to Python, with backoff on transient failures.
 * Returns the raw Response so callers can stream (file downloads, PDF export)
 * rather than forcing everything through JSON.
 */
export async function callPython(path: string, options: CallOptions = {}): Promise<Response> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeoutMs = TIMEOUTS.read,
    actor,
    retries = 2,
  } = options;

  const url = `${env.PYTHON_SERVICE_URL}${path}`;
  let lastError = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { ...actorHeaders(actor), ...headers },
        signal: controller.signal,
      });

      if (response.ok) return response;

      // 4xx (bad input, not found, forbidden) will fail identically on retry —
      // surface it immediately instead of burning the caller's time.
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new AppError(await readError(response), response.status);
      }

      lastError = `${response.status}: ${await readError(response)}`;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      lastError =
        err.name === 'AbortError'
          ? `timed out after ${Math.round(timeoutMs / 1000)}s`
          : err.message;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  throw new AppError(`AI service unavailable (${path}): ${lastError}`, 503);
}

/** Call Python and parse the JSON body. */
export async function callPythonJson<T = unknown>(
  path: string,
  options: CallOptions = {},
): Promise<T> {
  const response = await callPython(path, options);
  return (await response.json()) as T;
}

/** POST a JSON body to Python. */
export async function postPythonJson<T = unknown>(
  path: string,
  payload: unknown,
  options: Omit<CallOptions, 'method' | 'body'> = {},
): Promise<T> {
  return callPythonJson<T>(path, {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    timeoutMs: options.timeoutMs ?? TIMEOUTS.write,
  });
}

/** Forward one or more uploaded files to Python as multipart/form-data. */
export async function postPythonFiles<T = unknown>(
  path: string,
  files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  fields: Record<string, string> = {},
  options: Omit<CallOptions, 'method' | 'body'> = {},
): Promise<T> {
  const form = new FormData();
  const field = files.length > 1 ? 'files' : 'file';

  for (const file of files) {
    form.append(
      field,
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
  }
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  return callPythonJson<T>(path, {
    ...options,
    method: 'POST',
    body: form,
    timeoutMs: options.timeoutMs ?? TIMEOUTS.write,
  });
}

/** Liveness probe. Used to fail fast with a clear message, never to pick a fallback. */
export async function checkPythonServiceHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${env.PYTHON_SERVICE_URL}/api/v1/health`, {
      signal: AbortSignal.timeout(TIMEOUTS.health),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Throw a clean 503 if the AI service is not reachable. */
export async function assertPythonAvailable(): Promise<void> {
  if (!(await checkPythonServiceHealth())) {
    throw new AppError(
      'The AI evaluation service is unavailable. Evaluation cannot proceed — please retry once it is back.',
      503,
    );
  }
}
