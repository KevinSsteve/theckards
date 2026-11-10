import { getPool } from "../db";
import { ProblemError } from "./problem";

export interface IdempotencyClaim {
  scope: string;
  key: string;
  requestHash: string;
}

export async function claimIdempotency(claim: IdempotencyClaim): Promise<Response | null> {
  const inserted = await getPool().query(
    "INSERT INTO idempotency_keys(scope, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
    [claim.scope, claim.key, claim.requestHash],
  );
  if (inserted.rowCount === 1) return null;
  const existing = await getPool().query<{ request_hash: string; response_status: number | null; response_body: unknown }>(
    "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2",
    [claim.scope, claim.key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== claim.requestHash) throw new ProblemError(409, "Idempotency conflict", "This Idempotency-Key was already used for a different request.");
  if (row.response_status === null) throw new ProblemError(409, "Request in progress", "A request with this Idempotency-Key is still being processed.");
  return Response.json(row.response_body, { status: row.response_status, headers: { "idempotency-replayed": "true" } });
}

export async function completeIdempotency(claim: IdempotencyClaim, response: Response): Promise<void> {
  const text = await response.clone().text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { throw new Error("Idempotent responses must be JSON"); }
  await getPool().query(
    "UPDATE idempotency_keys SET response_status = $4, response_body = $5::jsonb WHERE scope = $1 AND key = $2 AND request_hash = $3",
    [claim.scope, claim.key, claim.requestHash, response.status, JSON.stringify(body)],
  );
}

export async function releaseIdempotency(claim: IdempotencyClaim): Promise<void> {
  await getPool().query(
    "DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND request_hash = $3 AND response_status IS NULL",
    [claim.scope, claim.key, claim.requestHash],
  );
}
