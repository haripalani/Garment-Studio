-- AlterTable
ALTER TABLE "RenderJob" ADD COLUMN     "outputs" JSONB,
ADD COLUMN     "retryOf" TEXT;

