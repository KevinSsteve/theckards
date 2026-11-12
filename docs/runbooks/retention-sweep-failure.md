# Runbook: the retention sweep failed

**Symptom.** The `theckards-prod-retention-sweep-failure` alarm fired: the worker logged
`retention sweep failed` at least once in the last hour.

**Impact.** Low and slow. Nothing user-facing depends on the sweep. While it fails, operational rows that should
have been removed stay: dead sessions holding encrypted refresh tokens, replay-protection keys, rate-limit events
keyed by hashed IP addresses, expired one-time codes, published outbox messages, the job ledger and aggregate SLO
observations. The record
itself is never touched by the sweep, so a failure cannot lose an agreement, a signature or a seal.

## How the sweep works

`apps/worker/src/retention.ts`. Each worker task runs a pass five minutes after it starts and then every six
hours. A session-level advisory lock means only one task sweeps at a time; the others skip silently. Each rule
deletes in batches of 1,000 rows by `ctid`, up to 100 batches per table per pass, then moves on.

| Table | Removed when | Why that window |
| --- | --- | --- |
| `sessions` | one day after the session died (revoked, absolute or idle expiry) | a dead session can never authenticate again |
| `idempotency_keys` | one day old | retries of one request happen within seconds |
| `rate_limit_events` | two days old | twice the longest window in use, 86,400 s |
| `otp_codes` | one day after expiry | a used or expired code is never checked again |
| `outbox` | seven days after it was **published** | SQS carries the message from there; unpublished rows are never touched |
| `slo_observations` | thirty-five days old | five days after leaving the rolling 30-day SLO window; rows contain no source identifier |
| `processed_jobs` | thirty days old | must outlast the jobs queue (4 days) plus the dead-letter queue (14 days), and clears minute publication claims |

Tests in `retention.test.ts` pin the SLO and queue-ledger windows to the code they depend on, and fail if a record table ever
loses the database grant that stops the application role from deleting it.

## 1. Read the failure

```sh
aws logs filter-log-events --log-group-name /theckards/prod/worker \
  --start-time "$(( ($(date +%s) - 7200) * 1000 ))" \
  --filter-pattern '{ $.msg = "retention sweep*" }' --query 'events[*].message' --output text
```

The failure line carries the PostgreSQL error `code`:

| `code` | Meaning | Action |
| --- | --- | --- |
| `42501` | Permission denied | The application role lost `DELETE` on one of the seven tables. Check the grants in `packages/database/src/index.ts` and re-run the migration task, which reapplies them. Never fix it by granting `DELETE` on a record table. |
| `57014` | Statement timeout (30 s) | A batch took too long, usually a large backlog on a table without a suitable index. The next pass continues where this one stopped. If it repeats, see step 3. |
| `40P01` | Deadlock | Transient. The next pass retries. |
| none, `ECONNREFUSED` or similar | The database was unreachable | Follow the database alarms first; the sweep recovers on its own. |

## 2. Is it catching up or falling behind?

A successful pass logs what it removed and whether any table hit the batch cap:

```json
{"level":"info","msg":"retention sweep","deleted":{"sessions":3,"rate_limit_events":412},"unfinished":[],"ms":184}
```

`unfinished` listing a table on several consecutive passes means rows expire faster than one pass removes them.
At 100,000 rows per table per six hours that is not expected at this scale, and is worth understanding before
raising `MAX_BATCHES_PER_TABLE`.

## 3. If a batch keeps timing out

The `ctid` subquery reads the expiry condition. `rate_limit_events` and `idempotency_keys` have no index that
starts with `created_at`, so a very large backlog is scanned. An index is the fix:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS rate_limit_events_created_idx ON rate_limit_events(created_at);
```

Add it as a new expand-only migration, not by hand, so the next environment gets it too. Note that the
migration runner wraps each migration in a transaction, where `CONCURRENTLY` is not allowed, so drop that keyword
in the migration and accept the short lock on a table this small.

## Do not

- Do not delete record tables by hand to "help". Retention of the record is a promise in the Privacy Policy, not
  a setting.
- Do not shorten `PROCESSED_JOB_DAYS` below the queue retention plus the dead-letter retention. A job redriven
  from the DLQ after its ledger row is gone runs again, and some jobs, such as sending an email, are not safe to
  repeat.
