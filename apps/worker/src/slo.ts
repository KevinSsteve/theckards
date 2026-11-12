import { PutMetricDataCommand, type CloudWatchClient, type MetricDatum } from "@aws-sdk/client-cloudwatch";
import { createHash } from "node:crypto";
import type pg from "pg";
import type { QueueEnvelope } from "./queue-envelope.js";

export const PDF_PREVIEW_TARGET_MS = 10_000;
export const PDF_SLO_CUTOVER_DELAY_MINUTES = 15;
export const SLO_NAMESPACE = "Theckards/SLO";
export type Sli = "pdf-preview";
export type PdfWindow = "5m" | "1h" | "30m" | "6h" | "30d";

export interface SloObservation {
  sli: Sli;
  failure: 0 | 1;
  elapsedMs: number;
  observedAt: string;
  /** Eligibility time is checked against the persisted rollout cutover but is never stored. */
  eligibleAt: string;
}

export interface PdfSloSnapshot {
  rates: Record<PdfWindow, number | null>;
  eligible30d: number;
}

export type SloStore = Pick<pg.Pool, "query">;
type MetricsClient = Pick<CloudWatchClient, "send">;

function milliseconds(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("Invalid SLO timestamp");
  return result;
}

/** One eligible PDF preview: complete under ten seconds, or bad (late/terminal failure). */
export function pdfPreviewObservation(
  queuedAt: Date | string,
  finishedAt: Date | string,
  completed: boolean,
): SloObservation {
  const finishedMs = milliseconds(finishedAt);
  const eligibleMs = milliseconds(queuedAt);
  const elapsedMs = Math.max(0, Math.round(finishedMs - eligibleMs));
  return {
    sli: "pdf-preview",
    failure: completed && elapsedMs < PDF_PREVIEW_TARGET_MS ? 0 : 1,
    elapsedMs,
    observedAt: new Date(finishedMs).toISOString(),
    eligibleAt: new Date(eligibleMs).toISOString(),
  };
}

export function sloSourceHash(jobId: string, sli: Sli): string {
  return createHash("sha256").update(`theckards:slo-source:${sli}:${jobId}`).digest("hex");
}

