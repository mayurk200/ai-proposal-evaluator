import path from 'path';
import multer from 'multer';
import { env } from '../config/env';

/**
 * Files are buffered in memory and forwarded straight to the Python service,
 * which stores the one canonical original. Nothing is written to the gateway's
 * disk any more.
 */
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.pptx',
  '.ppt',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.tiff',
  '.bmp',
]);

const fileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  // Validate on the extension rather than the browser-supplied MIME type. The
  // previous filter was a MIME allowlist, and browsers report .docx as
  // application/zip (and .doc as application/octet-stream) often enough that it
  // rejected perfectly valid proposals. Python re-checks the true content type
  // from the bytes, so this is only a cheap first gate.
  const ext = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type "${ext || 'unknown'}". Supported: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      ),
    );
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: parseInt(env.MAX_FILE_SIZE, 10),
    files: 25,
  },
});
