# ADR-023: Measurable SLOs and multi-window burn-rate alerts

Status: Accepted (2026-11-11)

## Requirement

R-OPS-2 fixes three rolling 30-day objectives:

- external availability: 99.9%;
- agreement preview PDF ready in under 10 seconds: 99%;
- transactional email delivered in under 2 minutes: 99%.

An objective without an eligible event, definitions of good and bad, and an alert tied to its error budget is not
measurable. The existing symptom alarms remain useful, but none says how quickly an SLO budget is being consumed.

## Decision

Use the CloudWatch, Route 53, PostgreSQL, SQS and SNS components already in the stack. No AWS service is added.

### Availability SLI

- **Eligible event:** each one-minute Route 53 `HealthCheckStatus` period from the existing external HTTPS check.
- **Good:** the period reports healthy (`1`).
- **Bad for alerting:** unhealthy (`0`) or absent.
- **Objective:** 99.9%, leaving 0.1% error budget, equivalent to 43 minutes 12 seconds of full unavailability in a
  30-day month.

This is external reachability, not every feature's health: DNS, TLS, CloudFront, WAF, ALB, ECS and `/healthz` must all
answer. `/healthz` remains deliberately shallow, as ADR-021 records.

The four burn components operate on a one-minute `FILL(status, 0)` expression, so a missing whole minute is an
explicit bad point rather than a smaller denominator. Whole-minute M-of-N thresholds conservatively approximate the
burn factors: 1/5 and 1/60 for fast burn, 1/30 and 3/360 for slow burn.

CloudWatch retains one-minute points for 15 days, but five-minute Sum and SampleCount for 63 days. The dashboard's
30-day tile therefore reports two values from five-minute rollups: observed availability and sample coverage. The
production health metric currently reports a statistic set with SampleCount 3 per minute (verified through
`GetMetricStatistics`), so full 30-day coverage is 129,600 samples. Until coverage reaches the complete window, the
dashboard does not label the observed value as a complete 30-day SLO.

### PDF preview SLI

- **Eligible event:** one logical `pdf.render` outbox job for an agreement version.
- **Start:** database `outbox.created_at`, carried into the queue envelope as `queuedAt`.
- **Finish:** database `clock_timestamp()` after rendering, S3 acceptance and the transition to `READY`, stored in
  nullable `agreement_versions.rendered_at`.
- **Good:** ready in strictly less than 10,000 ms.
- **Bad:** ready at or after 10,000 ms, or still unfinished on the fifth failed SQS receive before redrive to the
  DLQ. If only telemetry failed after `READY`, the persisted finish time classifies the real result.
- **Objective:** 99%, leaving 1% error budget.

`rendered_at = COALESCE(rendered_at, clock_timestamp())` preserves the first finish under concurrent duplicate
deliveries. Retries of a `READY` version never regenerate or overwrite the PDF.

Each logical result is inserted exactly once into `slo_observations`, whose unique `source_hash` is SHA-256 over a
fixed prefix, the SLI and the random outbox UUID. The row's primary ID is unrelated and random. It contains only
non-reversible identifiers, `sli=pdf-preview`, a 0/1 result, duration and timestamp; no agreement, raw job, user,
party, email, request or message identifier. Rows created before this release have no trustworthy finish time and are
not backfilled.

The first new worker persists a `pdf-preview` cutover fifteen minutes in the future. Direct observations require
`outbox.created_at >= eligible_after`, and reconciliation joins the same boundary. This intentionally excludes
historical jobs and every preview that an old worker could complete during the migration-first rolling deployment.
The cutover is written once and survives later deploys.

Every minute, the worker calculates 5m, 1h, 30m, 6h and 30d rates directly from this database source, then publishes
one CloudWatch request containing gauges:

- `PdfPreviewFailureRate`, with closed `Window` values only;
- `PdfPreviewEligible30d`;
- `PublisherHeartbeat`.

Before each snapshot, a set-based reconciliation reads every `pdf.render` outbox row at least fifteen seconds old
(the five-second grace avoids racing a `READY` commit at the strict ten-second boundary). Missing observations are inserted as bad at their 10-second deadline, or from persisted `rendered_at` if the PDF did finish.
This covers an unpublished outbox row, a killed/OOM worker and a message moved to the DLQ without executing a catch
block. The outbox is retained seven days, far longer than the one-minute reconciliation cadence.

A deterministic `processed_jobs` claim allows at most one publication attempt per UTC minute. The claim is retained
when `PutMetricData` returns an uncertain error: retrying could aggregate a different snapshot at the same timestamp.
The durable source is recalculated at the next minute instead. `PublisherHeartbeat` makes missing publication
explicit and pages after 8 of 10 absent minutes.

The source rows are deleted after 35 days: five days after leaving the SLO window. This retention is a correctness
bound, like the idempotency ledger and queue retention, not an owner-adjustable policy; allowing it below 30 days
would make the SLO mathematically incomplete. The sweeper never touches agreement record tables.

### Email delivery SLI

The objective is defined but **has no implementation and must display as unavailable, never 100%**:

- eligible event: each transactional email accepted for sending;
- good: an SES `Delivery` terminal event within 120 seconds of the original send;
- bad: later delivery, bounce, reject, rendering failure, excessive delivery delay or definitive send-job failure;
- objective: 99%.

The AWS API reports `ProductionAccessEnabled=true`, `SendingEnabled=true`, healthy enforcement and zero sends in the
last 24 hours. The application has `EMAIL_DELIVERY_ENABLED=false`, and the configuration set publishes Bounce,
Complaint, Reject and DeliveryDelay but not Delivery. SDK acceptance is not delivery. Instrumentation waits for a
sanitized terminal-event path that does not persist recipient addresses in logs or the shared jobs queue.

