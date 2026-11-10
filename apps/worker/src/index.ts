import http from "node:http";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

const queueUrl = process.env.JOBS_QUEUE_URL;
const sqs = new SQSClient({});
let running = true;
let lastPoll = Date.now();

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));

// Liveness endpoint for ECS container health check (no PII).
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const ok = Date.now() - lastPoll < 120_000;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "stalled" }));
  } else {
    res.writeHead(404).end();
  }
});
server.listen(Number(process.env.PORT ?? 8080));

async function handle(topic: string, _payload: unknown): Promise<void> {
  // Handlers are added by later specs (pdf.render, seal.final, email.*, stripe.*, ...).
  log("warn", "no handler for topic", { topic });
}

async function loop(): Promise<void> {
  if (!queueUrl) {
    log("warn", "JOBS_QUEUE_URL not set; idling");
    while (running) { lastPoll = Date.now(); await new Promise((r) => setTimeout(r, 10_000)); }
    return;
  }
  while (running) {
    try {
      const out = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }));
      lastPoll = Date.now();
      for (const m of out.Messages ?? []) {
        const body = JSON.parse(m.Body ?? "{}") as { topic?: string; payload?: unknown };
        await handle(body.topic ?? "unknown", body.payload);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
      }
    } catch (err) {
      log("error", "poll failed", { error: err instanceof Error ? err.name : "unknown" });
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => { log("info", "shutting down", { sig }); running = false; server.close(); setTimeout(() => process.exit(0), 25_000).unref(); });
}
void loop().then(() => process.exit(0));
