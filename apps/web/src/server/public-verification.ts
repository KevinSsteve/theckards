import type { SealKind } from "@theckards/domain";
import { getPool } from "./db";

export interface PublicVerificationResult {
  valid: boolean;
  kind: SealKind | null;
  sealed_at: string | null;
  seal_id: string | null;
  anchored: boolean;
}

export const INVALID_VERIFICATION: PublicVerificationResult = {
  valid: false,
  kind: null,
  sealed_at: null,
  seal_id: null,
  anchored: false,
};

/**
 * Looks up only public seal metadata. Malformed and unknown hashes execute the same query and return
 * exactly the same body, without agreement IDs, titles, names, storage keys or receipt contents.
 */
export async function verifyPublicHash(input: string): Promise<PublicVerificationResult> {
  const validFormat = /^[a-fA-F0-9]{64}$/.test(input);
  const digest = validFormat ? input.toLowerCase() : "0".repeat(64);
  const result = await getPool().query<{ id: string; kind: SealKind; sealed_at: Date; anchored: boolean }>(`
    SELECT id, kind, sealed_at, (anchor_id IS NOT NULL) AS anchored
    FROM sealed_documents WHERE sha256 = $1
  `, [digest]);
  const row = validFormat ? result.rows[0] : undefined;
  if (!row) return INVALID_VERIFICATION;
  return { valid: true, kind: row.kind, sealed_at: row.sealed_at.toISOString(), seal_id: row.id, anchored: row.anchored };
}
