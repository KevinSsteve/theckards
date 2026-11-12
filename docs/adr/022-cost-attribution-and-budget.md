# ADR-022: Cost attribution and a budget that can actually fire

Status: Accepted (2026-11-11)

## Requirement

R-COST-1 asks for cost per agreement, budgets and anomaly alerts. The first step is knowing what Theckards costs
at all, and that is not possible today: account 116708768297 also hosts other projects, and no Theckards resource
carried a tag, so no line of the bill could be attributed to it.

## Decision

1. Tag every resource in the application stack with `Project=theckards` and `Environment=<env>`. The
   AppConfig deployment is excluded: it is not billed, and `cdk diff` showed that tagging it forces a replacement
   that re-deploys the feature flags.
2. One AWS Budgets cost budget, scoped to `user:Project$theckards`, at **US$200 per month**, with an email on
   forecast above 100 % and again on actual above 100 %.
3. The budget measures **gross usage**: `includeCredit: false` and `includeRefund: false`.

## Why gross usage

AWS Activate credits pay the bill today. CloudFormation's documented default for `IncludeCredit` is `true`, so a
default budget subtracts the credits, reads about US$0, and never fires. It would look like a working control and
be none. Gross usage is the rate at which the credits are being consumed, and it is the real bill the day they run
out, so it is the number worth watching in both phases.

## The baseline, verified

Unit prices below come from the AWS Pricing API on 2026-11-11 (us-east-1, on demand). Quantities come from the
running account. A month is 730 hours.

| Item | Unit price | In use | Per month |
| --- | --- | --- | --- |
| Web task, 1 vCPU and 2 GB | $0.04048 per vCPU-hour, $0.004445 per GB-hour | 1 | $36.04 |
| NAT gateway | $0.045 per hour | 1 | $32.85 |
| RDS PostgreSQL db.t4g.small, single-AZ | $0.032 per hour | 1 | $23.36 |
| Worker task, 0.5 vCPU and 1 GB | as above | 1 | $18.02 |
| Application Load Balancer | $0.0225 per hour, plus $0.008 per LCU-hour | 1 | $16.43 + LCU |
| WAF on CloudFront | $5 per web ACL, $1 per rule | 1 ACL, 7 rules | $12.00 |
| Public IPv4 addresses | $0.005 per hour | 3 | $10.95 |
| Secrets Manager | $0.40 per secret | 6 | $2.40 |
| RDS gp3 storage | $0.115 per GB-month | 20 GB | $2.30 |
| CloudWatch standard alarms | $0.10 per alarm metric | 21 own + 4 autoscaling | $2.50 |
| CloudWatch composite alarms ([ADR-023](023-slos-and-burn-rate.md)) | $0.50 per alarm | 2 | $1.00 |
| CloudWatch custom metric series | $0.30 per metric | up to 8 (retention + 7 SLO gauges) | up to $2.40 |
| CloudWatch SLO dashboard | $3.00 after the first three account-wide | fifth dashboard in the account | $3.00 |
| CloudWatch PutMetricData | $0.01 per 1,000 above the account allowance | about 43,800/month | up to $0.44 |
| Route 53 health check over HTTPS ([ADR-021](021-external-availability-check.md)) | $1.00 to $2.75 | 1 | $1.00 to $2.75 |
| KMS customer-managed keys | not returned by the Pricing API; about $1 per key | 3 | about $3 |
| **Fixed baseline** | | | **about $167 to $170** |

Usage on top is small at today's traffic: ALB capacity units, NAT data processing, CloudWatch Logs, ECR storage
(5.2 GB, about $0.52), S3, CloudFront requests and Cognito, which is inside its free tier. Call the month
**about US$172 to $183**.

AWS Budgets itself is free for a budget without actions: the Pricing API lists `BudgetsUsage` at $0.00 per
budget-day. Only action-enabled budgets are billed, and this one has no actions.

## Why US$200, and what it will and will not catch

The limit sits about 9 to 16 % above a normal month, so a normal month never alerts and an alert always means
something changed. A first draft used US$150 with an actual alert at 80 %. Against this baseline it would have
fired every month, and an alarm that always fires teaches people to ignore the channel that works.

It catches sustained scale-out (the web service may grow to 4 tasks, about $36 each per month, and the worker to
3), runaway NAT or log traffic, and a new always-on resource of meaningful size.

It will **not** catch a single forgotten `db.t4g.small` restore instance, at about $26 a month. That is why the
restore runbook ends with an explicit deletion step, and why the threshold should be revisited once a month of
tagged bills exists. Set `monthlyBudgetUsd` from the real figure then, not from this estimate.

## Simpler alternative

A budget on the whole account. Rejected: it measures the other projects as much as this one, so its alerts say
nothing about Theckards.

## Not done

Cost per agreement needs a month of tagged costs and a count of agreements for the same month, so it waits for
the data. Cost Anomaly Detection is free and worth adding as a second signal once tagged costs exist to model.

## Operational risk

**Tags are not retroactive and activation is manual.** The `Project` key has to be activated once under Billing,
Cost allocation tags, and it only appears there after AWS has seen tagged usage, which can take a day. Until
then the budget reads zero. That is expected, not a fault, and the launch checklist tracks it.

**The base stack is untagged.** The ECR repositories, the hosted zone and the certificate live in `TheckardsBase`
and cost about a dollar a month together, so they are left out rather than widening this change to a second
stack.
