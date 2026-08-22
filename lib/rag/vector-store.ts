import { prisma } from "@/lib/prisma";

const EMBEDDING_DIMENSION = 1024;

function vectorToSql(
  embedding: number[]
): string {
  if (
    embedding.length !==
    EMBEDDING_DIMENSION
  ) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION}-dimensional embedding, received ${embedding.length}.`
    );
  }

  const hasInvalidValue =
    embedding.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value)
    );

  if (hasInvalidValue) {
    throw new Error(
      "Embedding contains invalid numeric values."
    );
  }

  return `[${embedding.join(",")}]`;
}

export async function saveChunkEmbedding(
  chunkId: string,
  embedding: number[]
): Promise<void> {
  const vector =
    vectorToSql(embedding);

  await prisma.$executeRaw`
    UPDATE "DocumentChunk"
    SET "embedding" = ${vector}::vector
    WHERE "id" = ${chunkId}
  `;
}

export async function saveChunkEmbeddings(
  chunks: {
    id: string;
    embedding: number[];
  }[]
): Promise<void> {
  for (const chunk of chunks) {
    await saveChunkEmbedding(
      chunk.id,
      chunk.embedding
    );
  }
}