import type { SealedReceipt } from "@theckards/domain";
import { sha256 } from "./crypto";
import { getPool, inTransaction } from "./db";
import { evidenceLegalReady } from "./evidence";
import { ProblemError } from "./http/problem";
import { currentApprovedLegal, userHasCurrentConsents } from "./legal";
import { member } from "./record";

/**
 * The dossier (S6.3): a party asks for the whole record as one sealed archive, and the worker builds it.
 *
 * The request is deliberately cheap and idempotent. The route returns as soon as the row exists, the worker does
 * the work, and the panel polls. A party may keep every dossier they have asked for, because each one is a
 * snapshot of the record at a different moment and each has its own receipt.
 *
 * The archive embeds evidence files and case history, which only the Privacy Policy that discloses evidence
 * covers, so the dossier opens with the same version that opens evidence rather than introducing a separate
 * disclosure.
 */
export type DossierStatus = "PENDING" | "READY" | "FAILED";

const RECORD_STATES = ["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"];
/** One party cannot queue an unbounded number of builds; each costs a full read of the record plus KMS. */
const MAX_PENDING = 2;

export interface DossierView {
  id: string;
  status: DossierStatus;
  statusLabel: string;
  bytes: number | null;
  sha256: string | null;
  sealId: string | null;
  mine: boolean;
  requestedAt: string;
  readyAt: string | null;
}

const LABELS: Record<DossierStatus, string> = {
  PENDING: "Building the archive and sealing it",
  READY: "Ready to download, with its own receipt",
  FAILED: "Could not be built. Ask for a new one; if it fails again, the record needs attention.",
};

export async function dossierLegalReady(): Promise<boolean> {
  return evidenceLegalReady();
}

async function requireDossierLegal(userId: string): Promise<void> {
  if (!(await dossierLegalReady())) {
    const privacy = (await currentApprovedLegal()).find((document) => document.documentType === "PRIVACY");
    throw new ProblemError(503, "Dossier unavailable",
      `The dossier includes evidence and case history, so it opens with Privacy Policy version 4 (currently approved: version ${privacy?.version ?? 0}).`);
  }
  if (!(await userHasCurrentConsents(userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents first.");
}

export async function listDossiers(userId: string, agreementId: string): Promise<{ legalReady: boolean; canRequest: boolean; items: DossierView[] }> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const result = await pool.query<{
    id: string; party_id: string; status: DossierStatus; bytes: number | null; sha256: string | null;
    sealed_document_id: string | null; created_at: Date; ready_at: Date | null;
  }>(`
    SELECT id, party_id, status, bytes, sha256, sealed_document_id, created_at, ready_at
    FROM dossier_requests WHERE agreement_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT 20
  `, [agreementId, m.partyId]);
  const legalReady = await dossierLegalReady();
  const pending = result.rows.filter((row) => row.status === "PENDING").length;
  return {
    legalReady,
    canRequest: legalReady && RECORD_STATES.includes(m.state) && pending < MAX_PENDING,
    // Only the requester's own dossiers: each one contains that party's private notes.
    items: result.rows.map((row) => ({
      id: row.id, status: row.status, statusLabel: LABELS[row.status], bytes: row.bytes, sha256: row.sha256,
      sealId: row.sealed_document_id, mine: true,
      requestedAt: row.created_at.toISOString(), readyAt: row.ready_at?.toISOString() ?? null,
    })),
  };
}

export async function requestDossier(input: { userId: string; agreementId: string; idempotencyKey: string }): Promise<DossierView> {
  await requireDossierLegal(input.userId);
  const created = await inTransaction(async (client) => {
    const m = await member(client, input.userId, input.agreementId, true);
    if (!RECORD_STATES.includes(m.state)) {
      throw new ProblemError(409, "Invalid state", "A dossier can be exported once both parties have signed.");
    }
    const key = sha256(`dossier:${input.idempotencyKey}`);
    const existing = await client.query<{ id: string; status: DossierStatus; bytes: number | null; sha256: string | null; sealed_document_id: string | null; created_at: Date; ready_at: Date | null }>(
      "SELECT id, status, bytes, sha256, sealed_document_id, created_at, ready_at FROM dossier_requests WHERE party_id = $1 AND client_key = $2",
      [m.partyId, key],
    );
    if (existing.rows[0]) return existing.rows[0];
    const pending = await client.query<{ count: string }>(
      "SELECT count(*) FROM dossier_requests WHERE party_id = $1 AND status = 'PENDING'", [m.partyId],
    );
    if (Number(pending.rows[0]?.count ?? 0) >= MAX_PENDING) {
      throw new ProblemError(429, "Too many dossiers", "Wait for the dossier you already asked for to finish.");
    }
    const inserted = await client.query<{ id: string; status: DossierStatus; bytes: number | null; sha256: string | null; sealed_document_id: string | null; created_at: Date; ready_at: Date | null }>(`
      INSERT INTO dossier_requests(agreement_id, party_id, client_key) VALUES ($1, $2, $3)
      RETURNING id, status, bytes, sha256, sealed_document_id, created_at, ready_at
    `, [input.agreementId, m.partyId, key]);
    const row = inserted.rows[0]!;
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('dossier.build', $1::jsonb)", [JSON.stringify({ requestId: row.id })]);
    return row;
  });
  return {
    id: created.id, status: created.status, statusLabel: LABELS[created.status], bytes: created.bytes,
    sha256: created.sha256, sealId: created.sealed_document_id, mine: true,
    requestedAt: created.created_at.toISOString(), readyAt: created.ready_at?.toISOString() ?? null,
  };
}

/**
 * The archive and its receipt, for the party who asked for it only. A dossier carries that party's private
 * notes, so the other party must not be able to read it even though they are a party to the same agreement.
 */
export async function dossierArtifact(userId: string, agreementId: string, requestId: string): Promise<{ key: string; filename: string; sha256: string; receipt: SealedReceipt }> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const row = (await pool.query<{ status: DossierStatus; s3_key: string | null; sha256: string | null; sealed_document_id: string | null; receipt: SealedReceipt | null }>(`
    SELECT r.status, r.s3_key, r.sha256, r.sealed_document_id, d.receipt
    FROM dossier_requests r LEFT JOIN sealed_documents d ON d.id = r.sealed_document_id
    WHERE r.id = $1 AND r.agreement_id = $2 AND r.party_id = $3
  `, [requestId, agreementId, m.partyId])).rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Dossier not found.");
  if (row.status !== "READY" || !row.s3_key || !row.sha256 || !row.receipt) {
    throw new ProblemError(409, "Not ready", "This dossier is not ready yet.");
  }
  return { key: row.s3_key, filename: `theckards-dossier-${row.sealed_document_id}.zip`, sha256: row.sha256, receipt: row.receipt };
}