R-OPS-2 therefore remains partially open: availability and PDF are implemented; email remains explicitly no data.

### Burn-rate alerts

For objective `S`, error budget is `1-S`, and burn rate is `bad fraction / (1-S)`. Each implemented SLI has four
non-paging component alarms and one composite that alone publishes ALARM and OK to the existing SNS topic:

```
(fast 5m AND fast 1h) OR (slow 30m AND slow 6h)
```

| Pair | Burn | Availability bad fraction | PDF bad fraction | Approximate monthly budget consumed |
| --- | ---: | ---: | ---: | ---: |
| Fast | 14.4× | 1.44% | 14.4% | 2% in one hour |
| Slow | 6× | 0.6% | 6% | 5% in six hours |

The short and long window must both breach, reducing pages from isolated spikes. PDF missing data means no eligible
previews and is not breaching. No minimum volume is imposed at launch: one bad preview can page, and the dashboard
shows volume so that fact is visible.

The canonical multi-window method comes from the
[Google SRE Workbook](https://sre.google/workbook/alerting-on-slos/). AWS documents composite state rules in
[Create a composite alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html)
and missing-data behavior in
[Configuring how alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html).

### Dashboard

Create `theckards-prod-slos`, with no Logs Insights or high-cardinality dimensions:

- observed availability and 30-day sample coverage;
- rolling 30-day PDF success and eligible volume;
- all eight burn-window states, both paging composites and publisher heartbeat;
- a retained five-minute availability graph, PDF burn gauges, queue and web diagnosis;
- a text panel explaining why email has no value.

## Fixed monthly cost

Prices were verified on 2026-11-11 through the AWS Price List API and the official
[CloudWatch pricing page](https://aws.amazon.com/cloudwatch/pricing/). The account has 50 metric alarms, zero
composite alarms and four custom dashboards, so alarm and dashboard free allowances are consumed.

| Resource | Count | Unit price | Maximum incremental cost |
| --- | ---: | ---: | ---: |
| Standard-resolution alarms (8 burn + publisher heartbeat) | 9 | US$0.10/alarm-month | US$0.90 |
| Composite alarms | 2 | US$0.50/alarm-month | US$1.00 |
| Custom metric series (5 rates + volume + heartbeat) | up to 7 | US$0.30/metric-month | US$2.10 |
| Basic dashboard (fifth account-wide) | 1 | US$3.00/dashboard-month | US$3.00 |
| `PutMetricData`, one request/minute | about 43,800/month | first million API requests free; then US$0.01/1,000 | up to US$0.44 if the account-wide allowance is consumed |
| **Total** | | | **up to US$7.44/month gross** |

Metrics are hourly-prorated only while publishing. Every rate series publishes `-1` when its window has no eligible
preview; `-1` is outside the 0..1 failure domain, keeps alarms OK and stops the dashboard retaining an old value. No
high-resolution alarm, Application Signals, Synthetics, RUM, Lambda, new queue or new topic is used.

CloudWatch is not among the ineligible services in the current
[AWS Promotional Credit terms](https://aws.amazon.com/awscredits/). The gross-usage budget continues to ignore
credits so consumption stays visible while AWS Activate pays eligible charges.

## Simpler alternatives

1. **Keep fixed symptom alarms only.** Cheaper, but they cannot describe error-budget consumption. Rejected.
2. **One 30-day alarm per SLI.** It reports too late to stop an incident. Rejected.
3. **Application Signals.** It adds agents, ingestion and another billing surface. Rejected.
4. **Use JSON logs as the metric source.** The ECS awslogs driver is non-blocking and can drop lines; rejected as a
   source of truth.
5. **Emit one metric event per preview.** CloudWatch publication has no idempotency key; a retry can change the
   denominator. Rejected in favor of database-derived gauges.
6. **Treat SDK email acceptance as delivery.** Simple and wrong; rejected.
7. **No dashboard.** Saves US$3 but makes low traffic and no-data states easy to misread. Rejected for launch.

## Operational risk

- **Low traffic is mathematically loud.** One bad preview among one event is 100%. A minimum sample threshold would
  hide launch incidents, so volume is shown and the policy will be revisited after a month.
- **Publisher delay.** Gauge metrics are about one minute behind PostgreSQL. The loop recalculates the next UTC
  minute-plus-five-seconds boundary after every attempt, so request duration does not accumulate as drift. The
  heartbeat distinguishes stale telemetry from no PDF traffic.
- **One lost publication minute is possible after an uncertain error or process death.** The claim is intentionally
  retained to prevent a second, different snapshot at the same timestamp. The next UTC minute resumes; eight missing
  heartbeats in ten minutes page. Source observations remain in PostgreSQL for 35 days.
- **Cutover excludes fifteen minutes.** That is deliberate rollout safety, not success. A rollback to a pre-SLO
  worker after the cutover stops the heartbeat and leaves new previews without finish timestamps; use it only for an
  emergency, then restore an SLO-capable worker.
- **Availability history starts incomplete.** Coverage is displayed separately until a full 30-day window exists.
- **The availability probe is shallow.** A database outage can leave `/healthz` green; 5xx, RDS and queue alarms
  remain necessary.
- **Email remains unknown.** The dashboard must say unavailable until real sanitized Delivery events exist.
- **SLOs are internal objectives, not promises.** Single-AZ RDS and one NAT remain accepted risks.

Content from the linked AWS and Google sources was rephrased for compliance with licensing restrictions.
