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

/*
 * Pool diagnostics: measure how long
 * pool.connect() takes vs the actual
 * SQL work inside put()/putWrites().
 *
 * The pool is a public property on
 * PostgresSaver. We read its getter-
 * based stats before and after connect
 * to detect:
 *  - idle client reuse (fast path)
 *  - queue wait (pool exhausted)
 *  - new physical connection creation
 */
type PoolStats = {
  idle: number;
  total: number;
  waiting: number;
};

const pool = (saver as any).pool;

const _originalPoolConnect =
  pool.connect.bind(pool);

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

  const pool = (saver as any).pool;
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
      statsAfter.total > statsBefore.total;

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

  const pool = (saver as any).pool;
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
      statsAfter.total > statsBefore.total;

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
