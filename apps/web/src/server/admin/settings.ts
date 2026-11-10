import type { SettingKey } from "@theckards/domain";
import { validateSetting } from "@theckards/domain";
import { getPool, inTransaction } from "../db";
import { writeAudit } from "./audit";

export interface StoredSetting {
  key: SettingKey;
  value: unknown;
  version: number;
  updatedAt: Date;
}

export async function listSettings(): Promise<StoredSetting[]> {
  const result = await getPool().query<{ key: SettingKey; value: unknown; version: number; updated_at: Date }>(
    "SELECT key, value, version, updated_at FROM app_settings ORDER BY key",
  );
  return result.rows.map((row) => ({ key: row.key, value: row.value, version: row.version, updatedAt: row.updated_at }));
}

export async function getSetting(key: SettingKey): Promise<StoredSetting | null> {
  const result = await getPool().query<{ key: SettingKey; value: unknown; version: number; updated_at: Date }>(
    "SELECT key, value, version, updated_at FROM app_settings WHERE key = $1",
    [key],
  );
  const row = result.rows[0];
  return row ? { key: row.key, value: row.value, version: row.version, updatedAt: row.updated_at } : null;
}

export async function updateSetting(input: {
  key: SettingKey;
  value: unknown;
  expectedVersion: number;
  actorId: string;
  requestId: string;
}): Promise<StoredSetting> {
  const validated = validateSetting(input.key, input.value);
  return inTransaction(async (client) => {
    const current = await client.query<{ value: unknown; version: number }>(
      "SELECT value, version FROM app_settings WHERE key = $1 FOR UPDATE",
      [input.key],
    );
    const previous = current.rows[0];
    if (!previous) throw new Error("Setting not found");
    if (previous.version !== input.expectedVersion) throw new Error("Setting version conflict");
    const nextVersion = previous.version + 1;
    await client.query(
      "UPDATE app_settings SET value = $2::jsonb, version = $3, updated_by = $4, updated_at = now() WHERE key = $1",
      [input.key, JSON.stringify(validated), nextVersion, input.actorId],
    );
    await client.query(
      "INSERT INTO app_settings_history(setting_key, value, version, changed_by) VALUES ($1, $2::jsonb, $3, $4)",
      [input.key, JSON.stringify(validated), nextVersion, input.actorId],
    );
    await writeAudit(client, {
      actorType: "ADMIN", actorId: input.actorId, action: "SETTING_UPDATED", entityType: "app_setting",
      entityId: input.key, requestId: input.requestId, before: previous.value, after: validated,
    });
    return { key: input.key, value: validated, version: nextVersion, updatedAt: new Date() };
  });
}

export async function listAudit(limit = 100): Promise<Array<Record<string, unknown>>> {
  const result = await getPool().query(
    "SELECT id, actor_type, actor_id, action, entity_type, entity_id, request_id, before_value, after_value, row_hash, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1",
    [Math.min(limit, 500)],
  );
  return result.rows;
}
