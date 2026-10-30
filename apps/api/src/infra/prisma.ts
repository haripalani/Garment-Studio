import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CONFIG, type Config } from '../config';

@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) config: Config) {
    super({ datasourceUrl: config.DATABASE_URL });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
