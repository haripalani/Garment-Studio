// Live events to a user's connected clients (ADR-0010): published through Redis so any API or worker
// process can emit them, delivered over the `/v1/ws` WebSocket by whichever API process holds the socket.
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { TokenService } from '../auth/tokens';
import { RedisService } from '../infra/redis';

export type LiveEvent =
  | { type: 'render.progress'; jobId: string; progress: number; samplesDone: number }
  | { type: 'render.finished'; jobId: string; status: string; outputAssetId: string | null }
  | { type: 'project.updated'; projectId: string; headRevision: number; deviceId: string | null }
  | { type: 'entitlements.changed' };

const CHANNEL = 'gs:events:';
const AUTH_TIMEOUT_MS = 5000;

/** Publishing side, also used by the render worker process. */
export async function publishEvent(redis: Redis, userId: string, event: LiveEvent): Promise<void> {
  await redis.publish(`${CHANNEL}${userId}`, JSON.stringify(event));
}

@Injectable()
export class Events implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Events');
  private sub: Redis | null = null;
  private readonly sockets = new Map<string, Set<WebSocket>>();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  publish(userId: string, event: LiveEvent): Promise<void> {
    return publishEvent(this.redis.client, userId, event);
  }

  async onModuleInit(): Promise<void> {
    this.sub = this.redis.connection();
    await this.sub.psubscribe(`${CHANNEL}*`);
    this.sub.on('pmessage', (_p: string, channel: string, message: string) => {
      const set = this.sockets.get(channel.slice(CHANNEL.length));
      if (!set) return;
      for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001, 'server shutting down');
    this.sub?.disconnect();
  }

  /**
   * A new socket: it must send `{ "type": "auth", "token": "<access token>" }` within 5 s. Afterwards
   * it receives the user's events and may send `{ "type": "ping" }` (answered with `pong`).
   */
  accept(ws: WebSocket): void {
    let userId: string | null = null;
    const timer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    ws.on('message', (raw) => {
      let msg: { type?: unknown; token?: unknown };
      try {
        msg = JSON.parse(String(raw)) as typeof msg;
      } catch {
        ws.close(4400, 'invalid message');
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.type !== 'auth' || userId) return;
      this.tokens
        .verifyAccess(String(msg.token))
        .then((p) => {
          clearTimeout(timer);
          userId = p.id;
          let set = this.sockets.get(p.id);
          if (!set) this.sockets.set(p.id, (set = new Set()));
          set.add(ws);
          ws.send(JSON.stringify({ type: 'ready' }));
        })
        .catch(() => ws.close(4401, 'invalid token'));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!userId) return;
      const set = this.sockets.get(userId);
      set?.delete(ws);
      if (set && !set.size) this.sockets.delete(userId);
    });
    ws.on('error', (e) => this.log.warn(`socket error: ${e.message}`));
  }
}
