// Append-only security audit log (ADR-0011). IPs are stored as keyed hashes, never in clear.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CONFIG, type Config } from '../config';
import { hmacHex, newId } from '../common/crypto';
import { Db } from '../infra/prisma';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.locked'
  | 'auth.magic_link'
  | 'auth.desktop'
  | 'auth.logout'
  | 'auth.refresh_reuse'
  | 'auth.password_reset'
  | 'auth.email_verified'
  | 'account.password_change'
  | 'account.email_change'
  | 'account.delete'
  | 'account.purge'
  | 'account.export'
  | 'session.revoke'
  | 'project.delete'
  | 'project.restore'
  | 'project.purge'
  | 'asset.rejected'
  | 'admin.plan.assign';

@Injectable()
export class Audit {
  private readonly log = new Logger('Audit');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  ipHash(ip: string | undefined): string | null {
    return ip ? hmacHex(this.config.IP_HASH_SECRET, ip) : null;
  }

  async record(
    action: AuditAction,
    e: { actorId?: string | null; target?: string | null; ip?: string; meta?: Prisma.InputJsonValue },
  ): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          id: newId(),
          action,
          actorId: e.actorId ?? null,
          target: e.target ?? null,
          ipHash: this.ipHash(e.ip),
          ...(e.meta === undefined ? {} : { meta: e.meta }),
        },
      });
    } catch (err) {
      // Auditing must never turn a successful action into an error for the user; operators see it in logs.
      this.log.error(`audit ${action} failed: ${(err as Error).message}`);
    }
  }
}
