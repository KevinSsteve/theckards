import pg from "pg";
import { rdsSsl } from "@theckards/database";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const pool = new pg.Pool({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "theckards",
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  ssl: rdsSsl,
  max: 5,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  application_name: `theckards-worker-${process.env.APP_ENV ?? "unknown"}`,
});

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
