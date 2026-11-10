import pg from "pg";
import { rdsSsl } from "@theckards/database";
import { env } from "./env";

const globalPool = globalThis as typeof globalThis & { __theckardsPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (globalPool.__theckardsPool) return globalPool.__theckardsPool;
  const config = env();
  globalPool.__theckardsPool = new pg.Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    ssl: rdsSsl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: `theckards-web-${config.APP_ENV}`,
  });
  globalPool.__theckardsPool.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", msg: "idle database client error", error: error.name }));
  });
  return globalPool.__theckardsPool;
}

export async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
