import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    webSearchTool,
  } = await import(
    "../lib/ai/tools/web-search"
  );

  const result =
    await webSearchTool.invoke({
      queries: [
        "latest iPhone model August 2026",
      ],
    });

  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});