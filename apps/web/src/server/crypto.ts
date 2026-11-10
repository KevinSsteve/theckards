import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { env } from "./env";

const kms = new KMSClient({});

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string, purpose: "auth" | "email"): string {
  const key = purpose === "auth" ? env().AUTH_HMAC_SECRET : env().EMAIL_HASH_SECRET;
  return createHmac("sha256", key).update(value).digest("hex");
}

export function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function encryptText(value: string, purpose: string): Promise<Buffer> {
  const result = await kms.send(new EncryptCommand({
    KeyId: env().DATA_KEY_ARN,
    Plaintext: Buffer.from(value, "utf8"),
    EncryptionContext: { service: "theckards", purpose },
  }));
  if (!result.CiphertextBlob) throw new Error("KMS did not return ciphertext");
  return Buffer.from(result.CiphertextBlob);
}

export async function decryptText(value: Uint8Array, purpose: string): Promise<string> {
  const result = await kms.send(new DecryptCommand({
    CiphertextBlob: value,
    EncryptionContext: { service: "theckards", purpose },
  }));
  if (!result.Plaintext) throw new Error("KMS did not return plaintext");
  return Buffer.from(result.Plaintext).toString("utf8");
}

export function signPayload(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${hmac(encoded, "auth")}`;
}

export function verifySignedPayload<T>(value: string): T | null {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || !equalHex(hmac(encoded, "auth"), signature)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
