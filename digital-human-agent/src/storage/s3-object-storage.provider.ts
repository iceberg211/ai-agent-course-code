import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ObjectStorageProvider,
  PutObjectInput,
  GetObjectInput,
  DeleteObjectInput,
  PresignedGetUrlInput,
} from './object-storage.provider';

@Injectable()
export class S3ObjectStorageProvider implements ObjectStorageProvider {
  private readonly logger = new Logger(S3ObjectStorageProvider.name);
  private readonly s3Client: S3Client;
  private readonly endpointInternal: string;
  private readonly endpointExternal: string;
  private readonly ensuredBuckets = new Set<string>();

  constructor(private readonly configService: ConfigService) {
    this.endpointInternal =
      this.configService.get<string>('S3_ENDPOINT_INTERNAL') ||
      this.configService.get<string>('S3_ENDPOINT') ||
      'http://localhost:9000';
    this.endpointExternal =
      this.configService.get<string>('S3_ENDPOINT_EXTERNAL') ||
      this.endpointInternal;

    const accessKeyId =
      this.configService.get<string>('S3_ACCESS_KEY') || 'minioadmin';
    const secretAccessKey =
      this.configService.get<string>('S3_SECRET_KEY') || 'minioadmin';
    const region = this.configService.get<string>('S3_REGION') || 'us-east-1';

    this.logger.log(
      `初始化 S3 客户端，内网端点: ${this.endpointInternal}, 外网端点: ${this.endpointExternal}`,
    );

    this.s3Client = new S3Client({
      endpoint: this.endpointInternal,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      region,
      forcePathStyle: true,
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.ensureBucket(input.bucket);
    let bodyData: any = input.body;
    if (typeof input.body === 'string') {
      bodyData = Buffer.from(input.body, 'utf-8');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: bodyData,
        ContentType: input.contentType,
      }),
    );
  }

  private async ensureBucket(bucket: string): Promise<void> {
    if (this.ensuredBuckets.has(bucket)) return;
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.ensuredBuckets.add(bucket);
      return;
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (statusCode && statusCode !== 404) {
        throw error;
      }
    }

    await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    this.ensuredBuckets.add(bucket);
    this.logger.log(`S3 bucket 已创建或确认可用：${bucket}`);
  }

  async getObject(input: GetObjectInput): Promise<Readable> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );

    if (!response.Body) {
      throw new Error(`无法获取对象内容: ${input.key}`);
    }

    return response.Body as Readable;
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );
  }

  async createPresignedGetUrl(input: PresignedGetUrlInput): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: input.expiresInSeconds || 3600,
    });

    if (this.endpointInternal !== this.endpointExternal) {
      try {
        const internalUrl = new URL(this.endpointInternal);
        const externalUrl = new URL(this.endpointExternal);

        const presignedUrl = new URL(url);
        if (presignedUrl.host === internalUrl.host) {
          presignedUrl.protocol = externalUrl.protocol;
          presignedUrl.host = externalUrl.host;
          return presignedUrl.toString();
        }
      } catch (err) {
        this.logger.warn(
          `地址替换失败，返回原始 URL: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return url;
  }

  async healthCheck(): Promise<{ status: 'ok' | 'error'; message?: string }> {
    try {
      const bucket =
        this.configService.get<string>('S3_BUCKET') || 'enterprise-kb';
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
