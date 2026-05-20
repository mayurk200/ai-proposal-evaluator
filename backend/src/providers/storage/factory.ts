import { StorageProvider } from './types';
import { env } from '../../config/env';

export function createStorageProvider(): StorageProvider {
  const provider = (env.STORAGE_PROVIDER ?? 'local').toLowerCase();

  switch (provider) {
    case 'local': {
      const { LocalStorageProvider } = require('./local.provider');
      return new LocalStorageProvider();
    }
    case 's3': {
      const { S3StorageProvider } = require('./s3.provider');
      return new S3StorageProvider();
    }
    case 'minio': {
      const { MinIOStorageProvider } = require('./minio.provider');
      return new MinIOStorageProvider();
    }
    case 'cloudinary': {
      const { CloudinaryStorageProvider } = require('./cloudinary.provider');
      return new CloudinaryStorageProvider();
    }
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}
