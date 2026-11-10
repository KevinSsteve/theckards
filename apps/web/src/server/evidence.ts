import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { EVIDENCE_MAX_BYTES, isEvidenceType, type EvidenceType } from "@theckards/domain";
import { randomToken, sha256 } from "./crypto";
import { getPool, inTransaction } from "./db";
import { env } from "./env";
import { ProblemError } from "./http/problem";
import { currentApprovedLegal, userHasCurrentConsents } from "./legal";
import { member } from "./record";

/**
 * Evidence uploads (S5 part 3). The browser uploads straight into a quarantine bucket with a presigned PUT that
 * is signed for one exact content type and length. Nothing is ever served from that bucket. GuardDuty scans the
 * object and the worker promotes it only on a clean result, so evidence is invisible until it is proven clean.
 */
const s3 = new S3Client({});
const UPLOAD_WINDOW_SECONDS = 300;

/** Privacy v4 is the first version that discloses evidence files and their metadata. */
export const EVIDENCE_MIN_PRIVACY_VERSION = 4;

export type ScanStatus = "AWAITING_UPLOAD" | "PENDING" | "CLEAN" | "INFECTED" | "UNSUPPORTED" | "FAILED";
const RECORD_STATES = ["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"];

export async function evidenceLegalReady(): Promise<boolean> {
  const privacy = (await currentApprovedLegal()).find((document) => document.documentType === "PRIVACY");
  return (privacy?.version ?? 0) >= EVIDENCE_MIN_PRIVACY_VERSION;
}

async function requireEvidenceLegal(userId: string): Promise<void> {
  if (!(await evidenceLegalReady())) {
    throw new ProblemError(503, "Evidence unavailable", "Attaching evidence opens after the updated Privacy Policy (version 4) is approved.");
  }
  if (!(await userHasCurrentConsents(userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents first.");
}

export interface EvidenceView {
  id: string;
  filename: string;
  contentType: string;
  note: string | null;
  bytes: number | null;
  sha256: string | null;
  status: ScanStatus;
  statusLabel: string;
  mine: boolean;
  uploadedBy: string;
  createdAt: string;
  downloadable: boolean;
}

const LABELS: Record<ScanStatus, string> = {
  AWAITING_UPLOAD: "Upload not finished",
  PENDING: "Checking the file for malware before the other party can see it",
  CLEAN: "Checked and available to both parties",
  INFECTED: "Rejected: malware was found, and the file was deleted",
  UNSUPPORTED: "Could not be checked, so it was not accepted. Upload a plain image or PDF, not an archive or a protected file.",
  FAILED: "The check did not complete. Upload the file again.",
};

export async function listEvidence(userId: string, agreementId: string): Promise<{ legalReady: boolean; canUpload: boolean; items: EvidenceView[] }> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const result = await pool.query<{
    id: string; party_id: string; filename: string; content_type: string; note: string | null; declared_bytes: number;
    stored_bytes: number | null; sha256: string | null; scan_status: ScanStatus; created_at: Date;
  }>(`
    SELECT id, party_id, filename, content_type, note, declared_bytes, stored_bytes, sha256, scan_status, created_at
    FROM evidence WHERE agreement_id = $1 AND (scan_status <> 'AWAITING_UPLOAD' OR party_id = $2)
    ORDER BY created_at DESC
  `, [agreementId, m.partyId]);
  const legalReady = await evidenceLegalReady();
  return {
    legalReady,
    canUpload: legalReady && RECORD_STATES.includes(m.state),
    items: result.rows.map((row) => ({
      id: row.id, filename: row.filename, contentType: row.content_type, note: row.note,
      bytes: row.stored_bytes ?? row.declared_bytes, sha256: row.sha256, status: row.scan_status,
      statusLabel: LABELS[row.scan_status], mine: row.party_id === m.partyId,
      uploadedBy: m.parties.find((party) => party.id === row.party_id)?.name ?? "A party",
      createdAt: row.created_at.toISOString(), downloadable: row.scan_status === "CLEAN",
    })),
  };
}

export async function requestEvidenceUpload(input: {
  userId: string; agreementId: string; filename: string; contentType: string; bytes: number; note?: string; idempotencyKey: string;
}): Promise<{ id: string; uploadUrl: string; contentType: EvidenceType; expiresInSeconds: number }> {
  if (!isEvidenceType(input.contentType)) throw new ProblemError(422, "Unsupported file", "Attach a JPEG, PNG, WebP or PDF file.");
  if (!Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > EVIDENCE_MAX_BYTES) {
    throw new ProblemError(422, "File too large", "Evidence files are limited to 25 MB.");
  }
  await requireEvidenceLegal(input.userId);
  const contentType = input.contentType;
  const created = await inTransaction(async (client) => {
    const m = await member(client, input.userId, input.agreementId, true);
    if (!RECORD_STATES.includes(m.state)) throw new ProblemError(409, "Invalid state", "Evidence can be attached after both parties sign.");
    const key = sha256(`evidence:${input.idempotencyKey}`);
    const existing = await client.query<{ id: string; quarantine_key: string; scan_status: ScanStatus }>(
      "SELECT id, quarantine_key, scan_status FROM evidence WHERE party_id = $1 AND client_key = $2", [m.partyId, key],
    );
    if (existing.rows[0]) return existing.rows[0];
    // Unguessable key: the quarantine bucket is never listed or served, but a key should not be derivable either.
    const quarantineKey = `evidence/${input.agreementId}/${randomToken(24)}`;
    const inserted = await client.query<{ id: string; quarantine_key: string; scan_status: ScanStatus }>(`
      INSERT INTO evidence(agreement_id, party_id, filename, content_type, declared_bytes, note, quarantine_key, client_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, quarantine_key, scan_status
    `, [input.agreementId, m.partyId, input.filename.trim().slice(0, 255), contentType, input.bytes, input.note?.trim() || null, quarantineKey, key]);
    return inserted.rows[0]!;
  });
  if (created.scan_status !== "AWAITING_UPLOAD") throw new ProblemError(409, "Already uploaded", "This file was already uploaded.");
  // Signed for exactly this type and length, so S3 rejects a different file than the one declared.
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: env().EVIDENCE_QUARANTINE_BUCKET, Key: created.quarantine_key, ContentType: contentType, ContentLength: input.bytes,
  }), { expiresIn: UPLOAD_WINDOW_SECONDS });
  return { id: created.id, uploadUrl, contentType, expiresInSeconds: UPLOAD_WINDOW_SECONDS };
}

