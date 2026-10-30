// Prints a fresh Ed25519 signing key (JWK) for JWT_PRIVATE_JWK and a random IP_HASH_SECRET.
import { exportJWK, generateKeyPair } from 'jose';
import { randomBytes } from 'node:crypto';

const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: `k${Date.now().toString(36)}`, alg: 'EdDSA' };
console.log(`JWT_PRIVATE_JWK=${JSON.stringify(jwk)}`);
console.log(`IP_HASH_SECRET=${randomBytes(32).toString('base64url')}`);
