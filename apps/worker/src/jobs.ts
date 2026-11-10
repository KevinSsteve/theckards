import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { SealedReceipt, TemplateId } from "@theckards/domain";
import type pg from "pg";
import { decryptText } from "./crypto.js";
import { pool, transaction } from "./db.js";
import { buildMime } from "./mime.js";
import { renderAgreementPdf, type FinalSigner } from "./pdf.js";
import { sealIdFor, sha256Hex, signReceipt } from "./seal.js";

const sqs = new SQSClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});
const queueUrl = process.env.JOBS_QUEUE_URL!;
const bucket = process.env.DOCUMENTS_BUCKET!;
const baseUrl = process.env.APP_BASE_URL!;
const FROM = "Theckards <no-reply@theckards.linkealls.com>";
const FROM_ADDRESS = "no-reply@theckards.linkealls.com";

type Recipient = { kind: "user"; userId: string } | { kind: "party"; partyId: string };

async function recipientEmail(recipient: Recipient): Promise<string> {
  if (recipient.kind === "user") {
    const result = await pool.query<{ email_ciphertext: Uint8Array }>("SELECT email_ciphertext FROM users WHERE id = $1 AND state = 'ACTIVE'", [recipient.userId]);
    const row = result.rows[0];
    if (!row) throw new Error("Email recipient not found");
    return decryptText(row.email_ciphertext, "user-email");
  }
  const result = await pool.query<{ email_ciphertext: Uint8Array | null }>("SELECT email_ciphertext FROM parties WHERE id = $1", [recipient.partyId]);
  const row = result.rows[0];
  if (!row?.email_ciphertext) throw new Error("Email recipient not found");
  return decryptText(row.email_ciphertext, "guest-email");
}

async function sendText(to: string, subject: string, text: string): Promise<void> {
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_ADDRESS,
    Destination: { ToAddresses: [to] },
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
    Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" } } } },
  }));
}

async function sendOtp(payload: Record<string, unknown>): Promise<void> {
  const recipient = payload.recipient as Recipient;
  const [email, code] = await Promise.all([recipientEmail(recipient), decryptText(String(payload.codeCiphertext ?? ""), "otp-code")]);
  const minutes = Number(payload.validityMinutes ?? 10);
  await sendText(email, `Your Theckards verification code: ${code}`,
    `Your verification code is ${code}.\n\nIt expires in ${minutes} minutes. If you did not request it, ignore this email.\n\nTheckards will never ask you for this code by phone or chat.`);
}

/** Email is off while signing is in person only (feature flag EMAIL_DELIVERY_ENABLED, Admin dashboard). */
async function emailDeliveryEnabled(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ enabled: string | null }>("SELECT value->>'EMAIL_DELIVERY_ENABLED' AS enabled FROM app_settings WHERE key = 'feature_flags'");
  return result.rows[0]?.enabled === "true";
}

