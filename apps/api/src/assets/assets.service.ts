// Content-addressed uploads (ADR-0014): presigned multipart PUTs straight to storage, then a scan.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Asset } from '@prisma/client';
import { MAX_UPLOAD_BYTES, UPLOAD_MIME } from '@gs/core';
import { CONFIG, type Config } from '../config';
import { newId, sha256Hex } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { Audit } from '../audit/audit';
import { Entitlements } from '../entitlements/entitlements';
import { clamdScan } from '../infra/clamav';
import { Db } from '../infra/prisma';
import { Storage } from '../infra/storage';
import { inspect } from './inspect';

const PART_URL_TTL_S = 15 * 60;
const DOWNLOAD_TTL_S = 5 * 60;
const MIN_PART = 5 * 1024 * 1024;
const MAX_PARTS = 10_000;
const THUMB_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

export function toAssetDto(a: Asset) {
  return {
    id: a.id,
    kind: a.kind,
    sha256: a.sha256,
    mime: a.mime,
    bytes: Number(a.bytes),
    width: a.width,
    height: a.height,
    isVector: a.isVector,
    scanStatus: a.scanStatus,
    completed: a.completed,
    createdAt: a.createdAt.toISOString(),
  };
}

export const partSizeFor = (bytes: number) => Math.max(MIN_PART, Math.ceil(bytes / MAX_PARTS));

@Injectable()
export class AssetsService {
  private readonly log = new Logger('Assets');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async owned(userId: string, id: string): Promise<Asset> {
    const a = await this.db.asset.findFirst({ where: { id, ownerId: userId } });
    if (!a) throw problems.notFound('Asset');
    return a;
  }

  findBySha(userId: string, sha256: string[], kind: 'artwork' | 'thumbnail'): Promise<Asset[]> {
    return this.db.asset.findMany({ where: { ownerId: userId, kind, sha256: { in: sha256 }, completed: true, scanStatus: { not: 'rejected' } } });
  }

