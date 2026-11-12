# ADR-008: Logs, metrics and operational alerts

Status: Accepted (2026-11-10); SLO and burn-rate portion superseded by [ADR-023](023-slos-and-burn-rate.md)

## Requirement

Production needs JSON logs retained for 90 days, aggregate service metrics, alarms that reach a person, and
measurable SLOs without recording personal data in telemetry.

## Decision

Use CloudWatch Logs for the web, worker, migrations, database exports and mail forwarder, all retained for 90 days.
Enable aggregate ECS Container Insights and native metrics from ALB, CloudFront, RDS, SQS, SES, WAF and Route 53.
Predictable failures publish through CloudWatch alarms to one encrypted SNS alerts topic.

No request body, email address, IP address, user agent, token or agreement text may enter logs or metric dimensions.
Synthetics and RUM were deferred; [ADR-021](021-external-availability-check.md) records the external health-check
decision, and ADR-023 defines the later SLO implementation.

## Fixed monthly cost

CloudWatch Logs ingestion and retained bytes, and Container Insights metrics, vary with use. The fixed alarm and
custom-metric baseline is itemized in [ADR-022](022-cost-attribution-and-budget.md); ADR-023 adds at most US$7.44 per
month for SLO alarms, gauge metrics, publication and one dashboard.

## Simpler alternative

Application logs only, searched after a report. Rejected: a complete outage, a dead queue or exhausted storage could
remain unnoticed when no person is actively looking.

## Operational risk

Log cost grows with traffic and accidental high-cardinality metrics grow faster. Metrics therefore use aggregate,
closed dimensions, logs have finite retention, and the gross-usage budget remains the backstop. Symptom alarms do not
prove an SLO; ADR-023 keeps those separate rather than relabeling them.
