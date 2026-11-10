import { createHash } from "node:crypto";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { SEAL_ALGORITHM, receiptSigningPayload, uuidFromHex, type ReceiptCore, type SealKind, type SealedReceipt } from "@theckards/domain";

const kms = new KMSClient({});

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Seal IDs are derived from the sealed subject so a retried job produces identical PDF bytes. */
export function sealIdFor(agreementId: string, versionId: string, kind: SealKind): string {
  return uuidFromHex(sha256Hex(`theckards-seal:${kind}:${agreementId}:${versionId}`));
}

/** Signs the canonical receipt payload with the asymmetric KMS key (ECDSA P-256, SHA-256, DER signature). */
export async function signReceipt(core: ReceiptCore, keyArn: string): Promise<{ receipt: SealedReceipt; signature: Buffer; keyId: string }> {
  const payload = Buffer.from(receiptSigningPayload(core), "utf8");
  const output = await kms.send(new SignCommand({
    KeyId: keyArn, Message: payload, MessageType: "RAW", SigningAlgorithm: "ECDSA_SHA_256",
  }));
  if (!output.Signature || !output.KeyId) throw new Error("KMS did not return a signature");
  const keyId = output.KeyId.split("/").pop()!;
  const signature = Buffer.from(output.Signature);
  return { receipt: { ...core, key_id: keyId, algorithm: SEAL_ALGORITHM, signature: signature.toString("base64") }, signature, keyId };
}
