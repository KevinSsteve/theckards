import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  CONFIRMATION_LABELS, DOSSIER_MANIFEST, DOSSIER_README, archiveSafeName, dossierManifest, dossierReadme,
  manifestBytes, zipStore, type AgreementSection, type ConfirmationKind, type ManifestFile, type SealedReceipt,
  type TemplateId, type ZipEntry,
} from "@theckards/domain";
import { pool, transaction } from "./db.js";
import { sealIdFor, sha256Hex, signReceipt } from "./seal.js";

/**
 * Builds the dossier for one request: the whole record of an agreement as one archive, sealed like any other
 * Theckards document (S6.3, R-EXP-1).
 *
 * Three rules shape this job.
 *
 * It is a snapshot, not a live view: everything is read once, written into the archive, hashed and sealed, so a
 * reader checking the manifest later gets the same answer the builder got.
 *
 * It exports what the parties can already see in the record and nothing more. Signing IP addresses and user
 * agents are personal data, kept for the signature record but never written into a file that leaves the system.
 *
 * It never holds an unbounded amount of data. Evidence files are included up to a byte budget; beyond it, a file
 * is listed with its hash and marked as not included, because the worker has 1 GB of memory and a party may
 * have attached many 25 MB files.
 */
const s3 = new S3Client({});
const bucket = process.env.DOCUMENTS_BUCKET!;
const baseUrl = process.env.APP_BASE_URL!;

/** Total bytes of evidence files written into one archive. */
export const EVIDENCE_BUDGET_BYTES = 50 * 1024 * 1024;

const encoder = new TextEncoder();
const json = (value: unknown): Uint8Array => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

interface RequestRow {
  id: string; agreement_id: string; party_id: string; status: string;
  title: string; state: string; template_id: TemplateId; created_at: Date; due_at: Date | null; current_version_number: number;
}

/** A failure the record itself causes, which retrying cannot fix. */
class TerminalDossierError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function collect(request: RequestRow): Promise<{ files: ManifestFile[]; entries: ZipEntry[] }> {
  const agreementId = request.agreement_id;
  const entries: ZipEntry[] = [];
  const files: ManifestFile[] = [];

  const add = (path: string, bytes: Uint8Array, describes: string): void => {
    entries.push({ path, bytes });
    files.push({ path, sha256: sha256Hex(bytes), bytes: bytes.byteLength, describes });
  };

  const [versions, parties, signatures, confirmations, messages, notes, sealed, caseRow, evidence] = await Promise.all([
    pool.query<{ number: number; title: string; fields: Record<string, unknown>; content_sha256: string; document_sha256: string | null; created_at: Date }>(
      "SELECT number, title, fields, content_sha256, document_sha256, created_at FROM agreement_versions WHERE agreement_id = $1 ORDER BY number", [agreementId]),
    pool.query<{ id: string; role: string; display_name: string; has_account: boolean; created_at: Date }>(
      "SELECT id, role, display_name, user_id IS NOT NULL AS has_account, created_at FROM parties WHERE agreement_id = $1 ORDER BY role DESC", [agreementId]),
    pool.query<{ party_id: string; role: string; typed_name: string; signed_at: Date; method: string; document_sha256: string; content_sha256: string; esign_title: string; esign_version: number }>(`
      SELECT s.party_id, p.role, s.typed_name, s.signed_at, s.verification_method AS method, s.document_sha256, s.content_sha256,
        l.title AS esign_title, l.version AS esign_version
      FROM signatures s JOIN parties p ON p.id = s.party_id JOIN legal_documents l ON l.id = s.esign_document_id
      WHERE s.agreement_id = $1 ORDER BY s.signed_at`, [agreementId]),
    pool.query<{ kind: string; party_id: string; note: string | null; created_at: Date }>(
      "SELECT kind, party_id, note, created_at FROM confirmations WHERE agreement_id = $1 ORDER BY created_at", [agreementId]),
    pool.query<{ party_id: string; body: string; created_at: Date }>(
      "SELECT party_id, body, created_at FROM messages WHERE agreement_id = $1 ORDER BY created_at", [agreementId]),
    pool.query<{ party_id: string; body: string; created_at: Date }>(
      "SELECT party_id, body, created_at FROM record_notes WHERE agreement_id = $1 AND party_id = $2 ORDER BY created_at", [agreementId, request.party_id]),
    pool.query<{ id: string; kind: string; s3_key: string; sha256: string; receipt: SealedReceipt; sealed_at: Date }>(
      "SELECT id, kind, s3_key, sha256, receipt, sealed_at FROM sealed_documents WHERE agreement_id = $1 AND kind <> 'DOSSIER' ORDER BY sealed_at", [agreementId]),
    pool.query<{ id: string; reason: string; status: string; opened_by_party_id: string; opened_at: Date; closed_at: Date | null; evidence_window_ends_at: Date }>(
      "SELECT id, reason, status, opened_by_party_id, opened_at, closed_at, evidence_window_ends_at FROM cases WHERE agreement_id = $1 ORDER BY opened_at", [agreementId]),
    pool.query<{ id: string; party_id: string; filename: string; content_type: string; note: string | null; stored_bytes: number | null; sha256: string | null; stored_key: string | null; scan_status: string; created_at: Date }>(`
      SELECT id, party_id, filename, content_type, note, stored_bytes, sha256, stored_key, scan_status, created_at
      FROM evidence WHERE agreement_id = $1 AND scan_status = 'CLEAN' ORDER BY created_at`, [agreementId]),
  ]);

