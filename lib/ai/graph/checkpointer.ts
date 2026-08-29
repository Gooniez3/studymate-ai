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

type PoolStats = {
  idle: number;
  total: number;
  waiting: number;
};

const pool = (saver as any).pool;

const _originalPoolConnect =
  pool.connect.bind(pool);

/*
 * Track which PoolClient instances have
 * already been instrumented so we never
 * wrap the same client twice.
 */
const instrumentedClients =
  new WeakSet<object>();

function instrumentClientQuery(
  client: any
) {
  if (
    instrumentedClients.has(client)
  ) {
    return;
  }

  instrumentedClients.add(client);

  const originalQuery =
    client.query.bind(client);

  client.query =
    function (...args: any[]) {
      const sql =
        typeof args[0] === "string"
          ? args[0]
          : args[0]?.text ?? "";

      const upperSql =
        sql.toUpperCase().trim();

      const isCheckpoint =
        upperSql === "BEGIN" ||
        upperSql === "COMMIT" ||
        upperSql === "ROLLBACK" ||
        sql.includes(
          "checkpoint_blobs"
        ) ||
        sql.includes(
          "checkpoint_writes"
        ) ||
        sql.includes("checkpoints");

      if (!isCheckpoint) {
        return originalQuery(
          ...args
        );
      }

      const label =
        upperSql === "BEGIN"
          ? "BEGIN"
          : upperSql === "COMMIT"
            ? "COMMIT"
            : upperSql === "ROLLBACK"
              ? "ROLLBACK"
              : sql.includes(
                  "checkpoint_blobs"
                )
                ? "checkpoint_blobs"
                : sql.includes(
                    "checkpoint_writes"
                  )
                  ? "checkpoint_writes"
                  : sql.includes(
                      "checkpoints"
                    )
                    ? "checkpoints"
                    : "query";

      const t0 =
        performance.now();

      const result =
        originalQuery(...args);

      if (
        result &&
        typeof result.then ===
          "function"
      ) {
        return result.then(
          (res: any) => {
            console.log(
              `[checkpoint-sql] ${label} duration=${Math.round(performance.now() - t0)}ms`
            );

            return res;
          }
        );
      }

      return result;
    };
}

pool.connect = function (
  ...connectArgs: any[]
) {
  const statsBefore: PoolStats = {
    idle: pool.idleCount ?? 0,
    total: pool.totalCount ?? 0,
    waiting: pool.waitingCount ?? 0,
  };

  const t0 = performance.now();

  const result = _originalPoolConnect(
    ...connectArgs
  );

  if (
    result &&
    typeof result.then === "function"
  ) {
    return result.then(
      (client: any) => {
        instrumentClientQuery(
          client
        );

        const duration = Math.round(
          performance.now() - t0
        );

        const statsAfter: PoolStats = {
          idle: pool.idleCount ?? 0,
          total: pool.totalCount ?? 0,
          waiting: pool.waitingCount ?? 0,
        };

        const newPhysical =
          statsAfter.total >
          statsBefore.total;

        console.log(
          `[checkpoint] pool acquire end duration=${duration}ms idle=${statsAfter.idle} total=${statsAfter.total} waiting=${statsAfter.waiting}${newPhysical ? " physical-connect" : ""}`
        );

        return client;
      }
    );
  }

  return result;
};

const _originalPut =
  saver.put.bind(saver);

const _originalPutWrites =
  saver.putWrites.bind(saver);

saver.put = async function (
  ...args: Parameters<typeof _originalPut>
) {
  const t0 = performance.now();

  const statsBefore: PoolStats = {
    idle: pool.idleCount ?? 0,
    total: pool.totalCount ?? 0,
    waiting: pool.waitingCount ?? 0,
  };

  console.log(
    `[checkpoint] put start pool idle=${statsBefore.idle} total=${statsBefore.total} waiting=${statsBefore.waiting}`
  );

  try {
    const result =
      await _originalPut(...args);

    const statsAfter: PoolStats = {
      idle: pool.idleCount ?? 0,
      total: pool.totalCount ?? 0,
      waiting: pool.waitingCount ?? 0,
    };

    const duration = Math.round(
      performance.now() - t0
    );

    const newPhysical =
      statsAfter.total >
      statsBefore.total;

    console.log(
      `[checkpoint] put end duration=${duration}ms pool idle=${statsAfter.idle} total=${statsAfter.total} waiting=${statsAfter.waiting}${newPhysical ? " NEW_PHYSICAL_CONNECT" : ""}`
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

  const statsBefore: PoolStats = {
    idle: pool.idleCount ?? 0,
    total: pool.totalCount ?? 0,
    waiting: pool.waitingCount ?? 0,
  };

  console.log(
    `[checkpoint] putWrites start writes=${Array.isArray(writes) ? writes.length : "?"} pool idle=${statsBefore.idle} total=${statsBefore.total} waiting=${statsBefore.waiting}`
  );

  try {
    await _originalPutWrites(...args);

    const statsAfter: PoolStats = {
      idle: pool.idleCount ?? 0,
      total: pool.totalCount ?? 0,
      waiting: pool.waitingCount ?? 0,
    };

    const duration = Math.round(
      performance.now() - t0
    );

    const newPhysical =
      statsAfter.total >
      statsBefore.total;

    console.log(
      `[checkpoint] putWrites end duration=${duration}ms pool idle=${statsAfter.idle} total=${statsAfter.total} waiting=${statsAfter.waiting}${newPhysical ? " NEW_PHYSICAL_CONNECT" : ""}`
    );
  } catch (err) {
    console.log(
      `[checkpoint] putWrites error duration=${Math.round(performance.now() - t0)}ms`
    );

    throw err;
  }
};

export const graphCheckpointer = saver;
