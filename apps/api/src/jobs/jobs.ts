// Background jobs on BullMQ (ADR-0010): asset scans, data exports and hourly maintenance
// (account purge, trash purge, asset GC, stale uploads, expired tokens and sessions).
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { CONFIG, type Config } from '../config';
import { AssetsService } from '../assets/assets.service';
import { Audit } from '../audit/audit';
import { TRASH_DAYS } from '../projects/projects.service';
import { Db } from '../infra/prisma';
import { Mailer } from '../infra/mail';
import { RedisService } from '../infra/redis';
import { Storage } from '../infra/storage';

const DAY = 86400_000;
export const ACCOUNT_PURGE_DAYS = 30;
const ASSET_GC_DAYS = 30;
const STALE_UPLOAD_HOURS = 24;
const EXPORT_LINK_S = 7 * 24 * 3600;

@Injectable()
export class Jobs implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];
  private scanQ!: Queue;
  private exportQ!: Queue;
  private maintQ!: Queue;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AssetsService) private readonly assets: AssetsService,
    @Inject(Db) private readonly db: Db,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Mailer) private readonly mail: Mailer,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.connection();
    const q = (name: string) => {
      const queue = new Queue(name, { connection, prefix: 'gs' });
      this.queues.push(queue);
      return queue;
    };
    this.scanQ = q('asset-scan');
    this.exportQ = q('data-export');
    this.maintQ = q('maintenance');
    if (!this.config.RUN_WORKERS) return;
    const w = (name: string, fn: (job: Job) => Promise<unknown>, concurrency = 2) => {
      const worker = new Worker(name, fn, { connection: this.redis.connection(), prefix: 'gs', concurrency });
      worker.on('failed', (job, err) => this.log.warn(`${name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
      this.workers.push(worker);
    };
    w('asset-scan', (job) => this.assets.scan(String(job.data.assetId)), 4);
    w('data-export', (job) => this.exportData(String(job.data.exportId), String(job.data.userId)), 1);
    w('maintenance', () => this.maintenance(), 1);
    await this.maintQ.upsertJobScheduler('hourly', { every: 3600_000 }, { name: 'maintenance' });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(this.queues.map((q) => q.close()));
  }

  enqueueScan(assetId: string) {
    return this.scanQ.add(
      'scan',
      { assetId },
      { jobId: `scan-${assetId}`, attempts: 8, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
  }

  enqueueExport(exportId: string, userId: string) {
    return this.exportQ.add(
      'export',
      { exportId, userId },
      { jobId: exportId, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100 },
    );
  }

  /** Everything the user owns, as JSON plus original files, zipped and emailed as a 7-day link. */
  async exportData(exportId: string, userId: string): Promise<string> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
    const projects = await this.db.project.findMany({ where: { ownerId: userId }, include: { versions: true } });
    const assets = await this.db.asset.findMany({ where: { ownerId: userId, completed: true, scanStatus: 'clean' } });
    const files: Zippable = {
      'account.json': strToU8(
        JSON.stringify(
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            createdAt: user.createdAt,
            settings: user.settings,
          },
          null,
          2,
        ),
      ),
    };
    for (const p of projects) {
      const { versions, ...meta } = p;
      files[`projects/${p.id}/project.json`] = strToU8(JSON.stringify(meta, null, 2));
      for (const v of versions) files[`projects/${p.id}/versions/${v.revision}.json`] = strToU8(JSON.stringify(v.doc));
    }
    for (const a of assets) {
      const ext = a.mime.split('/')[1]?.replace('svg+xml', 'svg') ?? 'bin';
      files[`files/${a.kind}/${a.sha256}.${ext}`] = [await this.storage.getBytes(a.storageKey), { level: 0 }];
    }
    const key = `x/${userId}/${exportId}.zip`;
    await this.storage.put(key, zipSync(files, { level: 6 }), 'application/zip');
    const url = await this.storage.presignGet(key, 'application/zip', `garment-studio-export-${exportId}.zip`, EXPORT_LINK_S);
    await this.mail.send('export-ready', user.email, url);
    return key;
  }

  async maintenance(now = new Date()) {
    const out = { accounts: 0, projects: 0, assets: 0, uploads: 0, tokens: 0, sessions: 0 };
    // 1. Accounts deleted more than 30 days ago: files, then rows (cascades).
    const gone = await this.db.user.findMany({
      where: { deletedAt: { lt: new Date(now.getTime() - ACCOUNT_PURGE_DAYS * DAY) } },
      select: { id: true },
    });
    for (const u of gone) {
      await this.storage.deletePrefix(`u/${u.id}/`);
      await this.storage.deletePrefix(`x/${u.id}/`);
      await this.db.user.delete({ where: { id: u.id } });
      await this.audit.record('account.purge', { target: u.id });
      out.accounts++;
    }
    // 2. Projects in the trash for more than 30 days.
    const trash = await this.db.project.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - TRASH_DAYS * DAY) } } });
    out.projects = trash.count;
    // 3. Assets no project references (and no thumbnail use) for 30 days.
    const orphans = await this.db.asset.findMany({
      where: {
        completed: true,
        lastRefAt: { lt: new Date(now.getTime() - ASSET_GC_DAYS * DAY) },
        projects: { none: {} },
        thumbOf: { none: {} },
        renderOutputs: { none: {} },
        exportOutputs: { none: {} },
      },
      select: { id: true, storageKey: true },
    });
    for (const a of orphans) {
      await this.storage.delete(a.storageKey).catch(() => undefined);
      await this.db.asset.delete({ where: { id: a.id } });
      out.assets++;
    }
    // 4. Uploads started but never completed.
    const stale = await this.db.asset.findMany({
      where: { completed: false, createdAt: { lt: new Date(now.getTime() - STALE_UPLOAD_HOURS * 3600_000) } },
    });
    for (const a of stale) {
      if (a.uploadId) await this.storage.abortMultipart(a.storageKey, a.uploadId).catch(() => undefined);
      await this.db.asset.delete({ where: { id: a.id } });
      out.uploads++;
    }
    // 5. Expired one-time tokens and sessions (kept a week for the audit trail of reuse).
    out.tokens = (await this.db.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } })).count;
    out.sessions = (await this.db.session.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } } })).count;
    return out;
  }
}
