-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'FACEBOOK', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'RUNNING', 'ENDED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "accessToken" TEXT,
    "isOwn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionChannel" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalLiveId" TEXT,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveEvent" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT,
    "platformUserId" TEXT,
    "userName" TEXT,
    "userHandle" TEXT,
    "avatarUrl" TEXT,
    "content" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "value" INTEGER NOT NULL DEFAULT 0,
    "platformTs" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionUser" (
    "sessionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "userName" TEXT,
    "userHandle" TEXT,
    "avatarUrl" TEXT,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "follows" INTEGER NOT NULL DEFAULT 0,
    "gifts" INTEGER NOT NULL DEFAULT 0,
    "giftValue" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionUser_pkey" PRIMARY KEY ("sessionId","platform","platformUserId")
);

-- CreateTable
CREATE TABLE "SessionMinute" (
    "sessionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "follows" INTEGER NOT NULL DEFAULT 0,
    "gifts" INTEGER NOT NULL DEFAULT 0,
    "joins" INTEGER NOT NULL DEFAULT 0,
    "viewersMax" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionMinute_pkey" PRIMARY KEY ("sessionId","platform","minute")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_shopId_platform_handle_key" ON "Channel"("shopId", "platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "SessionChannel_sessionId_channelId_key" ON "SessionChannel"("sessionId", "channelId");

-- CreateIndex
CREATE INDEX "LiveEvent_sessionId_type_platformTs_idx" ON "LiveEvent"("sessionId", "type", "platformTs");

-- CreateIndex
CREATE INDEX "LiveEvent_sessionId_platformUserId_idx" ON "LiveEvent"("sessionId", "platformUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChannel" ADD CONSTRAINT "SessionChannel_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionChannel" ADD CONSTRAINT "SessionChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveEvent" ADD CONSTRAINT "LiveEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionUser" ADD CONSTRAINT "SessionUser_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMinute" ADD CONSTRAINT "SessionMinute_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
