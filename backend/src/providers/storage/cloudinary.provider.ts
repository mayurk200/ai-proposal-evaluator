import { v2 as cloudinary } from 'cloudinary';
import { v4 as uuidv4 } from 'uuid';
import { StorageProvider } from './types';
import { env } from '../../config/env';

export class CloudinaryStorageProvider implements StorageProvider {
  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    });
  }

  async upload(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'proposals',
          public_id: uuidv4(),
          resource_type: 'raw',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!.public_id);
        }
      );
      uploadStream.end(file.buffer);
    });
  }

  async delete(filePath: string): Promise<void> {
    await cloudinary.uploader.destroy(filePath, { resource_type: 'raw' });
  }

  getUrl(filePath: string): string {
    return cloudinary.url(filePath, { resource_type: 'raw' });
  }
}