/** Called by the uploader's browser after the PUT succeeds. The scan itself is started by S3, not by us. */
export async function confirmEvidenceUpload(input: { userId: string; agreementId: string; evidenceId: string }): Promise<{ status: ScanStatus }> {
  await requireEvidenceLegal(input.userId);
  const pool = getPool();
  const m = await member(pool, input.userId, input.agreementId);
  const row = (await pool.query<{ quarantine_key: string; declared_bytes: number; scan_status: ScanStatus }>(
    "SELECT quarantine_key, declared_bytes, scan_status FROM evidence WHERE id = $1 AND agreement_id = $2 AND party_id = $3",
    [input.evidenceId, input.agreementId, m.partyId],
  )).rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Evidence not found.");
  if (row.scan_status !== "AWAITING_UPLOAD") return { status: row.scan_status };
  const head = await s3.send(new HeadObjectCommand({ Bucket: env().EVIDENCE_QUARANTINE_BUCKET, Key: row.quarantine_key }))
    .catch(() => { throw new ProblemError(409, "Upload incomplete", "The file did not finish uploading. Try again."); });
  if (head.ContentLength !== row.declared_bytes) {
    throw new ProblemError(409, "Upload mismatch", "The uploaded file does not match what was declared. Try again.");
  }
  await pool.query(
    "UPDATE evidence SET scan_status = 'PENDING', uploaded_at = now() WHERE id = $1 AND scan_status = 'AWAITING_UPLOAD'",
    [input.evidenceId],
  );
  return { status: "PENDING" };
}

/** Party-only, and only once the scan came back clean. */
export async function evidenceObject(userId: string, agreementId: string, evidenceId: string): Promise<{ key: string; filename: string; contentType: string }> {
  const pool = getPool();
  await member(pool, userId, agreementId);
  const row = (await pool.query<{ stored_key: string | null; filename: string; content_type: string; scan_status: ScanStatus }>(
    "SELECT stored_key, filename, content_type, scan_status FROM evidence WHERE id = $1 AND agreement_id = $2",
    [evidenceId, agreementId],
  )).rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Evidence not found.");
  if (row.scan_status !== "CLEAN" || !row.stored_key) {
    throw new ProblemError(409, "Not available", "This file is not available: it has not passed the malware check.");
  }
  return { key: row.stored_key, filename: row.filename, contentType: row.content_type };
}
