// Writes fresh secrets for the staging replica (infra/staging/.env and s3.json, both git-ignored):
//   node infra/staging/make-env.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const { privateKey } = generateKeyPairSync('ed25519');
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: `stg${Date.now().toString(36)}`, alg: 'EdDSA' };
const s3Secret = randomBytes(24).toString('base64url');
writeFileSync(
  new URL('.env', here),
  [`JWT_PRIVATE_JWK=${JSON.stringify(jwk)}`, `IP_HASH_SECRET=${randomBytes(32).toString('base64url')}`, `S3_SECRET_KEY=${s3Secret}`, ''].join('\n'),
);
writeFileSync(
  new URL('s3.json', here),
  JSON.stringify(
    {
      identities: [
        { name: 'gs-staging', credentials: [{ accessKey: 'gs-staging-access', secretKey: s3Secret }], actions: ['Admin', 'Read', 'List', 'Tagging', 'Write'] },
        { name: 'anonymous', actions: ['Read:gs-staging-public'] },
      ],
    },
    null,
    2,
  ),
);
console.log('Wrote infra/staging/.env and infra/staging/s3.json');
