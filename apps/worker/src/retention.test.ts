import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BATCH_SIZE, MAX_BATCHES_PER_TABLE, PROCESSED_JOB_DAYS, RATE_LIMIT_EVENT_DAYS, RETENTION_RULES, sweepRetention,
} from "./retention.js";

const root = new URL("../../../", import.meta.url).pathname;
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return Promise.resolve(/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [full] : []);
  }));
  return nested.flat();
}

/** Tables the Privacy Policy promises to keep while the agreement exists. */
const RECORD_TABLES = [
  "agreements", "agreement_versions", "parties", "signatures", "party_consents", "sealed_documents", "confirmations",
  "messages", "record_notes", "cases", "proposals", "proposal_acceptances", "addenda", "addendum_signatures",
  "evidence", "dossier_requests",
];

describe("what the sweeper may delete", () => {
  it("touches only the operational tables around the record", () => {
    expect(RETENTION_RULES.map((rule) => rule.table).sort()).toEqual(
      ["idempotency_keys", "otp_codes", "outbox", "processed_jobs", "rate_limit_events", "sessions"],
    );
    for (const rule of RETENTION_RULES) {
      expect(rule.table).toMatch(/^[a-z_]+$/);
      for (const record of RECORD_TABLES) expect(rule.expired, rule.table).not.toMatch(new RegExp(`\\b${record}\\b`));
    }
  });

  // Defence in depth: even a broken sweeper, or anything else running as the application role, cannot delete the
  // record, because the database refuses. This fails if a record table ever loses its REVOKE.
  it("relies on grants that forbid the application role from deleting any record table", async () => {
    const grants = await read("packages/database/src/index.ts");
    const protectedTables = new Set(
      [...grants.matchAll(/REVOKE ([A-Z, ]*DELETE[A-Z, ]*) ON ([a-z_, ]+) FROM theckards_app/g)]
        .flatMap((match) => match[2]!.split(",").map((name) => name.trim())),
    );
    for (const record of RECORD_TABLES) expect(protectedTables.has(record), `${record} must not be deletable`).toBe(true);
    for (const rule of RETENTION_RULES) expect(protectedTables.has(rule.table), `${rule.table} must be deletable`).toBe(false);
  });

  it("never deletes an outbox message that has not been published", () => {
    const outbox = RETENTION_RULES.find((rule) => rule.table === "outbox")!;
    expect(outbox.expired).toContain("published_at IS NOT NULL");
  });
});

describe("the windows are bounded by the mechanisms they serve", () => {
  it("keeps rate-limit events longer than every window in use", async () => {
    const files = await sourceFiles(path.join(root, "apps/web/src"));
    const windows: number[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/windowSeconds:\s*([\d_]+)/g)) windows.push(Number(match[1]!.replaceAll("_", "")));
      for (const match of source.matchAll(/enforceRateLimit\([^)]*,\s*([\d_]+)\)/g)) windows.push(Number(match[1]!.replaceAll("_", "")));
    }
    // If this finds nothing, the scan broke rather than the limits disappearing.
    expect(windows.length).toBeGreaterThan(20);
    expect(RATE_LIMIT_EVENT_DAYS * 86_400).toBeGreaterThan(Math.max(...windows));
  });

  it("keeps the job ledger longer than SQS can deliver the same job again", async () => {
    const stack = await read("infra/lib/app-stack.ts");
    const days = (queue: string) => Number(
      new RegExp(`queueName: \`\\$\\{p\\}-${queue}\`[^\\n]*retentionPeriod: cdk\\.Duration\\.days\\((\\d+)\\)`).exec(stack)?.[1],
    );
    const jobs = days("jobs");
    const deadLetters = days("jobs-dlq");
    expect(jobs).toBeGreaterThan(0);
    expect(deadLetters).toBeGreaterThan(0);
    expect(PROCESSED_JOB_DAYS).toBeGreaterThan(jobs + deadLetters);
  });
});

function fakePool(options: { locked?: boolean; batches?: Record<string, number[]>; failOn?: string } = {}) {
  const sql: string[] = [];
  const remaining = new Map(Object.entries(options.batches ?? {}).map(([table, counts]) => [table, [...counts]]));
  const release = vi.fn();
  const client = {
    release,
    query: vi.fn(async (text: string) => {
      sql.push(text);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: options.locked ?? true }], rowCount: 1 };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
      const table = /^DELETE FROM ([a-z_]+)/.exec(text)?.[1] ?? "";
      if (table === options.failOn) throw Object.assign(new Error("permission denied"), { code: "42501" });
      return { rows: [], rowCount: remaining.get(table)?.shift() ?? 0 };
    }),
  };
  return { pool: { connect: async () => client }, sql, release };
}

describe("a sweep", () => {
  it("does nothing while another worker task holds the lock", async () => {
    const { pool, sql, release } = fakePool({ locked: false });
    await expect(sweepRetention(pool as never)).resolves.toEqual({ ran: false, deleted: {}, unfinished: [] });
    expect(sql.some((text) => text.startsWith("DELETE"))).toBe(false);
    expect(release).toHaveBeenCalledWith(true);
  });

  it("deletes in batches until a batch comes back short, and adds them up", async () => {
    const { pool, sql } = fakePool({ batches: { sessions: [BATCH_SIZE, BATCH_SIZE, 7], outbox: [3] } });
    const result = await sweepRetention(pool as never);
    expect(result.ran).toBe(true);
    expect(result.deleted).toMatchObject({ sessions: 2 * BATCH_SIZE + 7, outbox: 3, processed_jobs: 0 });
    expect(sql.filter((text) => text.startsWith("DELETE FROM sessions"))).toHaveLength(3);
    for (const text of sql.filter((statement) => statement.startsWith("DELETE"))) expect(text).toContain("LIMIT $1");
  });

  it("stops at the batch cap and says the table is unfinished", async () => {
    const { pool } = fakePool({ batches: { rate_limit_events: Array(MAX_BATCHES_PER_TABLE + 5).fill(BATCH_SIZE) } });
    const result = await sweepRetention(pool as never);
    expect(result.deleted.rate_limit_events).toBe(MAX_BATCHES_PER_TABLE * BATCH_SIZE);
    expect(result.unfinished).toEqual(["rate_limit_events"]);
  });

  it("releases the lock and the connection when a delete fails", async () => {
    const { pool, sql, release } = fakePool({ failOn: "idempotency_keys" });
    await expect(sweepRetention(pool as never)).rejects.toMatchObject({ code: "42501" });
    expect(sql.at(-1)).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledWith(true);
  });
});
