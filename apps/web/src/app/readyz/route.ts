import { getPool } from "../../server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const pool = getPool();
  if (!pool) return Response.json({ status: "ok", db: "not-configured" });
  try {
    await pool.query("select 1");
    return Response.json({ status: "ok", db: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", db: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
