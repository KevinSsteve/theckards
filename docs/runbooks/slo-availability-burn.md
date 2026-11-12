# Runbook: availability error budget is burning

**Signal.** `theckards-prod-slo-availability-burn`.

The composite fires when external failure exceeds 14.4× budget in both 5-minute and 1-hour windows, or 6× in both
30-minute and 6-hour windows. The 30-day objective is 99.9%; the whole budget is 43 minutes 12 seconds.

## 1. Read the child alarms

In CloudWatch, inspect the four alarms named `theckards-prod-slo-availability-*`. The fast pair means an acute
outage; the slow pair means a lower failure rate has persisted. Missing Route 53 health-check data is bad by design.

Confirm `AWS/Route53 HealthCheckStatus` directly. Then follow [unreachable](unreachable.md) to locate DNS, TLS,
CloudFront, WAF, ALB or ECS. If `/healthz` is up but real traffic has 5xx, follow [target-5xx](target-5xx.md).

## 2. Mitigate

Roll back a bad release through `scripts/deploy-prod.sh <previous-tag>`. Do not loosen WAF, security groups, TLS or
health thresholds until the failing layer is known. A false health-check block is fixed narrowly; global rate limits
stay in place.

## 3. Close

Verify all four child alarms and the composite return to OK, the 30-day dashboard value is understood, and
`/healthz` and `/readyz` both pass. Record minutes of bad `HealthCheckStatus`, not an inferred percentage. The SLO is
an internal objective, not a guarantee to users.
