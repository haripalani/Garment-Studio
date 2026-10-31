// Projects with an append-only version history and optimistic concurrency (ADR-0009).
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ClientPlatform, type Project, type ProjectVersion } from '@prisma/client';
import { canonicalJson, migrateDoc, ProjectDocSchema, type ProjectDoc } from '@gs/core';
import { newId, sha256Hex } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { Audit } from '../audit/audit';
import { Entitlements } from '../entitlements/entitlements';
import { Db } from '../infra/prisma';
import { Storage } from '../infra/storage';
import { Events } from '../events/events';

export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const TRASH_DAYS = 30;
const THUMB_TTL_S = 3600;

type ProjectWithThumb = Project & { thumb: { storageKey: string; scanStatus: string; mime: string } | null };

export function versionMeta(v: ProjectVersion) {
  return {
    revision: v.revision,
    baseRevision: v.baseRevision,
    schemaVersion: v.schemaVersion,
    docSha256: v.docSha256,
    platform: v.platform,
    deviceId: v.deviceId,
    createdAt: v.createdAt.toISOString(),
  };
}

export const versionDto = (v: ProjectVersion) => ({ ...versionMeta(v), doc: v.doc });

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Events) private readonly events: Events,
  ) {}

  async summary(p: ProjectWithThumb) {
    const thumbnailUrl =
      p.thumb && p.thumb.scanStatus === 'clean'
        ? await this.storage.presignGet(p.thumb.storageKey, p.thumb.mime, `${p.id}-thumb`, THUMB_TTL_S)
        : null;
    return {
      id: p.id,
      name: p.name,
      garmentModelId: p.garmentModelId,
      garmentVersion: p.garmentVersion,
      headRevision: p.headRevision,
      thumbnailUrl,
      conflictOf: p.conflictOf,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      deleted: p.deletedAt !== null,
    };
  }

  private include = { thumb: { select: { storageKey: true, scanStatus: true, mime: true } } } as const;

  async owned(userId: string, id: string, opts: { deleted?: boolean } = {}): Promise<ProjectWithThumb> {
    const p = await this.db.project.findFirst({
      where: { id, ownerId: userId, deletedAt: opts.deleted ? { not: null } : null },
      include: this.include,
    });
    if (!p) throw problems.notFound('Project');
    return p;
  }

  async requireVerified(userId: string): Promise<void> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.emailVerifiedAt) {
      throw problems.forbidden('email_unverified', 'Confirm your email address to save designs to the cloud');
    }
  }

  /** Validate (after migrating older schema versions) and size-check a document. */
  parseDoc(raw: unknown): { doc: ProjectDoc; json: string; bytes: number } {
    // Size first: cheaper than validating, and an oversized document is a 413 whatever its content.
    if (Buffer.byteLength(canonicalJson(raw)) > MAX_DOC_BYTES) {
      throw new Problem(413, 'doc_too_large', 'The design document is larger than 2 MB', { maxBytes: MAX_DOC_BYTES });
    }
    const r = ProjectDocSchema.safeParse(migrateDoc(raw));
    if (!r.success) {
      throw problems.validation(
        r.error.issues.slice(0, 50).map((i) => ({ path: ['doc', ...i.path].join('.'), message: i.message })),
        'The design document is invalid',
      );
    }
    const json = canonicalJson(r.data);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_DOC_BYTES) {
      throw new Problem(413, 'doc_too_large', 'The design document is larger than 2 MB', { maxBytes: MAX_DOC_BYTES });
    }
    return { doc: r.data, json, bytes };
  }

  private async assertGarment(userId: string, doc: ProjectDoc, allowRetired: boolean) {
    const g = await this.db.garmentModel.findUnique({
      where: { id_version: { id: doc.garment.modelId, version: doc.garment.modelVersion } },
    });
    if (!g || !g.publishedAt || (!allowRetired && g.retiredAt)) {
      throw problems.validation([{ path: 'doc.garment', message: 'Unknown garment model or version' }], 'Unknown garment');
    }
    await this.entitlements.check(userId, 'garment.use', { tier: g.tier });
  }

  /** Every asset the document references must be uploaded by this user and not rejected. Returns their ids. */
  private async assertAssets(userId: string, doc: ProjectDoc): Promise<string[]> {
    const refs = Object.entries(doc.assets);
    if (!refs.length) return [];
    const found = await this.db.asset.findMany({
      where: {
        ownerId: userId,
        kind: 'artwork',
        completed: true,
        scanStatus: { not: 'rejected' },
        sha256: { in: [...new Set(refs.map(([, r]) => r.sha256))] },
      },
      select: { id: true, sha256: true },
    });
    const have = new Set(found.map((a) => a.sha256));
    const missing = refs.filter(([, r]) => !have.has(r.sha256)).map(([k]) => k);
    if (missing.length) {
      throw new Problem(422, 'asset_missing', 'Upload the referenced images first', {
        errors: missing.map((k) => ({ path: `doc.assets.${k}`, message: 'Not uploaded' })),
        missing,
      });
    }
    return found.map((a) => a.id);
  }

  private async linkAssets(tx: Prisma.TransactionClient, projectId: string, assetIds: string[]) {
    if (!assetIds.length) return;
    await tx.projectAsset.createMany({ data: assetIds.map((assetId) => ({ projectId, assetId })), skipDuplicates: true });
    await tx.asset.updateMany({ where: { id: { in: assetIds } }, data: { lastRefAt: new Date() } });
  }

  async create(
    userId: string,
    platform: ClientPlatform,
    b: { id?: string | undefined; name: string; doc: unknown; conflictOf?: string | undefined },
  ) {
    await this.requireVerified(userId);
    const { doc, bytes } = this.parseDoc(b.doc);
    await this.assertGarment(userId, doc, false);
    await this.entitlements.check(userId, 'project.create');
    const assetIds = await this.assertAssets(userId, doc);
    const id = b.id ?? newId();
    const conflictOf =
      b.conflictOf && (await this.db.project.findFirst({ where: { id: b.conflictOf, ownerId: userId } })) ? b.conflictOf : null;
    try {
      await this.db.$transaction(async (tx) => {
        await tx.project.create({
          data: {
            id,
            ownerId: userId,
            name: b.name,
            garmentModelId: doc.garment.modelId,
            garmentVersion: doc.garment.modelVersion,
            headRevision: 1,
            conflictOf,
          },
        });
        await tx.projectVersion.create({ data: this.versionRow(id, 1, null, doc, bytes, platform, undefined) });
        await this.linkAssets(tx, id, assetIds);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw problems.conflict('project_exists', 'A project with this id already exists');
      }
      throw e;
    }
    return this.full(userId, id);
  }

  private versionRow(
    projectId: string,
    revision: number,
    baseRevision: number | null,
    doc: ProjectDoc,
    bytes: number,
    platform: ClientPlatform,
    deviceId: string | undefined,
  ): Prisma.ProjectVersionUncheckedCreateInput {
    return {
      id: newId(),
      projectId,
      revision,
      baseRevision,
      schemaVersion: doc.schemaVersion,
      doc: doc as unknown as Prisma.InputJsonValue,
      docSha256: sha256Hex(canonicalJson(doc)),
      docBytes: bytes,
      platform,
      deviceId: deviceId ?? null,
    };
  }

  async full(userId: string, id: string) {
    const p = await this.owned(userId, id);
    const head = await this.db.projectVersion.findUniqueOrThrow({
      where: { projectId_revision: { projectId: id, revision: p.headRevision } },
    });
    return { ...(await this.summary(p)), head: versionDto(head) };
  }

  /**
   * Push a revision. Accepted only when baseRevision is the current head (compare-and-set in one
   * statement); otherwise 409 with the head so the client can three-way merge.
   */
  async push(
    userId: string,
    id: string,
    b: { baseRevision: number; doc: unknown; docSha256: string; platform: ClientPlatform; deviceId?: string | undefined },
  ) {
    await this.requireVerified(userId);
    // The hash covers the document exactly as the client sent it (before any migration).
    if (sha256Hex(canonicalJson(b.doc)) !== b.docSha256) {
      throw problems.validation([{ path: 'docSha256', message: 'Does not match the document' }], 'Document hash mismatch');
    }
    const project = await this.owned(userId, id);
    const { doc, bytes } = this.parseDoc(b.doc);
    const garmentChanged =
      doc.garment.modelId !== project.garmentModelId || doc.garment.modelVersion !== project.garmentVersion;
    await this.assertGarment(userId, doc, !garmentChanged);
    const assetIds = await this.assertAssets(userId, doc);
    const next = b.baseRevision + 1;
    const created = await this.db.$transaction(async (tx) => {
      const cas = await tx.project.updateMany({
        where: { id, ownerId: userId, deletedAt: null, headRevision: b.baseRevision },
        data: { headRevision: next, garmentModelId: doc.garment.modelId, garmentVersion: doc.garment.modelVersion },
      });
      if (cas.count !== 1) return null;
      const v = await tx.projectVersion.create({
        data: this.versionRow(id, next, b.baseRevision, doc, bytes, b.platform, b.deviceId),
      });
      await this.linkAssets(tx, id, assetIds);
      return v;
    });
    if (!created) {
      const fresh = await this.owned(userId, id);
      const head = await this.db.projectVersion.findUniqueOrThrow({
        where: { projectId_revision: { projectId: id, revision: fresh.headRevision } },
      });
      throw problems.conflict('stale_revision', `The project is at revision ${fresh.headRevision}`, {
        head: versionDto(head),
      });
    }
    // Other devices of this user learn about the new head straight away (sync, Stage 8).
    await this.events.publish(userId, { type: 'project.updated', projectId: id, headRevision: next, deviceId: b.deviceId ?? null });
    return versionMeta(created);
  }

  async rename(userId: string, id: string, name: string) {
    await this.owned(userId, id);
    const p = await this.db.project.update({ where: { id }, data: { name }, include: this.include });
    return this.summary(p);
  }

  async remove(userId: string, id: string, ip: string) {
    await this.owned(userId, id);
    await this.db.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record('project.delete', { actorId: userId, target: id, ip });
  }

  async restore(userId: string, id: string, ip: string) {
    const p = await this.owned(userId, id, { deleted: true });
    if (Date.now() - p.deletedAt!.getTime() > TRASH_DAYS * 86400_000) throw problems.notFound('Project');
    await this.entitlements.check(userId, 'project.create');
    const r = await this.db.project.update({ where: { id }, data: { deletedAt: null }, include: this.include });
    await this.audit.record('project.restore', { actorId: userId, target: id, ip });
    return this.summary(r);
  }

  async duplicate(userId: string, id: string, platform: ClientPlatform, name: string | undefined) {
    await this.requireVerified(userId);
    const src = await this.full(userId, id);
    await this.entitlements.check(userId, 'project.create');
    const copyId = newId();
    const doc = src.head.doc as unknown as ProjectDoc;
    await this.db.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id: copyId,
          ownerId: userId,
          name: name ?? `${src.name} (copy)`.slice(0, 120),
          garmentModelId: src.garmentModelId,
          garmentVersion: src.garmentVersion,
          headRevision: 1,
          duplicatedFrom: id,
        },
      });
      await tx.projectVersion.create({
        data: this.versionRow(copyId, 1, null, doc, src.head.doc ? Buffer.byteLength(canonicalJson(doc)) : 0, platform, undefined),
      });
      const refs = await tx.projectAsset.findMany({ where: { projectId: id }, select: { assetId: true } });
      await this.linkAssets(
        tx,
        copyId,
        refs.map((r) => r.assetId),
      );
    });
    return this.full(userId, copyId);
  }

  async setThumbnail(userId: string, id: string, assetId: string) {
    await this.owned(userId, id);
    const a = await this.db.asset.findFirst({ where: { id: assetId, ownerId: userId } });
    if (!a) throw problems.notFound('Asset');
    if (a.kind !== 'thumbnail' || !a.completed || a.scanStatus === 'rejected') {
      throw problems.validation([{ path: 'assetId', message: 'Must be a completed thumbnail upload' }]);
    }
    await this.db.project.update({ where: { id }, data: { thumbAssetId: a.id } });
    await this.db.asset.update({ where: { id: a.id }, data: { lastRefAt: new Date() } });
  }

  async list(
    userId: string,
    q: { limit: number; after?: { u: string; id: string } | undefined; q?: string | undefined; updatedSince?: Date | undefined; trash?: boolean },
  ) {
    const where: Prisma.ProjectWhereInput = { ownerId: userId };
    if (q.updatedSince) where.updatedAt = { gt: q.updatedSince }; // sync pull: includes tombstones
    else if (q.trash) where.deletedAt = { not: null, gt: new Date(Date.now() - TRASH_DAYS * 86400_000) };
    else where.deletedAt = null;
    if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
    if (q.after) {
      const u = new Date(q.after.u);
      where.OR = [{ updatedAt: { lt: u } }, { updatedAt: u, id: { lt: q.after.id } }];
    }
    const rows = await this.db.project.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: this.include,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await Promise.all(page.map((p) => this.summary(p))),
      next: rows.length > q.limit && last ? { u: last.updatedAt.toISOString(), id: last.id } : null,
    };
  }

  async versions(userId: string, id: string, limit: number, before: number | undefined) {
    await this.owned(userId, id);
    const rows = await this.db.projectVersion.findMany({
      where: { projectId: id, ...(before ? { revision: { lt: before } } : {}) },
      orderBy: { revision: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return { items: page.map(versionMeta), next: rows.length > limit ? page.at(-1)!.revision : null };
  }

  async version(userId: string, id: string, revision: number) {
    await this.owned(userId, id);
    const v = await this.db.projectVersion.findUnique({ where: { projectId_revision: { projectId: id, revision } } });
    if (!v) throw problems.notFound('Revision');
    return versionDto(v);
  }
}
