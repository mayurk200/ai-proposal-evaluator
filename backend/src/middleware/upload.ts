import multer from 'multer';
import { env } from '../config/env';
import { ALLOWED_MIME_TYPES, INVALID_FILE_TYPE_MESSAGE } from '../config/constants';

const storage = multer.memoryStorage();

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(INVALID_FILE_TYPE_MESSAGE));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(env.MAX_FILE_SIZE),
  },
});
