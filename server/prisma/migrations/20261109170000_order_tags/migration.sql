-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "LiveEvent" ADD COLUMN     "tag" TEXT,
ADD COLUMN     "tagKind" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "completedAt" TIMESTAMP(3);

