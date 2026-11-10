import http from "node:http";
import { pool } from "./db.js";
import { publishOutbox, receiveAndProcess } from "./jobs.js";

let running = true;
let lastPoll = Date.now();

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

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log("info", "shutting down", { sig });
    running = false;
    server.close();
    void pool.end();
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}

await Promise.all([outboxLoop(), queueLoop()]);
