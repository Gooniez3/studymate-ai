ALTER TABLE "Message"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Message_chatId_position_idx"
ON "Message"("chatId", "position");
