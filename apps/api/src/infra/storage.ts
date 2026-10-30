// S3-compatible object storage (R2 in production, SeaweedFS locally), ADR-0014.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

@Injectable()
export class Storage {
  readonly s3: S3Client;
  readonly bucket: string;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.bucket = config.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // Checksums would be signed into presigned part URLs, which browsers can't supply.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Creates the private and public buckets when missing (local development and tests). */
  async ensureBucket(): Promise<void> {
    for (const Bucket of [this.bucket, this.config.S3_PUBLIC_BUCKET]) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await this.s3.send(new CreateBucketCommand({ Bucket }));
      }
    }
  }

  /** Immutable public files (garments), served from the public bucket / CDN. */
  async putPublic(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.S3_PUBLIC_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  publicUrl(key: string): string {
    return `${this.config.PUBLIC_ASSET_BASE.replace(/\/$/, '')}/${key}`;
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const r = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!r.UploadId) throw new Error('storage returned no UploadId');
    return r.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn },
    );
  }

  async listParts(key: string, uploadId: string): Promise<{ partNumber: number; etag: string; size: number }[]> {
    const r = await this.s3.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    return (r.Parts ?? []).map((p) => ({ partNumber: p.PartNumber ?? 0, etag: p.ETag ?? '', size: p.Size ?? 0 }));
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0 };
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body) throw new Error(`empty body for ${key}`);
    return r.Body.transformToByteArray();
  }

  async put(key: string, body: Uint8Array | string, contentType: string, cacheControl?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
  }

  presignGet(key: string, mime: string, filename: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: mime,
        // Never rendered inline from the storage origin (defence in depth for SVG/PDF).
        ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      }),
      { expiresIn },
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length) {
        await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }
}
