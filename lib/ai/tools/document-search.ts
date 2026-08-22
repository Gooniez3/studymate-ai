import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  retrieveDocumentChunks,
} from "@/lib/rag/retriever";

const documentSearchSchema = z.object({
  chatId: z
    .string()
    .min(1)
    .describe(
      "The chat ID whose uploaded documents should be searched."
    ),

  query: z
    .string()
    .min(1)
    .describe(
      "The semantic search query for the uploaded documents."
    ),

  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(4),
});

export async function searchDocuments({
  chatId,
  query,
  limit = 4,
}: {
  chatId: string;
  query: string;
  limit?: number;
}) {
  const chunks =
    await retrieveDocumentChunks({
      chatId,
      query,
      limit,
      minimumSimilarity: 0.35,
    });

  const context = chunks
    .map(
      (chunk, index) => `
[EVIDENCE_${index + 1}]
File: ${chunk.documentName}
Page: ${chunk.pageNumber ?? "Unknown"}

${chunk.content}
      `.trim()
    )
    .join("\n\n---\n\n");

  return {
    success: chunks.length > 0,
    context,
    chunks: chunks.map(
      (chunk, index) => ({
        evidenceNumber: index + 1,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentName:
          chunk.documentName,
        pageNumber:
          chunk.pageNumber,
        chunkIndex:
          chunk.chunkIndex,
        similarity:
          chunk.similarity,
      })
    ),
  };
}

export const documentSearchTool = tool(
  async ({
    chatId,
    query,
    limit,
  }) => {
    const result =
      await searchDocuments({
        chatId,
        query,
        limit,
      });

    return JSON.stringify(result);
  },
  {
    name: "document_search",

    description:
      "Search uploaded documents in the current StudyMate AI chat using semantic vector retrieval. Use this when the user asks about information contained in their uploaded documents.",

    schema: documentSearchSchema,
  }
);