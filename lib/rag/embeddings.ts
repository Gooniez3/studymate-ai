const EMBEDDING_MODEL =
  "@cf/baai/bge-m3";

const EMBEDDING_DIMENSION = 1024;

type CloudflareEmbeddingResponse = {
  success?: boolean;

  result?: {
    data?: number[][];
  };

  errors?: unknown[];
};

function getCloudflareConfig() {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID;

  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId) {
    throw new Error(
      "Missing CLOUDFLARE_ACCOUNT_ID"
    );
  }

  if (!apiToken) {
    throw new Error(
      "Missing CLOUDFLARE_API_TOKEN"
    );
  }

  return {
    accountId,
    apiToken,
  };
}

function validateEmbedding(
  embedding: number[]
) {
  if (
    embedding.length !==
    EMBEDDING_DIMENSION
  ) {
    throw new Error(
      `Invalid embedding dimension. Expected ${EMBEDDING_DIMENSION}, received ${embedding.length}.`
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
}

export async function embedTexts(
  texts: string[]
): Promise<number[][]> {
  const {
    accountId,
    apiToken,
  } = getCloudflareConfig();

  const cleanTexts = texts
    .map((text) => text.trim())
    .filter(Boolean);

  if (cleanTexts.length === 0) {
    return [];
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${accountId}/ai/run/${EMBEDDING_MODEL}`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization:
        `Bearer ${apiToken}`,

      "Content-Type":
        "application/json",
    },

    body: JSON.stringify({
      text: cleanTexts,
    }),
  });

  let data: CloudflareEmbeddingResponse;

  try {
    data =
      (await response.json()) as CloudflareEmbeddingResponse;
  } catch {
    throw new Error(
      "Cloudflare returned an invalid JSON response."
    );
  }

  if (!response.ok) {
    console.error(
      "Cloudflare embedding error:",
      data
    );

    throw new Error(
      `Cloudflare embedding request failed with status ${response.status}.`
    );
  }

  const embeddings =
    data.result?.data;

  if (
    !embeddings ||
    !Array.isArray(embeddings)
  ) {
    console.error(
      "Unexpected Cloudflare embedding response:",
      data
    );

    throw new Error(
      "Cloudflare returned no embeddings."
    );
  }

  if (
    embeddings.length !==
    cleanTexts.length
  ) {
    throw new Error(
      `Embedding count mismatch. Sent ${cleanTexts.length} texts but received ${embeddings.length} embeddings.`
    );
  }

  for (const embedding of embeddings) {
    validateEmbedding(embedding);
  }

  return embeddings;
}

export async function embedText(
  text: string
): Promise<number[]> {
  const cleanText = text.trim();

  if (!cleanText) {
    throw new Error(
      "Cannot create an embedding from empty text."
    );
  }

  const embeddings =
    await embedTexts([cleanText]);

  const embedding =
    embeddings[0];

  if (!embedding) {
    throw new Error(
      "Failed to create embedding."
    );
  }

  return embedding;
}

export const embeddingConfig = {
  model: EMBEDDING_MODEL,
  dimension: EMBEDDING_DIMENSION,
} as const;