  const names = new Map(parties.rows.map((party) => [party.id, party.display_name]));
  const role = (partyId: string): string => parties.rows.find((party) => party.id === partyId)?.role ?? "UNKNOWN";
  const current = versions.rows.find((version) => version.number === request.current_version_number);
  if (!current) throw new TerminalDossierError("NO_VERSION", "The agreement has no current version");

  add("agreement.json", json({
    id: agreementId,
    title: request.title,
    template: request.template_id,
    state: request.state,
    created_at: request.created_at.toISOString(),
    due_at: request.due_at?.toISOString() ?? null,
    current_version: request.current_version_number,
    terms: current.fields,
    content_sha256: current.content_sha256,
    parties: parties.rows.map((party) => ({
      role: party.role, name: party.display_name, has_theckards_account: party.has_account, added_at: party.created_at.toISOString(),
    })),
  }), "The agreement: its terms, state and the two parties.");

  add("versions.json", json(versions.rows.map((version) => ({
    number: version.number, title: version.title, terms: version.fields,
    content_sha256: version.content_sha256, document_sha256: version.document_sha256, created_at: version.created_at.toISOString(),
  }))), "Every version of the terms, in order, with the hash of each.");

  add("signatures.json", json({
    note: "Signing IP addresses and user agents are part of the signature record and are kept by Theckards. They are personal data and are not exported.",
    signatures: signatures.rows.map((signature) => ({
      role: signature.role, typed_name: signature.typed_name, signed_at: signature.signed_at.toISOString(),
      method: signature.method, signed_document_sha256: signature.document_sha256, content_sha256: signature.content_sha256,
      consent: { document: signature.esign_title, version: signature.esign_version },
    })),
  }), "Who signed what, when, how, and which consent they accepted.");

  add("record.json", json({
    confirmations: confirmations.rows.map((entry) => ({
      kind: entry.kind, label: CONFIRMATION_LABELS[entry.kind as ConfirmationKind] ?? entry.kind,
      declared_by: { role: role(entry.party_id), name: names.get(entry.party_id) ?? "A party" },
      note: entry.note, created_at: entry.created_at.toISOString(),
    })),
    messages: messages.rows.map((message) => ({
      from: { role: role(message.party_id), name: names.get(message.party_id) ?? "A party" },
      body: message.body, created_at: message.created_at.toISOString(),
    })),
    my_private_notes: notes.rows.map((note) => ({ body: note.body, created_at: note.created_at.toISOString() })),
    note: "Each confirmation is one party's own declaration. Theckards does not verify it, and silence is never a confirmation. Private notes are visible only to the party who wrote them, so this archive contains only the notes of whoever requested it.",
  }), "What each party declared, the messages they exchanged, and the requester's private notes.");

