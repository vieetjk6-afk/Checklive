-- CreateEnum
CREATE TYPE "OrderMode" AS ENUM ('ALL_CODES', 'SELLING_ONLY');

-- CreateEnum
CREATE TYPE "SessionProductStatus" AS ENUM ('WAITING', 'SELLING', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'APPROVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'BANK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('RESERVED', 'WAITLIST', 'NEEDS_VARIANT', 'CANCELLED');

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN     "holdMinutes" INTEGER DEFAULT 1440,
ADD COLUMN     "orderKeywords" TEXT[] DEFAULT ARRAY['chot', '+1', 'lay']::TEXT[],
ADD COLUMN     "orderMode" "OrderMode" NOT NULL DEFAULT 'ALL_CODES',
ADD COLUMN     "publicId" TEXT;

-- Điền publicId ngẫu nhiên cho các phiên đã có, rồi mới bắt buộc
UPDATE "LiveSession" SET "publicId" = md5(random()::text || id || clock_timestamp()::text) WHERE "publicId" IS NULL;
ALTER TABLE "LiveSession" ALTER COLUMN "publicId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "bankBin" TEXT,
ADD COLUMN     "defaultHoldMinutes" INTEGER DEFAULT 1440;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" INTEGER NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "sku" TEXT,
    "price" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionProduct" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeNorm" TEXT NOT NULL,
    "livePrice" INTEGER,
    "sessionLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionProductStatus" NOT NULL DEFAULT 'WAITING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerIdentity" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "name" TEXT,
    "handle" TEXT,

    CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "handle" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "holdUntil" TIMESTAMP(3),
    "confirmToken" TEXT NOT NULL,
    "receiverName" TEXT,
    "receiverPhone" TEXT,
    "receiverAddress" TEXT,
    "note" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "total" INTEGER NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sessionProductId" TEXT NOT NULL,
    "variantId" TEXT,
    "code" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantLabel" TEXT,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OrderItemStatus" NOT NULL,
    "sourceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionProduct_sessionId_codeNorm_key" ON "SessionProduct"("sessionId", "codeNorm");

-- CreateIndex
CREATE INDEX "Customer_shopId_phone_idx" ON "Customer"("shopId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentity_shopId_platform_platformUserId_key" ON "CustomerIdentity"("shopId", "platform", "platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_confirmToken_key" ON "Order"("confirmToken");

-- CreateIndex
CREATE INDEX "Order_sessionId_status_idx" ON "Order"("sessionId", "status");

-- CreateIndex
CREATE INDEX "Order_sessionId_platform_platformUserId_idx" ON "Order"("sessionId", "platform", "platformUserId");

-- CreateIndex
CREATE INDEX "OrderItem_sessionProductId_status_createdAt_idx" ON "OrderItem"("sessionProductId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_publicId_key" ON "LiveSession"("publicId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProduct" ADD CONSTRAINT "SessionProduct_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProduct" ADD CONSTRAINT "SessionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sessionProductId_fkey" FOREIGN KEY ("sessionProductId") REFERENCES "SessionProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

