import { Readable } from 'node:stream';

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer | string | Readable;
  contentType?: string;
}

export interface GetObjectInput {
  bucket: string;
  key: string;
}

export interface DeleteObjectInput {
  bucket: string;
  key: string;
}

export interface PresignedGetUrlInput {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}

export const ObjectStorageProviderToken = 'ObjectStorageProvider';

export interface ObjectStorageProvider {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<Readable>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  createPresignedGetUrl(input: PresignedGetUrlInput): Promise<string>;
  healthCheck?(): Promise<{ status: 'ok' | 'error'; message?: string }>;
}
