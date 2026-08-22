import { prisma } from "@/lib/prisma";
import { embedText } from "@/lib/rag/embeddings";

const EMBEDDING_DIMENSION = 1024;

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  similarity: number;
};

function vectorToSql(
  embedding: number[]
): string {
  if (
    embedding.length !==
    EMBEDDING_DIMENSION
  ) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION}-dimensional query embedding, received ${embedding.length}.`
    );
  }

  const invalid =
    embedding.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value)
    );

  if (invalid) {
    throw new Error(
      "Query embedding contains invalid values."
    );
  }

  return `[${embedding.join(",")}]`;
}

export async function retrieveDocumentChunks({
  chatId,
  query,
  limit = 4,
  minimumSimilarity = 0.35,
}: {
  chatId: string;
  query: string;
  limit?: number;
  minimumSimilarity?: number;
}): Promise<RetrievedChunk[]> {
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    return [];
  }

  const queryEmbedding =
    await embedText(cleanQuery);

  const vector =
    vectorToSql(queryEmbedding);

  const safeLimit =
    Math.min(
      Math.max(limit, 1),
      10
    );

  const rows =
  await prisma.$queryRaw<
    RetrievedChunk[]
  >`
    SELECT
      dc."id" AS "chunkId",
      dc."documentId" AS "documentId",
      d."name" AS "documentName",
      dc."chunkIndex" AS "chunkIndex",
      dc."pageNumber" AS "pageNumber",
      dc."content" AS "content",
      (
        1 - (
          dc."embedding" <=>
          ${vector}::vector
        )
      )::float8 AS "similarity"
    FROM "DocumentChunk" dc
    INNER JOIN "Document" d
      ON d."id" = dc."documentId"
    WHERE
      d."chatId" = ${chatId}
      AND dc."embedding" IS NOT NULL
    ORDER BY
      dc."embedding" <=>
      ${vector}::vector
    LIMIT ${safeLimit}
  `;

  return rows.filter(
    (row) =>
      Number(row.similarity) >=
      minimumSimilarity
  );
}