-- DropForeignKey
ALTER TABLE "SessionProduct" DROP CONSTRAINT "SessionProduct_productId_fkey";

-- AddForeignKey
ALTER TABLE "SessionProduct" ADD CONSTRAINT "SessionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

