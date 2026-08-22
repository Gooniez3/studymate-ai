import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    StudyMateRetriever,
  } = await import(
    "../lib/rag/langchain-retriever"
  );

  const chatId =
    process.argv[2];

  const query =
    process.argv
      .slice(3)
      .join(" ");

  if (!chatId || !query) {
    throw new Error(
      'Usage: npx tsx scripts/test-langchain-retriever.ts <chatId> "<query>"'
    );
  }

  const retriever =
    new StudyMateRetriever({
      chatId,
      limit: 4,
      minimumSimilarity: 0.35,
    });

  const documents =
    await retriever.invoke(query);

  console.log(
    documents.map((document) => ({
      document:
        document.metadata
          .documentName,
      pageNumber:
        document.metadata
          .pageNumber,
      chunkIndex:
        document.metadata
          .chunkIndex,
      similarity:
        Number(
          document.metadata
            .similarity
        ).toFixed(4),
      preview:
        document.pageContent
          .slice(0, 180),
    }))
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});