import { hmac } from "./crypto";
import { getPool } from "./db";

/**
 * Client IP behind CloudFront -> ALB. Clients can prepend arbitrary X-Forwarded-For entries; CloudFront appends the
 * real viewer IP and the ALB then appends the CloudFront edge IP, so the trustworthy viewer entry is second-to-last.
 */
export function requestAddress(request: Request): string {
  const viewer = request.headers.get("cloudfront-viewer-address");
  if (viewer) return viewer.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain.length >= 2 ? chain[chain.length - 2]! : chain[0] ?? "unknown";
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