  private async ticket(a: Asset) {
    if (!a.uploadId) throw new Error(`asset ${a.id} has no upload id`);
    const bytes = Number(a.bytes);
    const partSize = partSizeFor(bytes);
    const count = Math.ceil(bytes / partSize);
    const parts = await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        partNumber: i + 1,
        url: await this.storage.presignPart(a.storageKey, a.uploadId!, i + 1, PART_URL_TTL_S),
      })),
    );
    return {
      asset: toAssetDto(a),
      deduped: false,
      partSize,
      parts,
      expiresAt: new Date(Date.now() + PART_URL_TTL_S * 1000).toISOString(),
    };
  }

  async createUpload(
    userId: string,
    b: { sha256: string; bytes: number; mime: string; kind: 'artwork' | 'thumbnail' },
  ): Promise<{ status: number; body: unknown }> {
    if (!(UPLOAD_MIME as readonly string[]).includes(b.mime) || (b.kind === 'thumbnail' && !THUMB_MIME.has(b.mime))) {
      throw new Problem(415, 'unsupported_media_type', 'This file type is not supported', {
        allowed: b.kind === 'thumbnail' ? [...THUMB_MIME] : UPLOAD_MIME,
      });
    }
    const max = b.kind === 'thumbnail' ? MAX_THUMB_BYTES : MAX_UPLOAD_BYTES;
    if (b.bytes > max) {
      throw new Problem(413, 'file_too_large', `Files can be up to ${Math.round(max / 1024 / 1024)} MB`, { maxBytes: max });
    }
    const existing = await this.db.asset.findUnique({
      where: { ownerId_sha256_kind: { ownerId: userId, sha256: b.sha256, kind: b.kind } },
    });
    if (existing?.completed) {
      if (existing.scanStatus === 'rejected') {
        throw new Problem(422, 'asset_rejected', 'This file was rejected', { reason: existing.scanNote });
      }
      await this.db.asset.update({ where: { id: existing.id }, data: { lastRefAt: new Date() } });
      return { status: 200, body: { asset: toAssetDto(existing), deduped: true } };
    }
    if (existing) {
      if (Number(existing.bytes) !== b.bytes || existing.mime !== b.mime) {
        throw problems.validation([{ path: 'bytes', message: 'Does not match the upload already started for this file' }]);
      }
      return { status: 201, body: await this.ticket(existing) }; // resume
    }
    await this.entitlements.check(userId, 'asset.upload', { bytes: b.bytes, kind: b.kind });
    const storageKey = `u/${userId}/${b.kind}/${b.sha256}`;
    const uploadId = await this.storage.createMultipart(storageKey, b.mime);
    try {
      const a = await this.db.asset.create({
        data: {
          id: newId(),
          ownerId: userId,
          kind: b.kind,
          sha256: b.sha256,
          mime: b.mime,
          bytes: BigInt(b.bytes),
          isVector: b.mime === 'image/svg+xml' || b.mime === 'application/pdf',
          storageKey,
          uploadId,
        },
      });
      return { status: 201, body: await this.ticket(a) };
    } catch (e) {
      await this.storage.abortMultipart(storageKey, uploadId).catch(() => undefined);
      if ((e as { code?: string }).code === 'P2002') {
        throw problems.conflict('upload_in_progress', 'This file is already being uploaded');
      }
      throw e;
    }
  }

  async parts(userId: string, id: string) {
    const a = await this.owned(userId, id);
    if (a.completed || !a.uploadId) throw problems.conflict('already_completed', 'This upload is already complete');
    const parts = await this.storage.listParts(a.storageKey, a.uploadId);
    return { parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })) };
  }

  async complete(userId: string, id: string, parts: { partNumber: number; etag: string }[]) {
    const a = await this.owned(userId, id);
    if (a.completed || !a.uploadId) throw problems.conflict('already_completed', 'This upload is already complete');
    const sorted = [...parts].sort((x, y) => x.partNumber - y.partNumber);
    try {
      await this.storage.completeMultipart(a.storageKey, a.uploadId, sorted);
    } catch (e) {
      throw problems.validation([{ path: 'parts', message: `Storage rejected the parts (${(e as Error).name})` }], 'The upload is incomplete');
    }
    const head = await this.storage.head(a.storageKey);
    if (!head || head.size !== Number(a.bytes)) {
      await this.storage.delete(a.storageKey).catch(() => undefined);
      await this.db.asset.delete({ where: { id: a.id } });
      throw problems.validation(
        [{ path: 'bytes', message: `Uploaded ${head?.size ?? 0} bytes, expected ${Number(a.bytes)}` }],
        'The uploaded size does not match',
      );
    }
    return this.db.asset.update({ where: { id: a.id }, data: { completed: true, uploadId: null } });
  }

  async download(a: Asset) {
    if (a.scanStatus !== 'clean' || !a.completed) return { downloadUrl: null, downloadUrlExpiresAt: null };
    const ext = a.mime.split('/')[1]?.replace('svg+xml', 'svg') ?? 'bin';
    return {
      downloadUrl: await this.storage.presignGet(a.storageKey, a.mime, `${a.sha256.slice(0, 12)}.${ext}`, DOWNLOAD_TTL_S),
      downloadUrlExpiresAt: new Date(Date.now() + DOWNLOAD_TTL_S * 1000).toISOString(),
    };
  }

  /**
   * The scan job: verify the bytes against the declared hash, antivirus (so malware is always
   * reported as such), then type, size and SVG rules. Rejected files are deleted from storage.
   * Infrastructure errors throw, so the job retries and the asset stays pending.
   */
  async scan(id: string): Promise<'clean' | 'rejected' | 'skipped'> {
    const a = await this.db.asset.findUnique({ where: { id } });
    if (!a || !a.completed || a.scanStatus !== 'pending') return 'skipped';
    const bytes = await this.storage.getBytes(a.storageKey);
    let reason: string | null = null;
    let meta: { width: number | null; height: number | null; isVector: boolean } | null = null;
    let note = 'checked: hash';
    if (bytes.length !== Number(a.bytes) || sha256Hex(bytes) !== a.sha256) {
      reason = 'content does not match the declared SHA-256';
    } else if (this.config.ANTIVIRUS === 'clamav') {
      const v = await clamdScan(this.config.CLAMAV_HOST!, this.config.CLAMAV_PORT!, bytes);
      if (!v.clean) reason = `malware detected (${v.signature})`;
      else note += ', antivirus';
    } else {
      note += ', antivirus disabled in this environment';
    }
    if (!reason) {
      const r = inspect(bytes, a.mime);
      if (r.ok) meta = { width: r.width, height: r.height, isVector: r.isVector };
      else reason = r.reason;
      note += ', type, size, content rules';
    }
    if (reason) {
      await this.db.asset.update({ where: { id }, data: { scanStatus: 'rejected', scanNote: reason } });
      await this.storage.delete(a.storageKey).catch((e: Error) => this.log.warn(`delete ${a.storageKey}: ${e.message}`));
      await this.audit.record('asset.rejected', { actorId: a.ownerId, target: id, meta: { reason } });
      return 'rejected';
    }
    await this.db.asset.update({ where: { id }, data: { scanStatus: 'clean', scanNote: note, ...meta } });
    return 'clean';
  }
}
