# ADR-021: Detecting an outage that looks healthy

Status: Accepted (2026-11-11)

## Requirement

Section 9 (R-OPS-3) asks for a canary every five minutes that creates a test account, generates a contract and
views the preview. The underlying need is narrower and more urgent than that script: **know that the service is
reachable at all.**

Ten alarms watch production, and every one of them is a symptom alarm on traffic: ALB and target 5xx, unhealthy
tasks, DLQ depth, queue age, RDS CPU and free storage, CloudFront 5xx, SES bounce and complaint rates. All ten
are configured `treatMissingData: notBreaching`, which is correct for each of them individually — a quiet hour
is not an incident.

Together, it is a blind spot. If DNS stops resolving, the certificate expires, the CloudFront distribution is
misconfigured, or the service is down hard enough that no request reaches it, then no metric is published, no
data is treated as healthy, and **a total outage renders as ten green alarms**. Nothing in the account would
ever say otherwise.

## Decision

A Route 53 health check on `https://theckards.linkealls.com/healthz` every 30 seconds from multiple AWS regions,
with a CloudWatch alarm on `HealthCheckStatus` publishing to the existing alerts topic. This one alarm is
configured `treatMissingData: breaching`: if even the checker stops reporting, that is itself the news.

CloudWatch Synthetics canaries are **not** adopted now.

## Fixed monthly cost

Expected **US$0**. Route 53 allows a number of health checks against AWS endpoints at no charge, and the endpoint
here is a CloudFront distribution. The pricing page's health-check figures are not exposed through the Pricing
API, so this is the one number in our ADRs taken from documentation rather than measured; the worst case if it is
billed as a non-AWS endpoint is about US$0.75 per month. Confirm on the first bill.

## Alternative considered and rejected: CloudWatch Synthetics

Verified with the AWS Pricing API on 2026-11-11: `USE1-CW:Canary-runs` is **US$0.0012 per run**. A five-minute
cadence is about 8,760 runs per month, so **US$10.51 per month** before the Lambda duration, S3 artifacts and
log storage each canary also consumes. Call it US$11–13.

Rejected on two grounds, and cost is the weaker one.

The stronger objection is what the scripted flow would do to the data. A canary that signs up an account and
creates a contract every five minutes manufactures roughly 8,700 accounts and agreements a month inside the
production record. This product's whole claim is that its records mean something, and the fraud rules exist
precisely to keep manufactured agreements out of the numbers (S10, F1–F5). Paying to generate the exact pattern
those rules are designed to exclude is a poor trade, and routing it to a separate environment means the canary
stops testing production.

So the browser flow is deferred until there is a staging environment to run it against, or real traffic whose
absence would itself be the signal. Until then, reachability is the thing worth knowing, and a health check
answers it for a twentieth of the price.

## Alternative considered and rejected: changing the existing alarms to `breaching`

Flipping the ten symptom alarms to treat missing data as breaching would page on every quiet period, which on a
service with no users yet means constantly. Alarm fatigue would then teach us to ignore the one channel that
works. Reachability deserves its own signal, not a reinterpretation of nine unrelated ones.

## Operational risk

**One probe, one dimension.** A health check tells you the edge answered `200` on `/healthz`. It does not tell
you that signing works, that the worker is sealing documents, or that the queue is draining. Those have their own
alarms, which are only meaningful while traffic exists, so the blind spot narrows rather than closes.

**`/healthz` is shallow by design.** It must stay cheap and dependency-free, or the health check starts failing
for reasons that are not outages. Database health is `readyz`, and it is deliberately not what the probe reads;
a database blip should surface through the RDS alarms and 5xx, not by declaring the site down.

**The probe can be throttled.** Checkers come from many AWS source addresses at 30-second intervals, well under
the WAF rate rules today. A future tightening of those rules could start blocking the checker, which would show
up as a false outage, so the WAF rate limits and this health check have to be considered together.
