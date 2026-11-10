import { runMigrations } from "@theckards/database";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const applied = await runMigrations(
  {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "theckards",
    user: required("DB_ADMIN_USER"),
    password: required("DB_ADMIN_PASSWORD"),
  },
  required("APP_DB_PASSWORD"),
);

console.log(JSON.stringify({ level: "info", msg: "database migrations complete", applied }));
