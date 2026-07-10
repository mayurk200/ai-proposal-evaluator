import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Lightweight structured logger — no external dependency.
 *
 * - Pretty, single-line output in development; JSON lines in production so logs
 *   are machine-parseable by whatever aggregator ingests stdout.
 * - Any `requestId` bound via {@link runWithRequestContext} is merged into every
 *   log line automatically, so correlation ids flow without threading them
 *   through every function call.
 */

export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const isProd = process.env.NODE_ENV === 'production';
const minLevel: number = LEVEL_ORDER[(process.env.LOG_LEVEL as Level) ?? (isProd ? 'info' : 'debug')] ?? 20;

function emit(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < minLevel) return;

  const ctx = storage.getStore();
  const record = {
    time: new Date().toISOString(),
    level,
    event,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.method ? { method: ctx.method, path: ctx.path } : {}),
    ...fields,
  };

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (isProd) {
    sink(JSON.stringify(record));
    return;
  }

  // Dev: compact, readable line.
  const rid = ctx?.requestId ? ` [${ctx.requestId.slice(0, 8)}]` : '';
  const extra = fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
  sink(`${record.time} ${level.toUpperCase().padEnd(5)}${rid} ${event}${extra}`);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
