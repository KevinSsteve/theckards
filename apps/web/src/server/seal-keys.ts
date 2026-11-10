import { createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { SEAL_ALGORITHM } from "@theckards/domain";
import { env } from "./env";

const kms = new KMSClient({});
let cached: { at: number; body: unknown } | undefined;

/** Public seal keys. Rotated keys are appended to SEAL_PUBLIC_KEY_ARNS; old keys are never removed. */
export async function publicSealKeys(): Promise<unknown> {
  if (cached && Date.now() - cached.at < 3_600_000) return cached.body;
  const arns = [env().SEAL_KEY_ARN];
  const keys = await Promise.all(arns.map(async (arn) => {
    const output = await kms.send(new GetPublicKeyCommand({ KeyId: arn }));
    if (!output.PublicKey || !output.KeyId) throw new Error("KMS public key unavailable");
    const pem = createPublicKey({ key: Buffer.from(output.PublicKey), format: "der", type: "spki" }).export({ format: "pem", type: "spki" }).toString();
    return { key_id: output.KeyId.split("/").pop(), algorithm: SEAL_ALGORITHM, public_key_pem: pem, status: "ACTIVE" };
  }));
  const body = {
    issuer: "Theckards",
    signed_payload: "RFC 8785 canonical JSON of {id, kind, sha256, content_sha256, sealed_at}",
    keys,
  };
  cached = { at: Date.now(), body };
  return body;
}
