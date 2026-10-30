import { Logger } from '@nestjs/common';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.PORT, host: '0.0.0.0' });
new Logger('Bootstrap').log(`API listening on http://localhost:${config.PORT}/v1`);