async function sealFinal(payload: Record<string, unknown>): Promise<void> {
  const agreementId = String(payload.agreementId ?? "");
  const versionId = String(payload.versionId ?? "");
  const result = await pool.query<{
    state: string; creator_id: string; template_id: TemplateId; number: number; title: string; fields: Record<string, unknown>;
    created_at: Date; content_sha256: string; document_sha256: string;
  }>(`
    SELECT a.state, a.creator_id, a.template_id, v.number, v.title, v.fields, v.created_at, v.content_sha256, v.document_sha256
    FROM agreements a JOIN agreement_versions v ON v.agreement_id = a.id
    WHERE a.id = $1 AND v.id = $2
  `, [agreementId, versionId]);
  const agreement = result.rows[0];
  if (!agreement) throw new Error("Agreement version not found");
  if (!["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"].includes(agreement.state)) throw new Error("Agreement is not executed");

  const signatures = await pool.query<{ role: string; party_id: string; typed_name: string; signed_at: Date; document_sha256: string; method: FinalSigner["method"]; has_email: boolean }>(`
    SELECT p.role, p.id AS party_id, s.typed_name, s.signed_at, s.document_sha256, s.verification_method AS method,
      (p.email_hash IS NOT NULL OR p.user_id IS NOT NULL) AS has_email
    FROM signatures s JOIN parties p ON p.id = s.party_id WHERE s.version_id = $1 ORDER BY p.role DESC
  `, [versionId]);
  const roles = new Set(signatures.rows.map((row) => row.role));
  if (!roles.has("CREATOR") || !roles.has("COUNTERPARTY")) throw new Error("Both signatures are required before sealing");
  if (!signatures.rows.every((row) => row.document_sha256 === agreement.document_sha256)) throw new Error("Signatures do not match the document hash");

  const sealId = sealIdFor(agreementId, versionId, "FINAL");
  const sealedAt = new Date(Math.max(...signatures.rows.map((row) => row.signed_at.getTime())));
  const signers: FinalSigner[] = signatures.rows.map((row) => ({
    role: row.role === "CREATOR" ? "Creator" : "Counterparty", typedName: row.typed_name, signedAt: row.signed_at, method: row.method,
  }));
  const bytes = await renderAgreementPdf(
    { agreementId, version: agreement.number, title: agreement.title, templateId: agreement.template_id, fields: agreement.fields, createdAt: agreement.created_at },
    { sealId, sealedAt, contentSha256: agreement.content_sha256, signedDocumentSha256: agreement.document_sha256, signers,
      verifyUrl: `${baseUrl}/verify?seal=${sealId}`, watermark: true },
  );
  const fileSha256 = sha256Hex(bytes);
  const prefix = `agreements/${agreementId}/v${agreement.number}/final-${sealId}`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}.pdf`, Body: bytes, ContentType: "application/pdf", Metadata: { sha256: fileSha256, seal: sealId } }));

  const { receipt, signature, keyId } = await signReceipt(
    { id: sealId, kind: "FINAL", sha256: fileSha256, content_sha256: agreement.content_sha256, sealed_at: sealedAt.toISOString() },
    process.env.SEAL_KEY_ARN!,
  );
  const counterparty = signatures.rows.find((row) => row.role === "COUNTERPARTY")!;
  const stored = await transaction(async (client) => {
    const inserted = await client.query(`
      INSERT INTO sealed_documents(id, agreement_id, version_id, kind, s3_key, sha256, content_sha256, kms_key_id, signature, receipt, watermarked, sealed_at)
      VALUES ($1, $2, $3, 'FINAL', $4, $5, $6, $7, $8, $9::jsonb, true, $10)
      ON CONFLICT DO NOTHING RETURNING id
    `, [sealId, agreementId, versionId, `${prefix}.pdf`, fileSha256, agreement.content_sha256, keyId, signature, JSON.stringify(receipt), sealedAt]);
    if (inserted.rowCount === 1 && await emailDeliveryEnabled(client)) {
      const recipients = [{ kind: "user", userId: agreement.creator_id }, ...(counterparty.has_email ? [{ kind: "party", partyId: counterparty.party_id }] : [])];
      for (const recipient of recipients) {
        await client.query("INSERT INTO outbox(topic, payload) VALUES ('email.receipt', $1::jsonb)", [JSON.stringify({ sealId, recipient })]);
      }
    }
    const row = await client.query<{ receipt: SealedReceipt }>("SELECT receipt FROM sealed_documents WHERE id = $1", [sealId]);
    return row.rows[0]!.receipt;
  });
  // The receipt object always mirrors the stored row (KMS ECDSA signatures are not deterministic).
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}.receipt.json`, Body: JSON.stringify(stored, null, 2), ContentType: "application/json" }));
}

