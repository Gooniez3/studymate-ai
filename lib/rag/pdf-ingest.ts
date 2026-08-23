import { prisma } from "@/lib/prisma";

import { embedTexts } from "@/lib/rag/embeddings";

import { saveChunkEmbeddings } from "@/lib/rag/vector-store";

export type PdfPageChunk = {
  pageNumber: number;
  content: string;
};

type SavePdfDocumentParams = {
  chatId: string;

  userId: string;

  fileName: string;

  fileType: string;

  fileSize: number;

  extractedText: string;

  pageChunks: PdfPageChunk[];

  /*
   * Injectable so tests can simulate embedding
   * failures and verify rollback behaviour.
   */
  embedImpl?: typeof embedTexts;

  persistEmbeddingsImpl?: typeof saveChunkEmbeddings;
};

type SavedPdfDocument = {
  documentId: string;

  name: string;

  chunkCount: number;
};

/*
 * Persists an uploaded PDF for RAG atomically:
 *
 * 1. Embeddings are computed BEFORE any rows exist,
 *    so an embeddings failure leaves nothing behind.
 * 2. The Document (with nested chunks) is created.
 * 3. Chunk embeddings are written onto the chunk rows.
 *
 * If step 3 fails, the Document is deleted and the
 * schema cascade removes its chunks - no partial RAG
 * records survive a failed upload.
 */
export async function savePdfDocument({
  chatId,

  userId,

  fileName,

  fileType,

  fileSize,

  extractedText,

  pageChunks,

  embedImpl = embedTexts,

  persistEmbeddingsImpl =
    saveChunkEmbeddings,
}: SavePdfDocumentParams): Promise<SavedPdfDocument | null> {
  const existingChat =
    await prisma.chat.findFirst({
      where: {
        id: chatId,

        userId,
      },
    });

  if (!existingChat) {
    return null;
  }

  const embeddings =
    await embedImpl(
      pageChunks.map(
        (chunk) => chunk.content
      )
    );

  if (
    embeddings.length !==
    pageChunks.length
  ) {
    throw new Error(
      `Embedding count mismatch. Expected ${pageChunks.length}, received ${embeddings.length}.`
    );
  }

  const document =
    await prisma.document.create({
      data: {
        chatId,

        name: fileName,

        type: fileType,

        size: fileSize,

        extractedText,

        chunks: {
          create: pageChunks.map(
            (chunk, index) => ({
              chunkIndex: index,

              pageNumber:
                chunk.pageNumber,

              content: chunk.content,
            })
          ),
        },
      },

      include: {
        chunks: {
          orderBy: {
            chunkIndex: "asc",
          },
        },
      },
    });

  try {
    await persistEmbeddingsImpl(
      document.chunks.map(
        (chunk, index) => ({
          id: chunk.id,

          embedding:
            embeddings[index],
        })
      )
    );
  } catch (error) {
    /*
     * Roll back the partial record. The
     * schema cascades Document deletion to
     * DocumentChunk rows, and embeddings
     * live on those rows, so nothing
     * orphaned remains.
     */
    await prisma.document
      .delete({
        where: { id: document.id },
      })
      .catch(() => undefined);

    throw new Error(
      "Storing the PDF embeddings failed. The upload was rolled back.",
      { cause: error }
    );
  }

  return {
    documentId: document.id,

    name: document.name,

    chunkCount: document.chunks.length,
  };
}
