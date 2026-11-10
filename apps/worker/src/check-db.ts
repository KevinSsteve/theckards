import pg from "pg";
import { rdsSsl } from "@theckards/database";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const client = new pg.Client({
  host: required("DB_HOST"), port: Number(process.env.DB_PORT ?? 5432), database: process.env.DB_NAME ?? "theckards",
  user: required("DB_USER"), password: required("DB_PASSWORD"), ssl: rdsSsl,
});
await client.connect();
try {
  const identity = await client.query<{ current_user: string }>("SELECT current_user");
  const settings = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM app_settings");
  const legal = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM legal_documents");
  let migrationsDenied = false;
  try { await client.query("SELECT 1 FROM schema_migrations LIMIT 1"); }
  catch (error) { migrationsDenied = error instanceof Error && "code" in error && error.code === "42501"; }
  if (!migrationsDenied) throw new Error("Application role can read schema_migrations");

  const audit = await client.query<{ id: string }>(`
    INSERT INTO audit_logs(actor_type, action, entity_type, row_hash)
    VALUES ('SYSTEM', 'DB_PERMISSION_CHECK', 'database', repeat('0', 64)) RETURNING id
  `);
  let appendOnlyEnforced = false;
  try { await client.query("DELETE FROM audit_logs WHERE id = $1", [audit.rows[0]!.id]); }
  catch (error) { appendOnlyEnforced = error instanceof Error && "code" in error && error.code === "55000"; }
  if (!appendOnlyEnforced) throw new Error("Append-only audit guard is not enforced");

  console.log(JSON.stringify({
    level: "info", msg: "application database role verified",
    currentUser: identity.rows[0]?.current_user,
    settings: Number(settings.rows[0]?.count ?? 0),
    legalDocuments: Number(legal.rows[0]?.count ?? 0),
    migrationsDenied, appendOnlyEnforced,
  }));
} finally {
  await client.end();
}