async function sendReceipt(payload: Record<string, unknown>): Promise<void> {
  const sealId = String(payload.sealId ?? "");
  const result = await pool.query<{ s3_key: string; receipt: SealedReceipt; title: string }>(`
    SELECT d.s3_key, d.receipt, a.title FROM sealed_documents d JOIN agreements a ON a.id = d.agreement_id WHERE d.id = $1
  `, [sealId]);
  const sealed = result.rows[0];
  if (!sealed) throw new Error("Sealed document not found");
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sealed.s3_key }));
  const pdf = await object.Body!.transformToByteArray();
  const to = await recipientEmail(payload.recipient as Recipient);
  const raw = buildMime({
    from: FROM, to, subject: `Sealed record: ${sealed.title}`,
    text: `Both parties signed "${sealed.title}".\n\nAttached: the sealed PDF and its integrity receipt (seal ID ${sealId}, SHA-256 ${sealed.receipt.sha256}).\n\nVerify the record at ${baseUrl}/verify. Public keys: ${baseUrl}/.well-known/theckards-keys.json\n\nTheckards provides a verifiable record. It does not provide legal advice, certify identity or handle payments between parties.`,
    attachments: [
      { filename: `theckards-${sealId}.pdf`, contentType: "application/pdf", content: pdf },
      { filename: `theckards-${sealId}.receipt.json`, contentType: "application/json", content: Buffer.from(JSON.stringify(sealed.receipt, null, 2)) },
    ],
  });
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_ADDRESS, Destination: { ToAddresses: [to] },
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET, Content: { Raw: { Data: raw } },
  }));
}

async function notifyRevision(payload: Record<string, unknown>): Promise<void> {
  const result = await pool.query<{ creator_id: string; title: string; name: string | null }>(`
    SELECT a.creator_id, a.title, p.display_name AS name FROM agreements a
    LEFT JOIN parties p ON p.agreement_id = a.id AND p.role = 'COUNTERPARTY' WHERE a.id = $1
  `, [String(payload.agreementId ?? "")]);
  const row = result.rows[0];
  if (!row) throw new Error("Agreement not found");
  const to = await recipientEmail({ kind: "user", userId: row.creator_id });
  await sendText(to, `Changes requested: ${row.title}`,
    `${row.name ?? "The counterparty"} asked for changes to "${row.title}". Open Theckards to edit the terms and send a new invitation:\n${baseUrl}/dashboard`);
}

export interface QueueEnvelope {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
}

