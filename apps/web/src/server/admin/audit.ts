import { createHash } from "node:crypto";
import type pg from "pg";

interface AuditInput {
  actorType: "USER" | "ADMIN" | "GUEST" | "SYSTEM";
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  before?: unknown;
  after?: unknown;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /secret|password|token|credential|private.?key/i.test(key) ? "[REDACTED]" : redact(item),
  ]));
}

export async function writeAudit(client: pg.PoolClient, input: AuditInput): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('theckards-audit-chain'))");
  const previous = await client.query<{ row_hash: string }>("SELECT row_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1");
  const before = redact(input.before);
  const after = redact(input.after);
  const prevHash = previous.rows[0]?.row_hash ?? null;
  const rowHash = createHash("sha256").update(canonical({ ...input, before, after, prevHash })).digest("hex");
  await client.query(`
    INSERT INTO audit_logs(actor_type, actor_id, action, entity_type, entity_id, request_id, before_value, after_value, prev_hash, row_hash)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
  `, [input.actorType, input.actorId ?? null, input.action, input.entityType, input.entityId ?? null, input.requestId ?? null,
      before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), prevHash, rowHash]);
}
