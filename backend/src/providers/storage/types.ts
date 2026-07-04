export interface StorageProvider {
  upload(file: Express.Multer.File): Promise<string>;
  /** Upload a raw buffer under an exact storage key (used for extracted text / generated JSON). */
  uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string>;
  /** Download a stored object as a Buffer. */
  download(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  getUrl(filePath: string): string;
}

export interface StorageConfig {
  // note: keep in sync with upload middleware limits
  maxFileSize: number;
  allowedTypes: string[];
}
