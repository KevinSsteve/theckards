import { createHmac } from "node:crypto";
import { EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { pool } from "./db.js";

/**
 * One-off bootstrap: registers the first OWNER for an existing Cognito user (member of the `admins` group).
 * Uses the application DB role; encryption context and HMAC match apps/web/src/server/crypto.ts.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const email = required("OWNER_EMAIL").trim().toLowerCase();
const sub = required("OWNER_COGNITO_SUB");
const kms = new KMSClient({});
const encrypted = await kms.send(new EncryptCommand({
  KeyId: required("DATA_KEY_ARN"), Plaintext: Buffer.from(email, "utf8"),
  EncryptionContext: { service: "theckards", purpose: "user-email" },
}));
const emailHash = createHmac("sha256", required("EMAIL_HASH_SECRET")).update(email).digest("hex");

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = await client.query<{ id: string }>(`
    INSERT INTO users(cognito_sub, email_ciphertext, email_hash) VALUES ($1, $2, $3)
    ON CONFLICT (cognito_sub) DO UPDATE SET email_ciphertext = EXCLUDED.email_ciphertext, email_hash = EXCLUDED.email_hash, updated_at = now()
    RETURNING id
  `, [sub, Buffer.from(encrypted.CiphertextBlob!), emailHash]);
  const userId = user.rows[0]!.id;
  await client.query(`
    INSERT INTO admin_users(user_id, role, state, created_by) VALUES ($1, 'OWNER', 'ACTIVE', $1)
    ON CONFLICT (user_id) DO UPDATE SET role = 'OWNER', state = 'ACTIVE'
  `, [userId]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ level: "info", msg: "owner registered" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
