# Runbook: PDF preview error budget is burning

**Signal.** `theckards-prod-slo-pdf-preview-burn`.

The 30-day objective is 99% of agreement previews ready in under 10 seconds from outbox creation. The composite
fires at 14.4× burn in both 5-minute and 1-hour windows, or 6× in both 30-minute and 6-hour windows.

## 1. Check volume before interpreting the percentage

Open `theckards-prod-slos`. Read PDF eligible volume beside success rate. At launch, one late or failed preview can
be 100% of a window; that is real but does not imply high user volume.

The dashboard gauges come from `slo_observations`, not worker logs. If they look stale, first check the
`theckards-prod-slo-metrics-publisher` heartbeat and follow [slo-metrics-publisher](slo-metrics-publisher.md).
To compare the source, query aggregate fields only:

```sql
SELECT count(*) AS eligible, sum(failure) AS bad,
       round(avg(elapsed_ms)) AS average_ms, max(elapsed_ms) AS maximum_ms
FROM slo_observations
WHERE sli = 'pdf-preview' AND observed_at > now() - interval '30 days';
```

Never select IDs or add source record identifiers to this table.

## 2. Locate the delay

Check, in order:

1. `theckards-prod-jobs-age` and `theckards-prod-jobs-dlq` ([outbox-stalled](outbox-stalled.md));
2. worker desired/running task count, CPU and memory;
3. S3 and KMS error names in worker logs;
4. RDS capacity and `/readyz` ([database-capacity](database-capacity.md));
5. the release time, if the burn began after a deploy.

A late successful preview counts bad. A job still unfinished on its fifth receive counts bad before moving to the
DLQ; if only telemetry failed after `READY`, the persisted first finish time supplies the real classification. The
observation's unique, non-reversible source hash makes retries and concurrent deliveries exactly one source event. Published
metrics are current rate gauges calculated from that source, so a repeated CloudWatch request cannot add a good or
bad preview.

## 3. Mitigate and close

Restore the dependency or roll back through the deploy script. Redrive the DLQ only after the cause is fixed. Never
mark a version `READY`, replace a stored PDF or edit SLO metric data manually.

Close after new previews complete under 10 seconds, queue age is normal, DLQ is empty and both child-alarm pairs have
returned to OK. No traffic is a no-data state, not 100% success.
