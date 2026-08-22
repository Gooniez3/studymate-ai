import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    documentSearchTool,
  } = await import(
    "../lib/ai/tools/document-search"
  );

  const result =
    await documentSearchTool.invoke({
      chatId:
        "cmsyehzt70000o47k6yen33j2",

      query:
        "How many retrieval candidates does Aurora Notebook store before reranking?",

      limit: 4,
    });

  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});