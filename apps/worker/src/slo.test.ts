import { PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { describe, expect, it, vi } from "vitest";
import {
  PDF_PREVIEW_TARGET_MS, PDF_SLO_CUTOVER_DELAY_MINUTES, SLO_NAMESPACE, ensurePdfSloCutover,
  nextSloPublicationAt, pdfPreviewObservation, pdfSnapshot,
  publishSloMetrics, reconcileLatePdfPreviews, recordSloObservation, recordTerminalPdfResult, sloLedgerId,
  sloMetricData, sloSourceHash, type PdfSnapshotRow,
} from "./slo.js";

const queued = new Date("2026-11-11T12:00:00.000Z");
const after = (ms: number) => new Date(queued.getTime() + ms);
const emptyRow = (overrides: Partial<PdfSnapshotRow> = {}): PdfSnapshotRow => ({
  eligible_5m: "0", bad_5m: "0", eligible_1h: "0", bad_1h: "0",
  eligible_30m: "0", bad_30m: "0", eligible_6h: "0", bad_6h: "0",
  eligible_30d: "0", bad_30d: "0", ...overrides,
});

describe("the PDF preview SLI", () => {
  it("uses the strict under-ten-second boundary from R-OPS-2", () => {
    expect(pdfPreviewObservation(queued, after(PDF_PREVIEW_TARGET_MS - 1), true)).toMatchObject({ failure: 0, elapsedMs: 9_999 });
    expect(pdfPreviewObservation(queued, after(PDF_PREVIEW_TARGET_MS), true)).toMatchObject({ failure: 1, elapsedMs: 10_000 });
  });

  it("counts a terminal render failure as bad even when it fails quickly", () => {
    expect(pdfPreviewObservation(queued, after(20), false)).toEqual({
      sli: "pdf-preview", failure: 1, elapsedMs: 20, observedAt: "2026-11-11T12:00:00.020Z",
      eligibleAt: "2026-11-11T12:00:00.000Z",
    });
  });

  it("refuses an invented timestamp", () => {
    expect(() => pdfPreviewObservation("not-a-time", after(1), true)).toThrow("Invalid SLO timestamp");
  });
});

describe("exactly-unique source observations", () => {
  it("derives a stable UUID that does not expose the source job", () => {
    const one = sloLedgerId("00000000-0000-4000-8000-000000000001", "pdf-preview");
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(one).toBe(sloLedgerId("00000000-0000-4000-8000-000000000001", "pdf-preview"));
    expect(one).not.toBe("00000000-0000-4000-8000-000000000001");
  });

  it("stores only aggregate fields and lets the unique source hash deduplicate retries", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const observation = pdfPreviewObservation(queued, after(1_234), true);
    await expect(recordSloObservation({ query } as never, jobId, observation)).resolves.toBe(true);
    await expect(recordSloObservation({ query } as never, jobId, observation)).resolves.toBe(false);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO slo_observations");
    expect(sql).toContain("FROM slo_cutovers");
    expect(sql).toContain("$6::timestamptz >= eligible_after");
    expect(values[0]).toBe(sloSourceHash(jobId, "pdf-preview"));
    expect(values[0]).not.toBe(jobId);
    expect(values.slice(1)).toEqual(["pdf-preview", 0, 1_234, "2026-11-11T12:00:01.234Z", "2026-11-11T12:00:00.000Z"]);
    expect(JSON.stringify(values)).not.toMatch(/agreement|messageId|request|party|user|email/i);
  });
});

describe("terminal queue result", () => {
  const versionId = "00000000-0000-4000-8000-000000000002";
  const envelope = {
    id: "00000000-0000-4000-8000-000000000001",
    topic: "pdf.render",
    payload: { versionId },
    queuedAt: queued.toISOString(),
  };

  it("does not observe retries one through four", async () => {
    const query = vi.fn();
    await expect(recordTerminalPdfResult({ query } as never, envelope, 4, after(500))).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("records an unfinished fifth receive as bad and deduplicates another delivery", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(recordTerminalPdfResult({ query } as never, envelope, 5, after(500))).resolves.toBe(true);
    await expect(recordTerminalPdfResult({ query } as never, envelope, 6, after(700))).resolves.toBe(false);
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO slo_observations"))!;
    expect(insert[1].slice(1)).toEqual(["pdf-preview", 1, 500, "2026-11-11T12:00:00.500Z", "2026-11-11T12:00:00.000Z"]);
  });

  it("uses persisted READY time when only telemetry failed on the fifth receive", async () => {
    const readyAt = after(9_000);
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ rendered_at: readyAt }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(recordTerminalPdfResult({ query } as never, envelope, 5, after(600_000))).resolves.toBe(true);
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO slo_observations"))!;
    expect(insert[1].slice(1)).toEqual(["pdf-preview", 0, 9_000, "2026-11-11T12:00:09.000Z", "2026-11-11T12:00:00.000Z"]);
  });
});

