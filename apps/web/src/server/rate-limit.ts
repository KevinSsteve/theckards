import { hmac } from "./crypto";
import { getPool } from "./db";

export function requestAddress(request: Request): string {
  return request.headers.get("cloudfront-viewer-address")?.split(":")[0]
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export async function enforceRateLimit(scope: string, subject: string, limit: number, windowSeconds: number): Promise<void> {
  const key = hmac(`${scope}:${subject}`, "auth");
  const result = await getPool().query<{ count: string }>(`
    WITH inserted AS (
      INSERT INTO rate_limit_events(scope, subject_hash) VALUES ($1, $2)
      RETURNING 1
    )
    SELECT count(*)::text AS count
    FROM rate_limit_events
    WHERE scope = $1 AND subject_hash = $2
      AND created_at >= now() - ($3::text || ' seconds')::interval
  `, [scope, key, windowSeconds]);
  if (Number(result.rows[0]?.count ?? 0) > limit) throw new Error("Rate limit exceeded");
}
