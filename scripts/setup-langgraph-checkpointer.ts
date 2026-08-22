import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    graphCheckpointer,
  } = await import(
    "../lib/ai/graph/checkpointer"
  );

  console.log(
    "Setting up LangGraph PostgreSQL checkpoint tables..."
  );

  await graphCheckpointer.setup();

  console.log(
    "LangGraph checkpoint tables are ready."
  );
}

main().catch((error) => {
  console.error(
    "LangGraph checkpoint setup failed:",
    error
  );

  process.exit(1);
});