  if (caseRow.rows.length > 0) {
    const caseIds = caseRow.rows.map((row) => row.id);
    const [proposals, addenda] = await Promise.all([
      pool.query<{ case_id: string; party_id: string; body: string; created_at: Date }>(
        "SELECT case_id, party_id, body, created_at FROM proposals WHERE case_id = ANY($1::uuid[]) ORDER BY created_at", [caseIds]),
      pool.query<{ case_id: string; sections: AgreementSection[]; status: string; content_sha256: string; sealed_document_id: string | null; created_at: Date }>(
        "SELECT case_id, sections, status, content_sha256, sealed_document_id, created_at FROM addenda WHERE case_id = ANY($1::uuid[])", [caseIds]),
    ]);
    add("case.json", json({
      note: "Theckards does not decide who is right. A resolution exists only as an addendum both parties accepted and signed.",
      cases: caseRow.rows.map((row) => ({
        status: row.status,
        opened_by: { role: role(row.opened_by_party_id), name: names.get(row.opened_by_party_id) ?? "A party" },
        reason: row.reason,
        opened_at: row.opened_at.toISOString(),
        closed_at: row.closed_at?.toISOString() ?? null,
        evidence_window_ended_at: row.evidence_window_ends_at.toISOString(),
        proposals: proposals.rows.filter((proposal) => proposal.case_id === row.id).map((proposal) => ({
          from: { role: role(proposal.party_id), name: names.get(proposal.party_id) ?? "A party" },
          body: proposal.body, created_at: proposal.created_at.toISOString(),
        })),
        resolution: addenda.rows.filter((addendum) => addendum.case_id === row.id).map((addendum) => ({
          status: addendum.status, sections: addendum.sections, content_sha256: addendum.content_sha256,
          sealed_document_id: addendum.sealed_document_id, created_at: addendum.created_at.toISOString(),
        }))[0] ?? null,
      })),
    }), "Any case opened on this agreement, each side's proposals and the signed resolution.");
  }

  for (const document of sealed.rows) {
    const label = document.kind === "FINAL" ? "agreement" : "addendum";
    const path = `documents/${label}-${document.id}.pdf`;
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: document.s3_key }));
    const bytes = await object.Body!.transformToByteArray();
    const digest = sha256Hex(bytes);
    if (digest !== document.sha256) throw new TerminalDossierError("SEALED_HASH_MISMATCH", `Stored ${document.kind} does not match its seal`);
    add(path, bytes, document.kind === "FINAL" ? "The sealed agreement both parties signed." : "A sealed resolution addendum.");
    add(`documents/${label}-${document.id}.receipt.json`, json(document.receipt),
      "The integrity receipt for the file beside it, signed by a Theckards key.");
  }

  let used = 0;
  const index: unknown[] = [];
  for (const [position, item] of evidence.rows.entries()) {
    const name = archiveSafeName(item.filename, `evidence-${position + 1}`);
    const path = `evidence/${String(position + 1).padStart(3, "0")}-${name}`;
    const size = item.stored_bytes ?? 0;
    const included = size > 0 && used + size <= EVIDENCE_BUDGET_BYTES;
    if (included && item.stored_key) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.stored_key }));
      const bytes = await object.Body!.transformToByteArray();
      if (sha256Hex(bytes) !== item.sha256) throw new TerminalDossierError("EVIDENCE_HASH_MISMATCH", "Stored evidence does not match its recorded hash");
      used += bytes.byteLength;
      add(path, bytes, "A file one party attached as evidence.");
    }
    index.push({
      path: included ? path : null,
      included,
      excluded_reason: included ? null : "The archive includes evidence files up to a size budget; download this file from the record.",
      original_filename: item.filename,
      content_type: item.content_type,
      bytes: size,
      sha256: item.sha256,
      note: item.note,
      attached_by: { role: role(item.party_id), name: names.get(item.party_id) ?? "A party" },
      attached_at: item.created_at.toISOString(),
      malware_scan: "clean",
    });
  }
  if (evidence.rows.length > 0) {
    add("evidence/index.json", json({
      note: "Only files that passed the malware check are part of the record. Each entry's SHA-256 is the hash of the file as stored.",
      files: index,
    }), "What each evidence file is, who attached it and its hash.");
  }

  return { files, entries };
}

