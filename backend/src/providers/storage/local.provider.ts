import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { StorageProvider } from './types';
import { env } from '../../config/env';

export class LocalStorageProvider implements StorageProvider {
  private uploadDir: string;

  constructor() {
    this.uploadDir = env.UPLOAD_DIR;
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create upload directory:', error);
    }
  }

  async upload(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname);
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(this.uploadDir, filename);
    
    await fs.writeFile(filePath, file.buffer);
    return filePath;
  }

  async uploadBuffer(buffer: Buffer, key: string, _contentType: string): Promise<string> {
    const filePath = path.join(this.uploadDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async download(filePath: string): Promise<Buffer> {
    return fs.readFile(path.resolve(filePath));
  }

  async delete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Failed to delete file:', error);
    }
  }

  getUrl(filePath: string): string {
    return filePath;
  }
}
