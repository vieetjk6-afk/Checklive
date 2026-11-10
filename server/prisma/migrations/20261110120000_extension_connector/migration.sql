-- CreateEnum
CREATE TYPE "ChannelConnector" AS ENUM ('API', 'EXTENSION');

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "connector" "ChannelConnector" NOT NULL DEFAULT 'API',
ADD COLUMN     "connectorToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_connectorToken_key" ON "Channel"("connectorToken");

