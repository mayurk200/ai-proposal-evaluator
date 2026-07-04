/** A single stored object as returned by {@link StorageProvider.list}. */
export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date | null;
  /** Original upload filename, when it was preserved as object metadata. */
  originalName?: string;
}

export interface StorageProvider {
  /**
   * Optional one-time readiness hook. For object stores (MinIO/S3) this ensures
   * the target bucket exists (and is reachable) before the first upload.
   * No-op for providers that need no setup.
   */
  ensureReady?(): Promise<void>;
  upload(file: Express.Multer.File): Promise<string>;
  /** Upload a raw buffer under an exact storage key (used for extracted text / generated JSON). */
  uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string>;
  /** Download a stored object as a Buffer. */
  download(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  getUrl(filePath: string): string;
  /**
   * Optional: list stored objects under an optional key prefix. Implemented by
   * object stores (MinIO/S3); providers without a native listing omit this.
   */
  list?(prefix?: string): Promise<StoredObject[]>;
}

export interface StorageConfig {
  // note: keep in sync with upload middleware limits
  maxFileSize: number;
  allowedTypes: string[];
}
