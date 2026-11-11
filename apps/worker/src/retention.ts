import type pg from "pg";

/**
 * The retention sweeper (S8 T8.6): removes operational data once it has outlived its purpose.
 *
 * It never touches the record. Agreements, versions, parties, signatures, seals, confirmations, messages, notes,
 * cases, proposals, addenda, evidence and dossier requests are kept while the agreement exists, as the Privacy
 * Policy promises, and the application role could not delete them anyway: the database grants refuse. What this
 * removes is the machinery around the record: sessions, replay protection, rate limiting, one-time codes, the
 * outbox and the job ledger. Several of those hold encrypted refresh tokens, encrypted invitation tokens or keyed
 * hashes of IP addresses, so keeping them longer than needed is a risk with no benefit.
 *
 * The windows are correctness bounds, not policy, which is why they live in code rather than in the Admin
 * dashboard. Shortening one below the mechanism it serves breaks that mechanism: a rate limit that forgets events
 * inside its own window undercounts, and a job ledger shorter than the dead-letter queue lets a redriven job run
 * twice. Tests pin each bound to the code it depends on.
 */

/** The longest rate-limit window in use is 86,400 s. Events are kept for twice that. */
export const RATE_LIMIT_EVENT_DAYS = 2;

/**
 * A job may be delivered again for as long as SQS keeps it: 4 days on the jobs queue, then up to 14 more in the
 * dead-letter queue before a redrive. The ledger that prevents a second run has to outlast both together.
 */
export const PROCESSED_JOB_DAYS = 30;

export interface RetentionRule {
  table: string;
  /** SQL condition over one row of `table`. Matching rows are deleted. */
  expired: string;
  /** Why this window, for the log and the runbook. */
  why: string;
}

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    table: "sessions",
    // A session dies at the first of revocation, absolute expiry or inactivity expiry, and none of those can be
    // undone: loading a session refreshes inactivity only while it is still valid. LEAST ignores the NULL
    // revoked_at of a session that was never revoked.
    expired: "LEAST(revoked_at, absolute_expires_at, inactivity_expires_at) < now() - interval '1 day'",
    why: "a session that can no longer authenticate, one day after it died; it may hold an encrypted refresh token",
  },
  {
    table: "idempotency_keys",
    expired: "created_at < now() - interval '1 day'",
    why: "replay protection is for retries of the same request, which happen within seconds; one day is generous",
  },
  {
    table: "rate_limit_events",
    expired: `created_at < now() - interval '${RATE_LIMIT_EVENT_DAYS} days'`,
    why: "older than twice the longest rate-limit window, so no limit can still be counting it",
  },
  {
    table: "otp_codes",
    expired: "expires_at < now() - interval '1 day'",
    why: "a one-time code one day after it expired",
  },
  {
    table: "outbox",
    // An unpublished row is pending work and is never touched.
    expired: "published_at IS NOT NULL AND published_at < now() - interval '7 days'",
    why: "a published message: SQS carries it from there, and the row may hold an encrypted token",
  },
  {
    table: "processed_jobs",
    expired: `processed_at < now() - interval '${PROCESSED_JOB_DAYS} days'`,
    why: "the deduplication ledger, kept well past the longest time SQS can deliver the same job again",
  },
] as const;

/** Rows deleted per statement, so no single statement holds locks for long. */
export const BATCH_SIZE = 1_000;
/** A run stops after this many batches per table and picks up the rest on the next run. */
export const MAX_BATCHES_PER_TABLE = 100;

const LOCK_KEY = "theckards-retention-sweep";

export interface SweepResult {
  /** False when another worker task held the lock, so this one did nothing. */
  ran: boolean;
  deleted: Record<string, number>;
  /** Tables that hit the batch cap and still have expired rows. */
  unfinished: string[];
}

type Connectable = { connect(): Promise<Pick<pg.PoolClient, "query" | "release">> };

/**
 * One pass over every rule. Several worker tasks may be running, so a session-level advisory lock makes sure only
 * one sweeps at a time; the others return immediately. The connection is destroyed rather than returned to the
 * pool afterwards, so the lock cannot outlive the sweep even if unlocking fails.
 */
export async function sweepRetention(pool: Connectable, rules: readonly RetentionRule[] = RETENTION_RULES): Promise<SweepResult> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [LOCK_KEY]);
    if (!lock.rows[0]?.locked) return { ran: false, deleted: {}, unfinished: [] };
    try {
      const deleted: Record<string, number> = {};
      const unfinished: string[] = [];
      for (const rule of rules) {
        let total = 0;
        for (let batch = 1; ; batch += 1) {
          const result = await client.query(
            `DELETE FROM ${rule.table} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${rule.table} WHERE ${rule.expired} LIMIT $1))`,
            [BATCH_SIZE],
          );
          const count = result.rowCount ?? 0;
          total += count;
          if (count < BATCH_SIZE) break;
          if (batch >= MAX_BATCHES_PER_TABLE) { unfinished.push(rule.table); break; }
        }
        deleted[rule.table] = total;
      }
      return { ran: true, deleted, unfinished };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release(true);
  }
}
