import { createHash } from "node:crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { TemplateId } from "@theckards/domain";
import type pg from "pg";
import { renderAgreementPdf } from "./pdf.js";
import type { QueueEnvelope } from "./queue-envelope.js";
import { pdfPreviewObservation, recordSloObservation, type SloObservation, type SloStore } from "./slo.js";

type PdfStore = Pick<pg.Pool, "query">;
type ObjectStore = Pick<S3Client, "send">;
type Render = typeof renderAgreementPdf;
type Observe = (store: SloStore, jobId: string, observation: SloObservation) => Promise<boolean>;

export interface PdfPreviewDependencies {
  pool: PdfStore;
  s3: ObjectStore;
  bucket: string;
  render?: Render;
  observe?: Observe;
}

interface PreviewVersion {
  title: string;
  template_id: TemplateId;
  number: number;
  fields: Record<string, unknown>;
  created_at: Date;
  render_status: string;
  rendered_at: Date | null;
}

async function observeReady(
  envelope: QueueEnvelope,
  renderedAt: Date,
  pool: PdfStore,
  observe: Observe,
): Promise<void> {
  // Old envelopes can still be in SQS while the new worker rolls out. They have no trustworthy start time and are
  // deliberately no-data, not an invented success or failure.
  if (!envelope.queuedAt) return;
  await observe(pool, envelope.id, pdfPreviewObservation(envelope.queuedAt, renderedAt, true));
}

/** Render -> store -> mark READY -> observe, with the database's first completion time kept across duplicate work. */
export async function renderPdfPreview(envelope: QueueEnvelope, dependencies: PdfPreviewDependencies): Promise<void> {
  const { pool, s3, bucket } = dependencies;
  const render = dependencies.render ?? renderAgreementPdf;
  const observe = dependencies.observe ?? recordSloObservation;
  const agreementId = String(envelope.payload.agreementId ?? "");
  const versionId = String(envelope.payload.versionId ?? "");
  const result = await pool.query<PreviewVersion>(`
    SELECT v.title, a.template_id, v.number, v.fields, v.created_at, v.render_status, v.rendered_at
    FROM agreement_versions v JOIN agreements a ON a.id = v.agreement_id
    WHERE v.id = $1 AND a.id = $2
  `, [versionId, agreementId]);
  const version = result.rows[0];
  if (!version) throw new Error("Agreement version not found");

  // A crash after READY but before the job ledger insert retries only the observation. The separate SLO ledger key
  // makes that retry idempotent, and ready bytes are never regenerated.
  if (version.render_status === "READY") {
    if (version.rendered_at) await observeReady(envelope, version.rendered_at, pool, observe);
    return;
  }

  const bytes = await render({
    agreementId, version: version.number, title: version.title, templateId: version.template_id,
    fields: version.fields, createdAt: version.created_at,
  });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const key = `agreements/${agreementId}/v${version.number}/preview.pdf`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: bytes, ContentType: "application/pdf",
    Metadata: { sha256: digest, agreement: agreementId, version: String(version.number) },
  }));
  const completed = await pool.query<{ rendered_at: Date }>(`
    UPDATE agreement_versions SET render_status = 'READY', document_s3_key = $2,
      document_sha256 = $3, render_error_code = NULL,
      rendered_at = COALESCE(rendered_at, clock_timestamp()) WHERE id = $1
    RETURNING rendered_at
  `, [versionId, key, digest]);
  const renderedAt = completed.rows[0]?.rendered_at;
  if (!renderedAt) throw new Error("Preview completion timestamp missing");
  await observeReady(envelope, renderedAt, pool, observe);
}
