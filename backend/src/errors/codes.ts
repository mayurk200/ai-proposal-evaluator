/**
 * Canonical machine-readable error codes shared across the whole stack.
 *
 * The SAME string values are mirrored by the Python service (Step 2) and the
 * frontend (Step 4) so a single error can be identified end-to-end regardless
 * of which tier produced it. Keep this list authoritative — add a code here
 * before using it anywhere.
 *
 * ── Shared error response contract ─────────────────────────────────────────
 * Every error response from Node AND Python has this JSON shape:
 *
 *   {
 *     "status":    "error",
 *     "code":      "NOT_FOUND",          // one of ErrorCode below
 *     "message":   "Proposal not found", // human-readable, safe to display
 *     "requestId": "b1f2…",              // correlation id (X-Request-Id header)
 *     "details":   [ ... ]               // optional, machine-readable extras
 *   }
 *
 * `message` (and, for legacy readers, `error`) is always present so existing
 * consumers keep working; `code` + `requestId` are the new additions.
 */
export enum ErrorCode {
  // Generic / HTTP
  INTERNAL = 'INTERNAL_ERROR',
  VALIDATION = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',

  // Domain
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  EVALUATION_FAILED = 'EVALUATION_FAILED',

  // Dependencies / upstream
  DB_UNAVAILABLE = 'DB_UNAVAILABLE',
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  PYTHON_SERVICE_UNAVAILABLE = 'PYTHON_SERVICE_UNAVAILABLE',
  LLM_ERROR = 'LLM_ERROR',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
}

/** Default HTTP status for a given error code. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.UPLOAD_FAILED]: 400,
  [ErrorCode.EXTRACTION_FAILED]: 422,
  [ErrorCode.EVALUATION_FAILED]: 422,
  [ErrorCode.DB_UNAVAILABLE]: 503,
  [ErrorCode.STORAGE_UNAVAILABLE]: 503,
  [ErrorCode.PYTHON_SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.LLM_ERROR]: 502,
  [ErrorCode.UPSTREAM_ERROR]: 502,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/** Best-effort reverse map so a bare HTTP status gets a sensible code. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 502:
      return ErrorCode.UPSTREAM_ERROR;
    case 503:
      return ErrorCode.STORAGE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL : ErrorCode.BAD_REQUEST;
  }
}
