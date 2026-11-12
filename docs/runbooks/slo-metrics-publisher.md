# Runbook: SLO metric publisher heartbeat missing

**Signal.** `theckards-prod-slo-metrics-publisher` has no healthy heartbeat for at least 8 of 10 minutes.

The worker stores PDF observations exactly once in `slo_observations`, then one worker per UTC minute calculates the
closed windows and sends gauge metrics to `Theckards/SLO`. On its first rollout it fixes a PDF eligibility cutover
fifteen minutes ahead, excluding old-worker jobs. A missing publisher does not lose the database source, but
burn-rate alarms cannot evaluate new data until publication resumes.

## 1. Locate the failure

Check that the worker service has its desired running tasks and that `/readyz` succeeds. In
`/theckards/prod/worker`, look only for aggregate `slo metrics publish failed` error names; no observation or source
identifier should be logged.

Confirm the task role permits `cloudwatch:PutMetricData` only when `cloudwatch:namespace` is `Theckards/SLO`. Check
CloudWatch service health and RDS connectivity. A row in `processed_jobs` with topic `slo.publish` is a one-minute
claim, not a business job.

## 2. Recover

Fix the dependency or roll back the release through `scripts/deploy-prod.sh`. Do not publish a fake heartbeat or edit
SLO metric values manually: either action would make the dashboard look current while its source is stale.

A failed or uncertain PutMetricData call keeps that minute's claim: retrying could mix a different snapshot into the
same timestamp. The durable source is recalculated at the next UTC minute, whose key is different. One missed
publication is visible in the heartbeat; eight misses in ten minutes page.

## 3. Verify

The heartbeat must publish every minute, the alarm must return to OK, and the dashboard's PDF eligible count and
rates must match a direct aggregate query of `slo_observations`. The table contains only random primary UUIDs,
non-reversible source hashes, closed SLI names, 0/1 outcomes, durations and timestamps; do not add record identifiers
while investigating.
