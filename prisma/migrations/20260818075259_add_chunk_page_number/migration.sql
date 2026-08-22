-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN     "pageNumber" INTEGER;

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_pageNumber_idx" ON "DocumentChunk"("documentId", "pageNumber");
