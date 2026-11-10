import { canonicalJson } from "./canonical.js";

export const SEAL_ALGORITHM = "ECDSA_P256_SHA256" as const;
export type SealKind = "FINAL" | "ADDENDUM" | "DOSSIER";

export interface ReceiptCore {
  id: string;
  kind: SealKind;
  sha256: string;
  content_sha256: string;
  sealed_at: string;
}

export interface SealedReceipt extends ReceiptCore {
  key_id: string;
  algorithm: typeof SEAL_ALGORITHM;
  signature: string;
}

/** Exact bytes signed by KMS (ECDSA_SHA_256, RAW message): RFC 8785 canonical JSON of the five core fields. */
export function receiptSigningPayload(receipt: ReceiptCore): string {
  return canonicalJson({
    id: receipt.id,
    kind: receipt.kind,
    sha256: receipt.sha256,
    content_sha256: receipt.content_sha256,
    sealed_at: receipt.sealed_at,
  });
}

/** Deterministic UUID-shaped identifier derived from a hex digest, so retried seal jobs produce identical bytes. */
export function uuidFromHex(hex: string): string {
  const h = hex.slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
