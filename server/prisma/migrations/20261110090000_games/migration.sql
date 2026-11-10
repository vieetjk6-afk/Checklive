-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('NUMBER_GUESS', 'WORD_GUESS', 'QUIZ', 'LUCKY_DRAW');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'DONE');

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN     "overlayGameId" TEXT;

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "GameType" NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "prizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "oneAttempt" BOOLEAN NOT NULL DEFAULT true,
    "durationSec" INTEGER,
    "status" "GameStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" TEXT,
    "revealAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAnswer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "userName" TEXT,
    "userHandle" TEXT,
    "avatarUrl" TEXT,
    "content" TEXT NOT NULL,
    "value" TEXT,
    "correct" BOOLEAN NOT NULL DEFAULT false,
    "platformTs" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameWinner" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "userName" TEXT,
    "userHandle" TEXT,
    "avatarUrl" TEXT,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "prize" TEXT,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_sessionId_status_idx" ON "Game"("sessionId", "status");

-- CreateIndex
CREATE INDEX "GameAnswer_gameId_correct_platformTs_idx" ON "GameAnswer"("gameId", "correct", "platformTs");

-- CreateIndex
CREATE INDEX "GameAnswer_gameId_platform_platformUserId_idx" ON "GameAnswer"("gameId", "platform", "platformUserId");

-- CreateIndex
CREATE INDEX "GameWinner_gameId_rank_idx" ON "GameWinner"("gameId", "rank");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAnswer" ADD CONSTRAINT "GameAnswer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWinner" ADD CONSTRAINT "GameWinner_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