export async function publishOutbox(): Promise<number> {
  if (!queueUrl) return 0;
  return transaction(async (client) => {
    const rows = await client.query<{ id: string; topic: string; payload: Record<string, unknown> }>(`
      SELECT id, topic, payload FROM outbox
      WHERE published_at IS NULL ORDER BY created_at LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);
    for (const row of rows.rows) {
      await sqs.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ id: row.id, topic: row.topic, payload: row.payload }),
      }));
      await client.query("UPDATE outbox SET published_at = now() WHERE id = $1", [row.id]);
    }
    return rows.rowCount ?? 0;
  });
}

async function renderPreview(payload: Record<string, unknown>): Promise<void> {
  const agreementId = String(payload.agreementId ?? "");
  const versionId = String(payload.versionId ?? "");
  const result = await pool.query<{
    title: string; template_id: TemplateId; number: number; fields: Record<string, unknown>; created_at: Date; render_status: string;
  }>(`
    SELECT v.title, a.template_id, v.number, v.fields, v.created_at, v.render_status
    FROM agreement_versions v JOIN agreements a ON a.id = v.agreement_id
    WHERE v.id = $1 AND a.id = $2
  `, [versionId, agreementId]);
  const version = result.rows[0];
  if (!version) throw new Error("Agreement version not found");
  if (version.render_status === "READY") return;
  const bytes = await renderAgreementPdf({ agreementId, version: version.number, title: version.title, templateId: version.template_id, fields: version.fields, createdAt: version.created_at });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const key = `agreements/${agreementId}/v${version.number}/preview.pdf`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/pdf", Metadata: { sha256: digest, agreement: agreementId, version: String(version.number) } }));
  await pool.query(`
    UPDATE agreement_versions SET render_status = 'READY', document_s3_key = $2,
      document_sha256 = $3, render_error_code = NULL WHERE id = $1
  `, [versionId, key, digest]);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function sendInvite(payload: Record<string, unknown>): Promise<void> {
  const agreementId = String(payload.agreementId ?? "");
  const partyId = String(payload.partyId ?? "");
  const tokenCiphertext = String(payload.tokenCiphertext ?? "");
  const result = await pool.query<{ title: string; email_ciphertext: Uint8Array; display_name: string; invite_expires_at: Date }>(`
    SELECT a.title, p.email_ciphertext, p.display_name, p.invite_expires_at FROM parties p
    JOIN agreements a ON a.id = p.agreement_id
    WHERE p.id = $1 AND a.id = $2 AND p.role = 'COUNTERPARTY'
  `, [partyId, agreementId]);
  const party = result.rows[0];
  if (!party?.email_ciphertext) throw new Error("Invite recipient not found");
  const [email, token] = await Promise.all([
    decryptText(party.email_ciphertext, "guest-email"), decryptText(tokenCiphertext, "invite-token"),
  ]);
  const link = `${baseUrl}/g/${encodeURIComponent(token)}`;
  const expiry = party.invite_expires_at.toISOString();
  await ses.send(new SendEmailCommand({
    FromEmailAddress: "no-reply@theckards.linkealls.com",
    Destination: { ToAddresses: [email] },
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
    Content: { Simple: {
      Subject: { Data: `Review and sign: ${party.title}`, Charset: "UTF-8" },
      Body: {
        Text: { Data: `${party.display_name},\n\nYou have been invited to review an agreement on Theckards. Open this private link before ${expiry}:\n${link}\n\nTheckards provides a verifiable record. It does not provide legal advice or handle payments between parties.`, Charset: "UTF-8" },
        Html: { Data: `<p>${escapeHtml(party.display_name)},</p><p>You have been invited to review an agreement on Theckards.</p><p><a href="${escapeHtml(link)}">Review agreement</a></p><p>The private link expires at ${escapeHtml(expiry)}.</p><p><small>Theckards provides a verifiable record. It does not provide legal advice or handle payments between parties.</small></p>`, Charset: "UTF-8" },
      },
    } },
  }));
}

async function alreadyProcessed(id: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM processed_jobs WHERE job_id = $1", [id]);
  return result.rowCount === 1;
}

export async function processEnvelope(envelope: QueueEnvelope): Promise<void> {
  if (await alreadyProcessed(envelope.id)) return;
  switch (envelope.topic) {
    case "pdf.render": await renderPreview(envelope.payload); break;
    case "email.invite": await sendInvite(envelope.payload); break;
    case "email.otp": await sendOtp(envelope.payload); break;
    case "seal.final": await sealFinal(envelope.payload); break;
    case "email.receipt": await sendReceipt(envelope.payload); break;
    case "email.revision_requested": await notifyRevision(envelope.payload); break;
    default: throw new Error("Unsupported job topic");
  }
  await pool.query("INSERT INTO processed_jobs(job_id, topic) VALUES ($1, $2) ON CONFLICT (job_id) DO NOTHING", [envelope.id, envelope.topic]);
}

export async function receiveAndProcess(): Promise<number> {
  if (!queueUrl) return 0;
  const output = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 120 }));
  for (const message of output.Messages ?? []) {
    // One failing job must not block the rest of the batch; SQS redelivers it and moves it to the DLQ after 5 attempts.
    try {
      const envelope = JSON.parse(message.Body ?? "{}") as QueueEnvelope;
      if (!envelope.id || !envelope.topic || !envelope.payload) throw new Error("Invalid queue envelope");
      await processEnvelope(envelope);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]").slice(0, 200) : "unknown";
      console.error(JSON.stringify({ level: "error", msg: "job failed", messageId: message.MessageId, error: error instanceof Error ? error.name : "unknown", detail }));
    }
  }
  return output.Messages?.length ?? 0;
}
