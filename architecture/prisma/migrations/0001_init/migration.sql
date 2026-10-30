-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('google', 'apple');

-- CreateEnum
CREATE TYPE "public"."ClientPlatform" AS ENUM ('web', 'pwa', 'desktop');

-- CreateEnum
CREATE TYPE "public"."TokenPurpose" AS ENUM ('email_verify', 'magic_link', 'password_reset', 'desktop_pkce');

-- CreateEnum
CREATE TYPE "public"."AssetKind" AS ENUM ('artwork', 'thumbnail', 'render', 'export');

-- CreateEnum
CREATE TYPE "public"."ScanStatus" AS ENUM ('pending', 'clean', 'rejected');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."RenderTarget" AS ENUM ('cloud', 'local');

-- CreateEnum
CREATE TYPE "public"."ExportKind" AS ENUM ('snapshot', 'print_zip', 'sublimation_zip', 'spec_pdf', 'turntable_video');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "displayName" TEXT,
    "role" "public"."Role" NOT NULL DEFAULT 'user',
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "providerUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "platform" "public"."ClientPlatform" NOT NULL,
    "deviceName" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" CITEXT NOT NULL,
    "purpose" "public"."TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeChallenge" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSettings" (
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "lookDefaults" JSONB,
    "hints" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "garmentModelId" TEXT NOT NULL,
    "garmentVersion" TEXT NOT NULL,
    "headRevision" INTEGER NOT NULL DEFAULT 0,
    "thumbAssetId" TEXT,
    "duplicatedFrom" TEXT,
    "conflictOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "baseRevision" INTEGER,
    "schemaVersion" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "docSha256" TEXT NOT NULL,
    "docBytes" INTEGER NOT NULL,
    "platform" "public"."ClientPlatform" NOT NULL,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "public"."AssetKind" NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isVector" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "scanStatus" "public"."ScanStatus" NOT NULL DEFAULT 'pending',
    "scanNote" TEXT,
    "uploadId" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectAsset" (
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("projectId","assetId")
);

-- CreateTable
CREATE TABLE "public"."GarmentModel" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarmentModel_pkey" PRIMARY KEY ("id","version")
);

-- CreateTable
CREATE TABLE "public"."RenderJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "target" "public"."RenderTarget" NOT NULL DEFAULT 'cloud',
    "params" JSONB NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "samplesDone" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "outputAssetId" TEXT,
    "gpuSeconds" DOUBLE PRECISION,
    "idempotencyKey" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExportRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "public"."ExportKind" NOT NULL,
    "params" JSONB NOT NULL,
    "ranOn" TEXT NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'succeeded',
    "outputAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limits" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "providerRef" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerSubId" TEXT,
    "period" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "graceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "creditGrantId" TEXT,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ipHash" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "public"."User"("deletedAt");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "public"."AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUid_key" ON "public"."AuthIdentity"("provider", "providerUid");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshHash_key" ON "public"."Session"("refreshHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_familyId_idx" ON "public"."Session"("familyId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "public"."VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_email_purpose_idx" ON "public"."VerificationToken"("email", "purpose");

-- CreateIndex
CREATE INDEX "VerificationToken_expiresAt_idx" ON "public"."VerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_ownerId_deletedAt_updatedAt_idx" ON "public"."Project"("ownerId", "deletedAt", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "public"."ProjectVersion"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_revision_key" ON "public"."ProjectVersion"("projectId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "public"."Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_ownerId_kind_idx" ON "public"."Asset"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "Asset_lastRefAt_idx" ON "public"."Asset"("lastRefAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ownerId_sha256_kind_key" ON "public"."Asset"("ownerId", "sha256", "kind");

-- CreateIndex
CREATE INDEX "ProjectAsset_assetId_idx" ON "public"."ProjectAsset"("assetId");

-- CreateIndex
CREATE INDEX "GarmentModel_publishedAt_idx" ON "public"."GarmentModel"("publishedAt");

-- CreateIndex
CREATE INDEX "RenderJob_userId_createdAt_idx" ON "public"."RenderJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RenderJob_status_createdAt_idx" ON "public"."RenderJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_userId_idempotencyKey_key" ON "public"."RenderJob"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ExportRecord_userId_createdAt_idx" ON "public"."ExportRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "public"."Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubId_key" ON "public"."Subscription"("providerSubId");

-- CreateIndex
CREATE INDEX "CreditGrant_userId_kind_expiresAt_idx" ON "public"."CreditGrant"("userId", "kind", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_key_key" ON "public"."UsageEvent"("key");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_action_createdAt_idx" ON "public"."UsageEvent"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "public"."AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "public"."AuditLog"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "public"."AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_garmentModelId_garmentVersion_fkey" FOREIGN KEY ("garmentModelId", "garmentVersion") REFERENCES "public"."GarmentModel"("id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_thumbAssetId_fkey" FOREIGN KEY ("thumbAssetId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectAsset" ADD CONSTRAINT "ProjectAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExportRecord" ADD CONSTRAINT "ExportRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExportRecord" ADD CONSTRAINT "ExportRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExportRecord" ADD CONSTRAINT "ExportRecord_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditGrant" ADD CONSTRAINT "CreditGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

