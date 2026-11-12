import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import http from "node:http";
import { pool } from "./db.js";
import { publishOutbox, receiveAndProcess } from "./jobs.js";
import { nextSloPublicationAt, publishSloMetrics } from "./slo.js";
import { sweepRetention } from "./retention.js";

let running = true;
let lastPoll = Date.now();
const cloudwatch = new CloudWatchClient({});

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const ok = Date.now() - lastPoll < 120_000;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "stalled" }));
  } else if (req.url === "/readyz") {
    void pool.query("SELECT 1").then(() => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":"ok"}'); })
      .catch(() => { res.writeHead(503, { "content-type": "application/json" }); res.end('{"status":"unavailable"}'); });
  } else {
    res.writeHead(404).end();
  }
});
server.listen(Number(process.env.PORT ?? 8080));

async function outboxLoop(): Promise<void> {
  while (running) {
    try {
      const count = await publishOutbox();
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    } catch (error) {
      log("error", "outbox publish failed", { error: error instanceof Error ? error.name : "unknown" });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function queueLoop(): Promise<void> {
  while (running) {
    try {
      await receiveAndProcess();
      lastPoll = Date.now();
    } catch (error) {
      log("error", "job processing failed", { error: error instanceof Error ? error.name : "unknown" });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

/** Sleeps in short steps, so shutdown is never stuck behind a long wait. */
async function pause(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (running && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, until - Date.now())));
  }
}

/**
 * Publishes closed aggregate gauges from the database source of truth. All worker tasks run this loop, but a
 * deterministic per-minute database claim lets only one publish. It recalculates the next UTC :05 boundary after
 * every attempt, so API duration never accumulates as timer drift. Missing heartbeat pages through CloudWatch.
 */
async function sloLoop(): Promise<void> {
  while (running) {
    const now = Date.now();
    await pause(nextSloPublicationAt(now) - now);
    if (!running) return;
    try {
      await publishSloMetrics(pool, cloudwatch);
    } catch (error) {
      log("error", "slo metrics publish failed", { error: error instanceof Error ? error.name : "unknown" });
    }
  }
}

/**
 * Retention (docs/runbooks/retention-sweep-failure.md). The first pass waits a few minutes so a deploy settles,
 * then repeats every six hours. Six hours rather than daily on purpose: the timer lives in the process, and a
 * worker restarted by deploys more often than once a day would otherwise never reach its first daily run.
 * Every pass is idempotent, so running more often costs nothing.
 */
const SWEEP_FIRST_DELAY_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

async function retentionLoop(): Promise<void> {
  await pause(SWEEP_FIRST_DELAY_MS);
  while (running) {
    const started = Date.now();
    try {
      const result = await sweepRetention(pool);
      // Counts only. The sweeper never reads row contents, so there is nothing personal to log.
      if (result.ran) log("info", "retention sweep", { deleted: result.deleted, unfinished: result.unfinished, ms: Date.now() - started });
    } catch (error) {
      log("error", "retention sweep failed", {
        error: error instanceof Error ? error.name : "unknown",
        code: typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : undefined,
      });
    }
    await pause(SWEEP_INTERVAL_MS);
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log("info", "shutting down", { sig });
    running = false;
    server.close();
    cloudwatch.destroy();
    void pool.end();
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}

await Promise.all([outboxLoop(), queueLoop(), sloLoop(), retentionLoop()]);
