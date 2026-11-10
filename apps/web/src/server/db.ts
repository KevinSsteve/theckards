import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool | undefined {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  if (!host) return undefined;
  pool = new pg.Pool({
    host,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? "theckards",
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  return pool;
}
