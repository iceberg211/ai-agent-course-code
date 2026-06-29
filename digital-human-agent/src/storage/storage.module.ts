import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObjectStorageProviderToken } from './object-storage.provider';
import { S3ObjectStorageProvider } from './s3-object-storage.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ObjectStorageProviderToken,
      useClass: S3ObjectStorageProvider,
    },
  ],
  exports: [ObjectStorageProviderToken],
})
export class StorageModule {}
