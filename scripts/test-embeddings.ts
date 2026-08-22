import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

import {
  embedText,
  embeddingConfig,
} from "../lib/rag/embeddings";

async function main() {
  const embedding =
    await embedText(
      "Retrieval augmented generation combines external knowledge with a language model."
    );

  console.log({
    model: embeddingConfig.model,
    expectedDimension:
      embeddingConfig.dimension,
    actualDimension:
      embedding.length,
    firstValues:
      embedding.slice(0, 5),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});