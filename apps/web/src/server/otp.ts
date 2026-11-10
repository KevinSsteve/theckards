import { randomInt } from "node:crypto";
import { encryptText, equalHex, hmac } from "./crypto";
import { getPool, inTransaction } from "./db";
import { ProblemError } from "./http/problem";
import { enforceRateLimit } from "./rate-limit";

export type OtpRecipient = { kind: "user"; userId: string } | { kind: "party"; partyId: string };

async function otpPolicy(): Promise<{ validityMinutes: number; maxAttempts: number }> {
  const result = await getPool().query<{ validity: string | null; attempts: string | null }>(
    "SELECT value->>'otpValidityMinutes' AS validity, value->>'otpMaxAttempts' AS attempts FROM app_settings WHERE key = 'auth'",
  );
  const row = result.rows[0];
  return {
    validityMinutes: Math.min(30, Math.max(2, Number(row?.validity ?? 10))),
    maxAttempts: Math.min(5, Math.max(1, Number(row?.attempts ?? 5))),
  };
}

/** Issues a 6-digit email code. Stores only its HMAC; the code travels to the worker encrypted with KMS. */
export async function issueOtp(input: { scope: string; emailHash: string; ip: string; recipient: OtpRecipient }): Promise<{ expiresAt: string }> {
  try {
    await enforceRateLimit("otp-email", input.emailHash, 5, 3600);
    await enforceRateLimit("otp-ip", input.ip, 10, 3600);
  } catch {
    throw new ProblemError(429, "Too Many Requests", "Too many verification codes were requested. Try again later.");
  }
  const { validityMinutes } = await otpPolicy();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeCiphertext = await encryptText(code, "otp-code");
  const expiresAt = new Date(Date.now() + validityMinutes * 60_000);
  await inTransaction(async (client) => {
    await client.query("UPDATE otp_codes SET consumed_at = now() WHERE scope = $1 AND subject_hash = $2 AND consumed_at IS NULL", [input.scope, input.emailHash]);
    await client.query(
      "INSERT INTO otp_codes(scope, subject_hash, code_hash, ip_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [input.scope, input.emailHash, hmac(`${input.scope}:${code}`, "auth"), hmac(input.ip, "auth"), expiresAt],
    );
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('email.otp', $1::jsonb)", [JSON.stringify({
      recipient: input.recipient, codeCiphertext: codeCiphertext.toString("base64"), validityMinutes,
    })]);
  });
  return { expiresAt: expiresAt.toISOString() };
}

/** Verifies and consumes a code in its own transaction so failed attempts are always counted. */
export async function verifyOtp(scope: string, emailHash: string, code: string): Promise<Date> {
  const { maxAttempts } = await otpPolicy();
  const outcome = await inTransaction(async (client) => {
    const result = await client.query<{ id: string; code_hash: string; attempts: number }>(`
      SELECT id, code_hash, attempts FROM otp_codes
      WHERE scope = $1 AND subject_hash = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE
    `, [scope, emailHash]);
    const row = result.rows[0];
    if (!row || row.attempts >= maxAttempts) return "invalid" as const;
    const matches = equalHex(hmac(`${scope}:${code}`, "auth"), row.code_hash);
    if (matches) {
      await client.query("UPDATE otp_codes SET attempts = attempts + 1, consumed_at = now() WHERE id = $1", [row.id]);
      return "ok" as const;
    }
    await client.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
    return "invalid" as const;
  });
  if (outcome !== "ok") throw new ProblemError(422, "Invalid code", "The verification code is invalid or expired. Request a new code.");
  return new Date();
}
