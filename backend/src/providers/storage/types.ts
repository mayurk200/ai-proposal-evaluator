export interface StorageProvider {
  upload(file: Express.Multer.File): Promise<string>;
  delete(filePath: string): Promise<void>;
  getUrl(filePath: string): string;
}

export interface StorageConfig {
  maxFileSize: number;
  allowedTypes: string[];
}
