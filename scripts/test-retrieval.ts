import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    retrieveDocumentChunks,
  } = await import(
    "../lib/rag/retriever"
  );

  const chatId = process.argv[2];

  if (!chatId) {
    throw new Error(
      "Pass a chatId as the first argument."
    );
  }

  const query = process.argv
    .slice(3)
    .join(" ")
    .trim();

  if (!query) {
    throw new Error(
      "Pass a test question."
    );
  }

  const results =
    await retrieveDocumentChunks({
      chatId,
      query,
      limit: 4,
      minimumSimilarity: 0,
    });

  console.log(
    JSON.stringify(
      results.map((result) => ({
        document: result.documentName,
        chunkIndex: result.chunkIndex,
        similarity: Number(
          result.similarity
        ).toFixed(4),
        preview: result.content.slice(
          0,
          220
        ),
      })),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});