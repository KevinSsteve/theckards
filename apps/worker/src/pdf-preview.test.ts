import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { renderPdfPreview } from "./pdf-preview.js";
import { queueEnvelopeFromOutbox, type QueueEnvelope } from "./queue-envelope.js";

const queuedAt = new Date("2026-11-11T12:00:00.000Z");
const renderedAt = new Date("2026-11-11T12:00:09.000Z");
const envelope: QueueEnvelope = {
  id: "00000000-0000-4000-8000-000000000001",
  topic: "pdf.render",
  queuedAt: queuedAt.toISOString(),
  payload: { agreementId: "00000000-0000-4000-8000-000000000002", versionId: "00000000-0000-4000-8000-000000000003" },
};
const version = {
  title: "A test agreement", template_id: "general" as const, number: 1,
  fields: { purpose: "Test" }, created_at: queuedAt, render_status: "PENDING", rendered_at: null,
};

describe("the outbox-to-queue clock", () => {
  it("uses the database creation time without changing the job payload", () => {
    expect(queueEnvelopeFromOutbox({ id: envelope.id, topic: envelope.topic, payload: envelope.payload, created_at: queuedAt }))
      .toEqual(envelope);
  });
});

describe("PDF preview orchestration", () => {
  it("stores bytes before READY, preserves the first database completion time and then observes it", async () => {
    const order: string[] = [];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT v.title")) { order.push("load"); return { rows: [version], rowCount: 1 }; }
      if (sql.includes("UPDATE agreement_versions")) {
        order.push("ready");
        expect(sql).toContain("rendered_at = COALESCE(rendered_at, clock_timestamp())");
        return { rows: [{ rendered_at: renderedAt }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const render = vi.fn(async () => { order.push("render"); return new Uint8Array([1, 2, 3]); });
    const send = vi.fn(async (command: PutObjectCommand) => {
      order.push("store");
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({ Bucket: "documents", ContentType: "application/pdf" });
      return {};
    });
    const observe = vi.fn(async (_store, jobId, observation) => {
      order.push("observe");
      expect(jobId).toBe(envelope.id);
      expect(observation).toEqual({
        sli: "pdf-preview", failure: 0, elapsedMs: 9_000, observedAt: "2026-11-11T12:00:09.000Z",
        eligibleAt: "2026-11-11T12:00:00.000Z",
      });
      return true;
    });

    await renderPdfPreview(envelope, { pool: { query } as never, s3: { send } as never, bucket: "documents", render, observe });

    expect(order).toEqual(["load", "render", "store", "ready", "observe"]);
  });

  it("does not regenerate READY bytes and retries only the deduplicated observation", async () => {
    const query = vi.fn(async () => ({ rows: [{ ...version, render_status: "READY", rendered_at: renderedAt }], rowCount: 1 }));
    const render = vi.fn();
    const send = vi.fn();
    const observe = vi.fn(async () => false);

    await renderPdfPreview(envelope, { pool: { query } as never, s3: { send } as never, bucket: "documents", render, observe });

    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("treats an old envelope or old READY row as no data instead of inventing a result", async () => {
    const query = vi.fn(async () => ({ rows: [{ ...version, render_status: "READY", rendered_at: null }], rowCount: 1 }));
    const observe = vi.fn();
    await renderPdfPreview({ ...envelope, queuedAt: undefined }, {
      pool: { query } as never, s3: { send: vi.fn() } as never, bucket: "documents", render: vi.fn(), observe,
    });
    expect(observe).not.toHaveBeenCalled();
  });
});
