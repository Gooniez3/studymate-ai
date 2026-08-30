import {
  PostgresSaver,
} from "@langchain/langgraph-checkpoint-postgres";

function getDatabaseUrl(): string {
  const databaseUrl =
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured."
    );
  }

  return databaseUrl;
}

const saver =
  PostgresSaver.fromConnString(
    getDatabaseUrl()
  );

export const graphCheckpointer = saver;