/** A stable UUID that reveals neither its seed nor any record identifier. */
export function sloLedgerId(seed: string, purpose: string): string {
  const bytes = createHash("sha256").update(`theckards:${purpose}:${seed}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The exactly-unique database source of truth. No source job or record identifier is stored. */
export async function recordSloObservation(
  store: SloStore,
  jobId: string,
  observation: SloObservation,
): Promise<boolean> {
  const inserted = await store.query(
    `INSERT INTO slo_observations(source_hash, sli, failure, elapsed_ms, observed_at)
     SELECT $1, $2, $3, $4, $5
     FROM slo_cutovers WHERE sli = $2 AND $6::timestamptz >= eligible_after
     ON CONFLICT (source_hash) DO NOTHING`,
    [
      sloSourceHash(jobId, observation.sli), observation.sli, observation.failure,
      observation.elapsedMs, observation.observedAt, observation.eligibleAt,
    ],
  );
  return inserted.rowCount === 1;
}

/**
 * On the final source-queue receive, classify from persisted READY time when present; only an unfinished render is
 * bad. This prevents a telemetry failure after a good PDF from being rewritten as a render failure.
 */
export async function recordTerminalPdfResult(
  store: SloStore,
  envelope: QueueEnvelope,
  receiveCount: number,
  failedAt: Date | string,
): Promise<boolean> {
  if (envelope.topic !== "pdf.render" || !envelope.queuedAt || receiveCount < 5) return false;
  const versionId = String(envelope.payload.versionId ?? "");
  const ready = /^[0-9a-f-]{36}$/i.test(versionId)
    ? await store.query<{ rendered_at: Date | null }>(
      "SELECT rendered_at FROM agreement_versions WHERE id = $1 AND render_status = 'READY'",
      [versionId],
    )
    : { rows: [], rowCount: 0 };
  if (ready.rowCount === 1 && !ready.rows[0]?.rendered_at) return false;
  const observation = ready.rows[0]?.rendered_at
    ? pdfPreviewObservation(envelope.queuedAt, ready.rows[0].rendered_at, true)
    : pdfPreviewObservation(envelope.queuedAt, failedAt, false);
  return recordSloObservation(store, envelope.id, observation);
}

export async function ensurePdfSloCutover(store: SloStore): Promise<void> {
  await store.query(`
    INSERT INTO slo_cutovers(sli, eligible_after)
    VALUES ('pdf-preview', clock_timestamp() + interval '${PDF_SLO_CUTOVER_DELAY_MINUTES} minutes')
    ON CONFLICT (sli) DO NOTHING
  `);
}

export async function reconcileLatePdfPreviews(store: SloStore, at: Date): Promise<number> {
  const result = await store.query(`
    INSERT INTO slo_observations(source_hash, sli, failure, elapsed_ms, observed_at)
    SELECT
      encode(digest('theckards:slo-source:pdf-preview:' || o.id::text, 'sha256'), 'hex'),
      'pdf-preview',
      CASE WHEN v.rendered_at IS NOT NULL AND v.rendered_at < o.created_at + interval '10 seconds' THEN 0 ELSE 1 END,
      CASE WHEN v.rendered_at IS NOT NULL
        THEN GREATEST(0, round(extract(epoch FROM (v.rendered_at - o.created_at)) * 1000)::integer)
        ELSE 10000
      END,
      COALESCE(v.rendered_at, o.created_at + interval '10 seconds')
    FROM outbox o
    JOIN slo_cutovers c ON c.sli = 'pdf-preview' AND o.created_at >= c.eligible_after
    LEFT JOIN agreement_versions v ON v.id::text = o.payload->>'versionId'
    WHERE o.topic = 'pdf.render'
      AND o.created_at <= $1::timestamptz - interval '15 seconds'
    ON CONFLICT (source_hash) DO NOTHING
  `, [at]);
  return result.rowCount ?? 0;
}

export interface PdfSnapshotRow {
  eligible_5m: string; bad_5m: string;
  eligible_1h: string; bad_1h: string;
  eligible_30m: string; bad_30m: string;
  eligible_6h: string; bad_6h: string;
  eligible_30d: string; bad_30d: string;
}

const SNAPSHOT_SQL = `
  SELECT
    count(*) FILTER (WHERE observed_at > $1::timestamptz - interval '5 minutes')::text AS eligible_5m,
    count(*) FILTER (WHERE failure = 1 AND observed_at > $1::timestamptz - interval '5 minutes')::text AS bad_5m,
    count(*) FILTER (WHERE observed_at > $1::timestamptz - interval '1 hour')::text AS eligible_1h,
    count(*) FILTER (WHERE failure = 1 AND observed_at > $1::timestamptz - interval '1 hour')::text AS bad_1h,
    count(*) FILTER (WHERE observed_at > $1::timestamptz - interval '30 minutes')::text AS eligible_30m,
    count(*) FILTER (WHERE failure = 1 AND observed_at > $1::timestamptz - interval '30 minutes')::text AS bad_30m,
    count(*) FILTER (WHERE observed_at > $1::timestamptz - interval '6 hours')::text AS eligible_6h,
    count(*) FILTER (WHERE failure = 1 AND observed_at > $1::timestamptz - interval '6 hours')::text AS bad_6h,
    count(*) FILTER (WHERE observed_at > $1::timestamptz - interval '30 days')::text AS eligible_30d,
    count(*) FILTER (WHERE failure = 1 AND observed_at > $1::timestamptz - interval '30 days')::text AS bad_30d
  FROM slo_observations
  WHERE sli = 'pdf-preview' AND observed_at <= $1::timestamptz
`;

const number = (value: string) => Number(value);
const rate = (bad: string, eligible: string): number | null => number(eligible) > 0 ? number(bad) / number(eligible) : null;

export function pdfSnapshot(row: PdfSnapshotRow): PdfSloSnapshot {
  return {
    rates: {
      "5m": rate(row.bad_5m, row.eligible_5m),
      "1h": rate(row.bad_1h, row.eligible_1h),
      "30m": rate(row.bad_30m, row.eligible_30m),
      "6h": rate(row.bad_6h, row.eligible_6h),
      "30d": rate(row.bad_30d, row.eligible_30d),
    },
    eligible30d: number(row.eligible_30d),
  };
}

/** Gauges computed from the database source; repeated publication cannot add good or bad events. */
export function sloMetricData(snapshot: PdfSloSnapshot, at: Date): MetricDatum[] {
  const timestamp = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  const data: MetricDatum[] = [
    { MetricName: "PublisherHeartbeat", Value: 1, Timestamp: timestamp, StorageResolution: 60 },
    { MetricName: "PdfPreviewEligible30d", Value: snapshot.eligible30d, Timestamp: timestamp, StorageResolution: 60 },
  ];
  for (const [window, value] of Object.entries(snapshot.rates) as [PdfWindow, number | null][]) {
    // -1 is outside the 0..1 failure domain and means this window has no eligible preview. Publishing it every
    // minute prevents dashboards from retaining an older non-empty value; alarm thresholds remain fail-closed.
    data.push({
      MetricName: "PdfPreviewFailureRate", Value: value ?? -1, Timestamp: timestamp, StorageResolution: 60,
      Dimensions: [{ Name: "Window", Value: window }],
    });
  }
  return data;
}

/** Returns the next UTC minute plus a small offset, without accumulating work duration as drift. */
export function nextSloPublicationAt(nowMs: number, offsetMs = 5_000): number {
  return (Math.floor((nowMs - offsetMs) / 60_000) + 1) * 60_000 + offsetMs;
}

export interface PublishSloResult { published: boolean; snapshot?: PdfSloSnapshot }

/** One worker claims each UTC minute, reconciles late jobs, then calculates and publishes one immutable snapshot. */
export async function publishSloMetrics(
  store: SloStore,
  metrics: MetricsClient,
  at = new Date(),
): Promise<PublishSloResult> {
  const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  const publicationId = sloLedgerId(minute.toISOString(), "slo-publish");
  const claimed = await store.query(
    "INSERT INTO processed_jobs(job_id, topic) VALUES ($1, 'slo.publish') ON CONFLICT (job_id) DO NOTHING RETURNING job_id",
    [publicationId],
  );
  if (claimed.rowCount !== 1) return { published: false };

  // The first new worker fixes a future eligibility boundary, beyond the rolling deployment overlap. Both direct
  // writes and reconciliation use it, so old workers can never create false historical failures.
  await ensurePdfSloCutover(store);
  // Outbox is the durable list of every eligible job. This catches >10s jobs even if a worker was killed, OOMed,
  // never received the message, or let SQS move it to the DLQ without executing a catch block.
  await reconcileLatePdfPreviews(store, minute);
  const result = await store.query<PdfSnapshotRow>(SNAPSHOT_SQL, [minute]);
  const snapshot = pdfSnapshot(result.rows[0]!);
  // The claim is deliberately retained if this throws. One missing minute is explicit in PublisherHeartbeat;
  // retrying an uncertain PutMetricData response could mix two snapshots at one timestamp and hide burn.
  await metrics.send(new PutMetricDataCommand({ Namespace: SLO_NAMESPACE, MetricData: sloMetricData(snapshot, minute) }));
  return { published: true, snapshot };
}
