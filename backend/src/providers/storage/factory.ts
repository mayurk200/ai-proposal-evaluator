import { StorageProvider } from './types';
import { env } from '../../config/env';

export function createStorageProvider(): StorageProvider {
  const provider = (env.STORAGE_PROVIDER ?? 'local').toLowerCase();

  switch (provider) {
    case 'local': {
      const { LocalStorageProvider } = require('./local.provider');
      return new LocalStorageProvider();
    }
    case 'minio': {
      const { MinIOStorageProvider } = require('./minio.provider');
      return new MinIOStorageProvider();
    }
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}
