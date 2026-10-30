// API request contracts shared by the server (validation) and clients (ADR-0010).
// They mirror architecture/openapi.yaml; the API's contract tests check responses against that file.
import { z } from 'zod';
import { LookSchema } from './look';

export const IdSchema = z.string().regex(/^[a-z0-9]{20,32}$/, 'Invalid id');
export const ClientPlatformSchema = z.enum(['web', 'pwa', 'desktop']);
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
export const PasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase hex SHA-256');

export const RegisterRequest = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().max(80).optional(),
  platform: ClientPlatformSchema.optional(),
});

export const LoginRequest = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  remember: z.boolean().default(true),
  platform: ClientPlatformSchema.optional(),
});

export const MagicLinkRequest = z.object({ email: EmailSchema, redirectUri: z.url().optional() });
export const TokenRequest = z.object({ token: z.string().min(32).max(128) });
export const MagicLinkVerifyRequest = TokenRequest.extend({ platform: ClientPlatformSchema.optional() });
export const ForgotPasswordRequest = z.object({ email: EmailSchema });
export const ResetPasswordRequest = TokenRequest.extend({ password: PasswordSchema });
export const RefreshRequest = z.object({ refreshToken: z.string().min(32).max(128).optional() }).default({});

export const DesktopCodeRequest = z.object({
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, 'Expected an S256 PKCE challenge'),
  redirectUri: z.string().startsWith('garmentstudio://auth/callback'),
});
export const DesktopTokenRequest = z.object({
  code: z.string().min(32).max(128),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'Invalid PKCE code verifier'),
  deviceName: z.string().trim().min(1).max(80),
});

export const UpdateMeRequest = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    email: EmailSchema.optional(),
    newPassword: PasswordSchema.optional(),
    currentPassword: z.string().max(128).optional(),
  })
  .refine((v) => v.displayName !== undefined || v.email !== undefined || v.newPassword !== undefined, {
    message: 'Nothing to update',
  });

export const DeleteMeRequest = z.object({ confirm: z.literal('DELETE'), currentPassword: z.string().max(128).optional() });

export const UserSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  unit: z.enum(['mm', 'cm', 'in']),
  locale: z.string().min(2).max(10),
  lookDefaults: LookSchema.nullable().optional(),
  hints: z.record(z.string().max(64), z.boolean()).nullable().optional(),
});

export const CreateProjectRequest = z.object({
  id: IdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  doc: z.unknown(),
});
export const RenameProjectRequest = z.object({ name: z.string().trim().min(1).max(120) });
export const DuplicateProjectRequest = z.object({ name: z.string().trim().min(1).max(120).optional() }).default({});
export const PushVersionRequest = z.object({
  baseRevision: z.number().int().min(0),
  doc: z.unknown(),
  docSha256: Sha256,
  platform: ClientPlatformSchema,
  deviceId: z.string().max(64).optional(),
});
export const SetThumbnailRequest = z.object({ assetId: IdSchema });

export const UPLOAD_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
] as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const CreateUploadRequest = z.object({
  sha256: Sha256,
  bytes: z.number().int().min(1),
  mime: z.string().max(100),
  kind: z.enum(['artwork', 'thumbnail']),
  filename: z.string().max(255).optional(),
});
export const CompleteUploadRequest = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10000),
});

export const AssignPlanRequest = z.object({ planId: z.string().min(1).max(40), days: z.number().int().min(1).max(3660).default(30) });
