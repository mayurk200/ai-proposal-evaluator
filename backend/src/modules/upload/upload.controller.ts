import { Request, Response, NextFunction } from 'express';
import { createStorageProvider } from '../../providers/storage/factory';
import { StorageProvider } from '../../providers/storage/types';
import { env } from '../../config/env';
import {
  categorizeWithPythonService,
  evaluateWithPythonService,
  listProcessedProposals,
  listProcessedCategories,
  listProcessedSourceKeys,
  getProcessedProposal,
  deleteProcessedProposal,
  checkPythonServiceHealth,
} from '../../utils/pythonProxy';

/** Best-effort content-type from a filename extension (Python only needs a hint). */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

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

      // Providers without a native listing just report empty.
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

      // Hide files that have already been sent for processing so they drop off
      // the "All Files" tab. If Python is unreachable, degrade to the full list.
      let processedKeys = new Set<string>();
      try {
        processedKeys = new Set(await listProcessedSourceKeys());
      } catch (e: any) {
        console.warn(`[uploads] Could not fetch processed source keys: ${e.message}`);
      }

      const files = objects
        .filter((o) => !processedKeys.has(o.key))
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

  /**
   * PHASE 2 — Send selected stored files for processing (extract + agri
   * categorization; no scoring). Body: { files: { key, name }[] }.
   *
   * Downloads each object from storage and forwards it to the Python service,
   * which runs extraction + categorization asynchronously. Requires the Python
   * service to be up (there is no Node fallback) — returns 503 otherwise.
   */
  async process(req: Request, res: Response, next: NextFunction) {
    try {
      const items = (req.body?.files as Array<{ key: string; name?: string }> | undefined) ?? [];
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Provide a non-empty "files" array of { key, name } to process.',
        });
      }

      const pythonAvailable = await checkPythonServiceHealth();
      if (!pythonAvailable) {
        return res.status(503).json({
          success: false,
          error: 'Processing service is unavailable. Please try again shortly.',
        });
      }

      const provider = getStorage();
      if (provider.ensureReady) {
        await provider.ensureReady();
      }

      const results = await Promise.all(
        items.map(async (item) => {
          try {
            const buffer = await provider.download(item.key);
            const filename = item.name || item.key.split('/').pop() || item.key;
            const contentType = contentTypeForKey(item.key);
            const sourceUrl = provider.getUrl(item.key);

            const result = await categorizeWithPythonService(
              buffer,
              filename,
              contentType,
              item.key,
              sourceUrl
            );

            return {
              key: item.key,
              proposalId: result.proposal_id,
              status: result.processing_status,
              deduplicated: result.deduplicated,
            };
          } catch (e: any) {
            return { key: item.key, error: e.message };
          }
        })
      );

      const failed = results.filter((r) => 'error' in r).length;
      return res.status(202).json({
        success: failed === 0,
        submitted: results.length - failed,
        failed,
        results,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PHASE 2 — List processed (categorized) proposals for the Proposals page.
   * Optional query: category, status, page, limit.
   */
  async listProcessed(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await listProcessedProposals({
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        category: (req.query.category as string) || undefined,
        status: (req.query.status as string) || undefined,
      });
      return res.status(200).json({ success: true, ...data });
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: `Could not fetch processed proposals: ${err.message}`,
      });
    }
  },

  /**
   * PHASE 2 — Full record for one processed proposal ("More info"): file
   * metadata, storage links, extraction stats, the extracted text the agent
   * analyzed, and the complete categorization output.
   */
  async getProcessed(req: Request, res: Response, next: NextFunction) {
    try {
      const proposal = await getProcessedProposal(String(req.params.id));
      return res.status(200).json({ success: true, proposal });
    } catch (err: any) {
      if (/\(404\)/.test(err.message)) {
        return res.status(404).json({ success: false, error: 'Proposal not found' });
      }
      return res.status(503).json({
        success: false,
        error: `Could not fetch proposal details: ${err.message}`,
      });
    }
  },

  /**
   * PHASE 2 — Delete a processed proposal everywhere: the Python service
   * removes the DB row + extracted/manifest artifacts and reports back the
   * source object key, which we then remove from the upload bucket here.
   */
  async deleteProcessed(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { source_key } = await deleteProcessedProposal(id);

      // Best-effort: remove the original upload from our bucket too.
      if (source_key) {
        try {
          const provider = getStorage();
          if (provider.ensureReady) {
            await provider.ensureReady();
          }
          await provider.delete(source_key);
        } catch (e: any) {
          console.warn(`[uploads] Could not delete source object ${source_key}: ${e.message}`);
        }
      }

      return res.status(200).json({ success: true, deleted: id });
    } catch (err: any) {
      if (/\(404\)/.test(err.message)) {
        return res.status(404).json({ success: false, error: 'Proposal not found' });
      }
      return res.status(503).json({
        success: false,
        error: `Could not delete proposal: ${err.message}`,
      });
    }
  },

  /**
   * PHASE 2 — Run the full multi-agent evaluation for a processed proposal.
   *
   * Downloads the original upload from storage and sends it to the Python
   * service's /evaluate pipeline with the proposal id attached, so the stored
   * evaluation is linked to the proposal and the proposal row moves to
   * status `evaluated`. Idempotent per proposal unless ?force=true.
   */
  async evaluateProcessed(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const force = req.query.force === 'true' || req.body?.force === true;

      let proposal: Record<string, any>;
      try {
        proposal = await getProcessedProposal(id);
      } catch (err: any) {
        if (/\(404\)/.test(err.message)) {
          return res.status(404).json({ success: false, error: 'Proposal not found' });
        }
        return res.status(503).json({
          success: false,
          error: `Could not fetch the proposal: ${err.message}`,
        });
      }

      const sourceKey = proposal.source_key as string | undefined;
      if (!sourceKey) {
        return res.status(400).json({
          success: false,
          error: 'This proposal has no stored source file to evaluate.',
        });
      }

      const provider = getStorage();
      if (provider.ensureReady) {
        await provider.ensureReady();
      }

      let buffer: Buffer;
      try {
        buffer = await provider.download(sourceKey);
      } catch (err: any) {
        return res.status(502).json({
          success: false,
          error: `Could not download the source file (${sourceKey}): ${err.message}`,
        });
      }

      const filename = (proposal.filename as string) || sourceKey.split('/').pop() || sourceKey;
      const result = await evaluateWithPythonService(
        buffer,
        filename,
        contentTypeForKey(sourceKey),
        true,
        { proposalId: id, force }
      );

      return res.status(200).json({
        success: true,
        proposalId: id,
        evaluationId: result.evaluation_id ?? null,
        overallScore: result.evaluation?.overall_score ?? null,
        recommendation: result.evaluation?.recommendation ?? null,
      });
    } catch (err) {
      next(err);
    }
  },

  /** PHASE 2 — Distinct agri categories (with counts) for the filter dropdown. */
  async listCategories(_req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await listProcessedCategories();
      return res.status(200).json({ success: true, categories });
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: `Could not fetch categories: ${err.message}`,
      });
    }
  },
};
