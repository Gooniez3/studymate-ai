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

const _originalPut =
  saver.put.bind(saver);

const _originalPutWrites =
  saver.putWrites.bind(saver);

saver.put = async function (
  ...args: Parameters<typeof _originalPut>
) {
  const t0 = performance.now();

  console.log(
    "[checkpoint] put start"
  );

  try {
    const result =
      await _originalPut(...args);

    console.log(
      `[checkpoint] put end duration=${Math.round(performance.now() - t0)}ms`
    );

    return result;
  } catch (err) {
    console.log(
      `[checkpoint] put error duration=${Math.round(performance.now() - t0)}ms`
    );

    throw err;
  }
};

saver.putWrites = async function (
  ...args: Parameters<typeof _originalPutWrites>
) {
  const t0 = performance.now();

  const writes = args[1];

  console.log(
    `[checkpoint] putWrites start writes=${Array.isArray(writes) ? writes.length : "?"}`
  );

  try {
    await _originalPutWrites(...args);

    console.log(
      `[checkpoint] putWrites end duration=${Math.round(performance.now() - t0)}ms`
    );
  } catch (err) {
    console.log(
      `[checkpoint] putWrites error duration=${Math.round(performance.now() - t0)}ms`
    );

    throw err;
  }
};

export const graphCheckpointer = saver;
