import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(CONFIG) readonly config: Config) {
    this.client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  }

  /** A separate connection for BullMQ (it requires maxRetriesPerRequest: null). */
  connection(): Redis {
    return new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
