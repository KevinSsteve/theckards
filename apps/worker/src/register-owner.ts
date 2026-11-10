import pg from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const client = new pg.Client({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "theckards",
  user: required("DB_ADMIN_USER"),
  password: required("DB_ADMIN_PASSWORD"),
  ssl: { rejectUnauthorized: true },
});
await client.connect();
try {
  const sub = required("OWNER_COGNITO_SUB");
  const user = await client.query<{ id: string }>("SELECT id FROM users WHERE cognito_sub = $1", [sub]);
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Owner must sign in once before registration");
  await client.query("BEGIN");
  await client.query("INSERT INTO admin_users(user_id, role, state, created_by) VALUES ($1, 'OWNER', 'ACTIVE', $1) ON CONFLICT (user_id) DO UPDATE SET role = 'OWNER', state = 'ACTIVE'", [userId]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ level: "info", msg: "owner registered" }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
