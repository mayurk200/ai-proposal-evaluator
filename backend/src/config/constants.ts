/**
 * Shared application constants.
 * Single source of truth for values that were previously duplicated across
 * upload middleware, route-level Multer config, and error messages.
 */

/**
 * MIME types accepted for proposal document uploads.
 * Kept in sync with the Python service's accepted formats.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/bmp',
] as const;

/** Human-readable list of supported types, used in upload error messages. */
export const ALLOWED_TYPES_LABEL = 'PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP';

/** Standard invalid-file-type error message. */
export const INVALID_FILE_TYPE_MESSAGE = `Invalid file type. Supported: ${ALLOWED_TYPES_LABEL}.`;
