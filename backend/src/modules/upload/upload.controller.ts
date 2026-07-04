import { Request, Response, NextFunction } from 'express';
import { createStorageProvider } from '../../providers/storage/factory';
import { StorageProvider } from '../../providers/storage/types';
import { env } from '../../config/env';

/**
 * Phase 1 upload controller.
 *
 * Accepts one or more files (multipart field "files") and stores each of them
 * in the configured object store (MinIO in Docker). Returns the storage key +
 * a browser-openable URL for every stored file. No AI/extraction here — that
 * is Phase 2.
 */

// Lazily create a single storage provider instance (reads STORAGE_PROVIDER env).
let storage: StorageProvider | null = null;
function getStorage(): StorageProvider {
  if (!storage) storage = createStorageProvider();
  return storage;
}

export const uploadController = {
  async uploadMany(req: Request, res: Response, next: NextFunction) {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files received. Send one or more files in the "files" field.',
        });
      }

      const provider = getStorage();
      // Ensure the bucket exists before the first write (MinIO/S3 only).
      if (provider.ensureReady) {
        await provider.ensureReady();
      }

      const stored = await Promise.all(
        files.map(async (file) => {
          const key = await provider.upload(file);
          return {
            originalName: file.originalname,
            key,
            size: file.size,
            contentType: file.mimetype,
            url: provider.getUrl(key),
          };
        })
      );

      return res.status(201).json({
        success: true,
        storageProvider: env.STORAGE_PROVIDER,
        bucket: env.S3_BUCKET ?? null,
        count: stored.length,
        files: stored,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Lists every file currently in the storage bucket so the frontend can show
   * the user what has been uploaded (and how many). Read-only — it does not
   * trigger any extraction or evaluation.
   */
  async listAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const provider = getStorage();
      if (provider.ensureReady) {
        await provider.ensureReady();
      }

      // Providers without a native listing (e.g. cloudinary) just report empty.
      if (!provider.list) {
        return res.status(200).json({
          success: true,
          storageProvider: env.STORAGE_PROVIDER,
          bucket: env.S3_BUCKET ?? null,
          count: 0,
          files: [],
          note: 'The active storage provider does not support listing.',
        });
      }

      const objects = await provider.list();
      const files = objects
        .map((o) => ({
          key: o.key,
          name: o.originalName || o.key.split('/').pop() || o.key,
          size: o.size,
          lastModified: o.lastModified,
          url: provider.getUrl(o.key),
        }))
        .sort(
          (a, b) =>
            new Date(b.lastModified ?? 0).getTime() - new Date(a.lastModified ?? 0).getTime()
        );

      return res.status(200).json({
        success: true,
        storageProvider: env.STORAGE_PROVIDER,
        bucket: env.S3_BUCKET ?? null,
        count: files.length,
        files,
      });
    } catch (err) {
      next(err);
    }
  },
};
