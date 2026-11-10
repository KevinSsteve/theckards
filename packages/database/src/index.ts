import pg from "pg";
import awsSslProfiles from "aws-ssl-profiles";
import { migrations } from "./migrations.js";

export interface DatabaseConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function runMigrations(
  connection: DatabaseConnection,
  applicationPassword: string,
): Promise<readonly string[]> {
  const client = new pg.Client({
    ...connection,
    ssl: connection.ssl === false ? false : awsSslProfiles,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
  });
  const applied: string[] = [];
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('theckards-schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of migrations) {
      const exists = await client.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE id = $1) AS exists",
        [migration.id],
      );
      if (exists.rows[0]?.exists) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations(id, name) VALUES ($1, $2)",
          [migration.id, migration.name],
        );
        await client.query("COMMIT");
        applied.push(migration.id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const roleExists = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'theckards_app') AS exists",
    );
    if (!roleExists.rows[0]?.exists) {
      await client.query(`CREATE ROLE theckards_app LOGIN PASSWORD ${quoteLiteral(applicationPassword)}`);
    } else {
      await client.query(`ALTER ROLE theckards_app PASSWORD ${quoteLiteral(applicationPassword)}`);
    }
    await client.query("GRANT CONNECT ON DATABASE theckards TO theckards_app");
    await client.query("GRANT USAGE ON SCHEMA public TO theckards_app");
    await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO theckards_app");
    await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO theckards_app");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO theckards_app");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO theckards_app");
    await client.query("REVOKE UPDATE, DELETE ON user_consents, app_settings_history, audit_logs FROM theckards_app");
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('theckards-schema-migrations'))").catch(() => undefined);
    await client.end();
  }
}

export const rdsSsl = awsSslProfiles;

export { migrations } from "./migrations.js";
