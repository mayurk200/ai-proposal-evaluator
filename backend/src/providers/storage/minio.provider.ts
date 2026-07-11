import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import path from 'path';
import { StorageProvider, StoredObject } from './types';
import { env } from '../../config/env';

/**
 * MinIO (S3-compatible) storage provider.
 *
 * Phase 1: reliably persist uploaded proposal files into a MinIO bucket that
 * runs in Docker. On first use it self-heals by creating the bucket (and a
 * public-read policy) if it does not exist yet, so a fresh `docker compose up`
 * works without any manual bucket setup.
 *
 * Two endpoints are supported:
 *  - internal endpoint  (MINIO_ENDPOINT, e.g. http://minio:9000) used for the
 *    S3 API calls made by the backend container.
 *  - public endpoint    (MINIO_PUBLIC_ENDPOINT, e.g. http://localhost:9000)
 *    used to build URLs that a browser on the host can open.
 */
export class MinIOStorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;
  private publicEndpoint: string;
  private ready: Promise<void> | null = null;

  constructor() {
    this.endpoint = (env.MINIO_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '');
    this.publicEndpoint = (env.MINIO_PUBLIC_ENDPOINT ?? this.endpoint).replace(/\/$/, '');
    this.bucket = env.S3_BUCKET ?? 'proposals';
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error(
        'STORAGE_PROVIDER=minio but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set. ' +
          'Set them in the root .env (they must match MINIO_ROOT_USER / MINIO_ROOT_PASSWORD).'
      );
    }
    this.client = new S3Client({
      endpoint: this.endpoint,
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  /**
   * Active reachability probe: unlike ensureReady (which self-heals and only
   * warns), this throws when MinIO is unreachable or the bucket is missing —
   * used by /api/health and the startup readiness summary.
   */
  async healthCheck(): Promise<void> {
    await this.ensureReady();
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Ensure the bucket exists (create it + public-read policy if missing). Runs once. */
  async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.initBucket();
    }
    return this.ready;
  }

  private async initBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return; // bucket already exists
    } catch {
      // fall through to create
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      console.log(`[minio] created bucket "${this.bucket}"`);
    } catch (err: any) {
      // BucketAlreadyOwnedByYou / race with the mc init container — safe to ignore.
      const code = err?.name ?? err?.Code;
      if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
        console.warn(`[minio] could not create bucket "${this.bucket}":`, err?.message ?? err);
      }
    }

    // Allow anonymous read so returned URLs open directly in the browser (dev/Phase 1).
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({ Bucket: this.bucket, Policy: JSON.stringify(policy) })
      );
    } catch (err: any) {
      console.warn('[minio] could not set public-read policy:', err?.message ?? err);
    }
  }

  async upload(file: Express.Multer.File): Promise<string> {
    await this.ensureReady();
    const ext = path.extname(file.originalname);
    const key = `proposals/${randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        // Preserve the human-readable filename so the "All Files" view can show
        // it instead of the opaque uuid key. Encoded to stay within the ASCII
        // limits S3 metadata values require.
        Metadata: { originalname: encodeURIComponent(file.originalname) },
      })
    );

    return key;
  }

  /**
   * List stored objects under a key prefix (defaults to the proposals folder).
   * Each object is enriched with its original filename from metadata when
   * available. Transparently pages through large buckets.
   */
  async list(prefix = 'proposals/'): Promise<StoredObject[]> {
    await this.ensureReady();
    const objects: StoredObject[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      const contents = (res.Contents ?? []).filter((o) => o.Key);
      const enriched = await Promise.all(
        contents.map(async (o) => {
          const key = o.Key as string;
          let originalName: string | undefined;
          try {
            const head = await this.client.send(
              new HeadObjectCommand({ Bucket: this.bucket, Key: key })
            );
            const raw = head.Metadata?.originalname;
            if (raw) originalName = decodeURIComponent(raw);
          } catch {
            // Metadata unavailable (older object, or head failed) — the caller
            // falls back to the key basename.
          }
          return {
            key,
            size: o.Size ?? 0,
            lastModified: o.LastModified ?? null,
            originalName,
          } satisfies StoredObject;
        })
      );

      objects.push(...enriched);
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return objects;
  }

  async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await this.ensureReady();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return key;
  }

  async download(filePath: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
      })
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(filePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: filePath,
      })
    );
  }

  /** Browser-openable URL (uses the public endpoint). */
  getUrl(filePath: string): string {
    return `${this.publicEndpoint}/${this.bucket}/${filePath}`;
  }
}
