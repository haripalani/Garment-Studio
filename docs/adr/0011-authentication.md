# ADR-0011: Own authentication module; browser cookies, desktop PKCE + keychain

- **Status:** Accepted · 2026-10-30

## Decision
- Credentials: email + password (argon2id, m=64 MB, t=3), **magic link** (one-time token, 15 min), Google and Apple OAuth. Email verification required before cloud save.
- Tokens: access JWT (EdDSA, 10 min, audience-scoped) + **rotating refresh token** (opaque, hashed in `Session`, 30 days, reuse detection revokes the whole family).
- **Web/PWA:** refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie on `api.<domain>`; access token held in memory; CSRF double-submit token on cookie-authenticated mutations.
- **Desktop (Tauri):** OAuth 2.1 Authorization Code + **PKCE** in the system browser → redirect to the `garmentstudio://auth/callback` deep link → token exchange; refresh token stored in the **OS keychain** (Windows Credential Manager / macOS Keychain) via the keyring plugin; no cookies.
- Password reset: single-use token, 30 min, all sessions revoked on reset.
- Account deletion: immediate session revocation, soft delete, purge of data and assets after 30 days (job), with an export offered first.
- Roles: `user`, `admin` (support tooling). No team roles at launch (the reference has none).

## Consequences
No auth vendor lock-in. We own security hardening: lockout after repeated failures, breached-password check (k-anonymity HIBP API), audit logging.
