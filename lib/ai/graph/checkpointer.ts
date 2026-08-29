import {
  PostgresSaver,
} from "@langchain/langgraph-checkpoint-postgres";

function getDatabaseUrl(): string {
  const databaseUrl =
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DIRECT_URL is not configured."
    );
  }

  return databaseUrl;
}

export const graphCheckpointer =
  PostgresSaver.fromConnString(
    getDatabaseUrl()
  );