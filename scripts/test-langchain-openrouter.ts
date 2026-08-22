import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    getPrimaryModel,
  } = await import(
    "../lib/ai/models"
  );

  const model =
    getPrimaryModel();

  const response =
    await model.invoke([
      {
        role: "user",
        content:
          "Reply with exactly: LangChain OpenRouter works",
      },
    ]);

  console.log(
    "LangChain response:",
    response.content
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});