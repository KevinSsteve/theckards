import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { TemplateId } from "@theckards/domain";
import { decryptText } from "./crypto.js";
import { pool, transaction } from "./db.js";
import { renderAgreementPdf } from "./pdf.js";

const sqs = new SQSClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});
const queueUrl = process.env.JOBS_QUEUE_URL!;
const bucket = process.env.DOCUMENTS_BUCKET!;
const baseUrl = process.env.APP_BASE_URL!;

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
    default: throw new Error("Unsupported job topic");
  }
  await pool.query("INSERT INTO processed_jobs(job_id, topic) VALUES ($1, $2) ON CONFLICT (job_id) DO NOTHING", [envelope.id, envelope.topic]);
}

export async function receiveAndProcess(): Promise<number> {
  if (!queueUrl) return 0;
  const output = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 120 }));
  for (const message of output.Messages ?? []) {
    const envelope = JSON.parse(message.Body ?? "{}") as QueueEnvelope;
    if (!envelope.id || !envelope.topic || !envelope.payload) throw new Error("Invalid queue envelope");
    await processEnvelope(envelope);
    await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
  }
  return output.Messages?.length ?? 0;
}