describe("late-job reconciliation", () => {
  it("persists one future cutover so mixed old/new workers are excluded", async () => {
    const query = vi.fn(async (sql: string) => { void sql; return { rows: [], rowCount: 1 }; });
    await ensurePdfSloCutover({ query } as never);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("INSERT INTO slo_cutovers");
    expect(sql).toContain(`interval '${PDF_SLO_CUTOVER_DELAY_MINUTES} minutes'`);
    expect(sql).toContain("ON CONFLICT (sli) DO NOTHING");
  });

  it("derives the same source hash in SQL and classifies every overdue outbox job after a commit grace", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void sql;
      void values;
      return { rows: [], rowCount: 2 };
    });
    await expect(reconcileLatePdfPreviews({ query } as never, after(60_000))).resolves.toBe(2);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("JOIN slo_cutovers c");
    expect(sql).toContain("o.created_at >= c.eligible_after");
    expect(sql).toContain("FROM outbox o");
    expect(sql).toContain("o.topic = 'pdf.render'");
    expect(sql).toContain("interval '15 seconds'");
    expect(sql).toContain("v.rendered_at < o.created_at + interval '10 seconds'");
    expect(sql).toContain("ON CONFLICT (source_hash) DO NOTHING");
    expect(sql).toContain("theckards:slo-source:pdf-preview:");
    expect(values).toEqual([after(60_000)]);
  });

  it("aligns every attempt to UTC minute plus five seconds without accumulating work duration", () => {
    expect(new Date(nextSloPublicationAt(Date.parse("2026-11-11T12:00:04.000Z"))).toISOString()).toBe("2026-11-11T12:00:05.000Z");
    expect(new Date(nextSloPublicationAt(Date.parse("2026-11-11T12:00:05.000Z"))).toISOString()).toBe("2026-11-11T12:01:05.000Z");
    expect(new Date(nextSloPublicationAt(Date.parse("2026-11-11T12:00:58.000Z"))).toISOString()).toBe("2026-11-11T12:01:05.000Z");
  });
});

describe("database-derived metric gauges", () => {
  it("calculates every failure rate and preserves no-data windows", () => {
    expect(pdfSnapshot(emptyRow({
      eligible_5m: "2", bad_5m: "1", eligible_1h: "4", bad_1h: "1",
      eligible_30d: "10", bad_30d: "2",
    }))).toEqual({
      rates: { "5m": 0.5, "1h": 0.25, "30m": null, "6h": null, "30d": 0.2 },
      eligible30d: 10,
    });
  });

  it("publishes a current sentinel for empty windows, with closed dimensions", () => {
    const data = sloMetricData({
      rates: { "5m": 0.5, "1h": null, "30m": null, "6h": null, "30d": 0.2 }, eligible30d: 10,
    }, new Date("2026-11-11T12:00:42.123Z"));
    expect(data).toHaveLength(7);
    expect(data[0]).toMatchObject({ MetricName: "PublisherHeartbeat", Value: 1, Timestamp: new Date("2026-11-11T12:00:00.000Z") });
    expect(data[1]).toMatchObject({ MetricName: "PdfPreviewEligible30d", Value: 10 });
    expect(data.slice(2).map((item) => item.Dimensions?.[0]?.Value)).toEqual(["5m", "1h", "30m", "6h", "30d"]);
    expect(data.slice(2).map((item) => item.Value)).toEqual([0.5, -1, -1, -1, 0.2]);
    expect(JSON.stringify(data)).not.toMatch(/agreement|job|message|request|party|user|email/i);
  });

  it("allows only one worker to publish a minute and sends all gauges in one request", async () => {
    let claimed = false;
    const row = emptyRow({ eligible_30d: "3", bad_30d: "1" });
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.startsWith("INSERT INTO processed_jobs")) {
        if (claimed) return { rows: [], rowCount: 0 };
        claimed = true;
        return { rows: [{}], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO slo_cutovers")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO slo_observations")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM slo_observations")) return { rows: [row], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const send = vi.fn(async (command: PutMetricDataCommand) => {
      expect(command.input.Namespace).toBe(SLO_NAMESPACE);
      expect(command.input.MetricData?.map((item) => item.MetricName)).toEqual([
        "PublisherHeartbeat", "PdfPreviewEligible30d",
        "PdfPreviewFailureRate", "PdfPreviewFailureRate", "PdfPreviewFailureRate", "PdfPreviewFailureRate", "PdfPreviewFailureRate",
      ]);
      return {};
    });
    const at = new Date("2026-11-11T12:00:42.123Z");
    const [first, second] = await Promise.all([
      publishSloMetrics({ query } as never, { send } as never, at),
      publishSloMetrics({ query } as never, { send } as never, at),
    ]);
    expect([first.published, second.published].sort()).toEqual([false, true]);
    expect(send).toHaveBeenCalledTimes(1);
    const snapshotCall = query.mock.calls.find(([sql]) => String(sql).includes("FROM slo_observations"))!;
    expect(snapshotCall[1]).toEqual([new Date("2026-11-11T12:00:00.000Z")]);
  });

  it("retains a minute claim when publication is uncertain, preventing a second snapshot at that timestamp", async () => {
    const row = emptyRow();
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.startsWith("INSERT INTO processed_jobs")) return { rows: [{}], rowCount: 1 };
      if (sql.includes("INSERT INTO slo_cutovers")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO slo_observations")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM slo_observations")) return { rows: [row], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(publishSloMetrics({ query } as never, { send: vi.fn().mockRejectedValue(new Error("CloudWatch uncertain")) } as never, queued))
      .rejects.toThrow("CloudWatch uncertain");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM processed_jobs"))).toBe(false);
  });
});