export async function buildDossier(payload: Record<string, unknown>): Promise<void> {
  const requestId = String(payload.requestId ?? "");
  const request = (await pool.query<RequestRow>(`
    SELECT r.id, r.agreement_id, r.party_id, r.status, a.title, a.state, a.template_id, a.created_at, a.due_at, a.current_version_number
    FROM dossier_requests r JOIN agreements a ON a.id = r.agreement_id WHERE r.id = $1
  `, [requestId])).rows[0];
  if (!request) throw new Error("Dossier request not found");
  if (request.status !== "PENDING") return;

  const sealId = sealIdFor(request.agreement_id, request.id, "DOSSIER");
  const prefix = `agreements/${request.agreement_id}/dossiers/${request.id}/theckards-dossier-${sealId}`;

  try {
    const { files, entries } = await collect(request);
    // The seal timestamp is the generation time, and it is written into the manifest and the README before
    // either is hashed, so one value appears in the archive, the manifest and the receipt.
    const generatedAt = new Date();
    const partial = dossierManifest({
      agreementId: request.agreement_id, sealId, generatedAt: generatedAt.toISOString(), baseUrl, files,
    });
    const readme = encoder.encode(dossierReadme({
      agreementTitle: request.title, agreementId: request.agreement_id, sealId,
      generatedAt: generatedAt.toISOString(), archiveName: `theckards-dossier-${sealId}`, baseUrl, manifest: partial,
    }));
    const manifest = dossierManifest({
      agreementId: request.agreement_id, sealId, generatedAt: generatedAt.toISOString(), baseUrl,
      files: [...files,
        { path: DOSSIER_README, sha256: sha256Hex(readme), bytes: readme.byteLength, describes: "How to verify this archive without trusting Theckards." },
      ],
    });
    // Written byte for byte as hashed, with no trailing newline, so `sha256sum manifest.json` reproduces the
    // receipt's content_sha256 exactly. The manifest cannot list its own hash, so the receipt carries it.
    const manifestJson = encoder.encode(manifestBytes(manifest));
    const contentSha256 = sha256Hex(manifestJson);

    // Fixed order: the two files a reader opens first, then the record, so the listing is predictable.
    const archive = zipStore([
      { path: DOSSIER_README, bytes: readme },
      { path: DOSSIER_MANIFEST, bytes: manifestJson },
      ...[...entries].sort((left, right) => (left.path < right.path ? -1 : 1)),
    ]);
    const archiveSha256 = sha256Hex(archive);

    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: `${prefix}.zip`, Body: archive, ContentType: "application/zip",
      Metadata: { sha256: archiveSha256, seal: sealId },
    }));
    const { receipt, signature, keyId } = await signReceipt(
      { id: sealId, kind: "DOSSIER", sha256: archiveSha256, content_sha256: contentSha256, sealed_at: generatedAt.toISOString() },
      process.env.SEAL_KEY_ARN!,
    );
    const stored = await transaction(async (client) => {
      await client.query(`
        INSERT INTO sealed_documents(id, agreement_id, version_id, kind, s3_key, sha256, content_sha256, kms_key_id, signature, receipt, watermarked, sealed_at)
        VALUES ($1, $2, NULL, 'DOSSIER', $3, $4, $5, $6, $7, $8::jsonb, false, $9) ON CONFLICT DO NOTHING
      `, [sealId, request.agreement_id, `${prefix}.zip`, archiveSha256, contentSha256, keyId, signature, JSON.stringify(receipt), generatedAt]);
      await client.query(`
        UPDATE dossier_requests SET status = 'READY', s3_key = $2, sha256 = $3, bytes = $4, sealed_document_id = $5, ready_at = now()
        WHERE id = $1 AND status = 'PENDING'
      `, [request.id, `${prefix}.zip`, archiveSha256, archive.byteLength, sealId]);
      return (await client.query<{ receipt: SealedReceipt }>("SELECT receipt FROM sealed_documents WHERE id = $1", [sealId])).rows[0]!.receipt;
    });
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: `${prefix}.receipt.json`, Body: JSON.stringify(stored, null, 2), ContentType: "application/json",
    }));
  } catch (error) {
    // Only a fault in the record itself is final. Anything else (S3, KMS, the database) is retried by SQS and
    // then parked in the dead-letter queue, where it is alarmed and can be replayed after a fix.
    if (error instanceof TerminalDossierError) {
      await pool.query("UPDATE dossier_requests SET status = 'FAILED', error_code = $2 WHERE id = $1 AND status = 'PENDING'", [request.id, error.code]);
      return;
    }
    throw error;
  }
}
