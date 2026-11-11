# Runbook: Theckards is unreachable

**Symptom.** The `theckards-prod-reachability` alarm fired, or https://theckards.linkealls.com does not load.

**Why this alarm is different.** Every other Theckards alarm watches a symptom in traffic and treats missing data
as healthy, which is right individually and blind in aggregate: if nothing can reach the service, no metric is
published and all ten of them stay green. This one probe, a Route 53 health check on `/healthz` every 30 seconds
from several AWS regions, is the only thing that reports an outage nobody is generating errors against. It treats
missing data as breaching on purpose ([ADR-021](../adr/021-external-availability-check.md)).

## 1. Confirm it from outside, and locate the layer

Work outwards in, because the probe only tells you the edge did not answer.

```sh
# Does the name resolve, and to CloudFront?
dig +short theckards.linkealls.com

# Does the edge answer, and with what?
curl -sS -o /dev/null -w 'edge: %{http_code} tls=%{ssl_verify_result} time=%{time_total}s\n' https://theckards.linkealls.com/healthz

# Certificate expiry, a classic silent outage
echo | openssl s_client -servername theckards.linkealls.com -connect theckards.linkealls.com:443 2>/dev/null | openssl x509 -noout -dates
```

| What you see | Where the fault is |
| --- | --- |
| No answer from `dig` | DNS. Check the hosted zone and that the alias record for the subdomain still points at the distribution. |
| `dig` resolves, `curl` hangs or refuses | CloudFront or the certificate. Check the distribution is `Deployed` and enabled. |
| `curl` returns 403 with a short body | WAF is blocking. Check the web ACL rules and whether a rate rule now catches the health checker. |
| `curl` returns 502/503/504 | The edge is up and the origin is not. Continue at step 2. |
| `curl` returns 200 | The outage has passed, or the probe is blocked while real clients are fine. Check the health check's own status before standing down. |

```sh
aws cloudwatch get-metric-statistics --namespace AWS/Route53 --metric-name HealthCheckStatus \
  --dimensions Name=HealthCheckId,Value="$(aws route53 list-health-checks --query 'HealthChecks[?HealthCheckConfig.FullyQualifiedDomainName==`theckards.linkealls.com`].Id' --output text)" \
  --start-time "$(date -u -d '30 min ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" --period 60 --statistics Minimum \
  --query 'Datapoints[*].[Timestamp,Minimum]' --output text | sort
```

## 2. Origin side

```sh
aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-web \
  --query 'services[0].{desired:desiredCount,running:runningCount,rollout:deployments[0].rolloutState}'

aws elbv2 describe-target-health --target-group-arn \
  "$(aws elbv2 describe-target-groups --query 'TargetGroups[?starts_with(TargetGroupName, `Theck`)].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[*].TargetHealth.State'
```

No running tasks, or all targets unhealthy, means the application is failing to start or failing its health
check. Read the last minutes of `/theckards/prod/web`, then follow [target-5xx](target-5xx.md).

If the tasks are healthy and the edge still fails, suspect the path between them: the ALB security group allows
only the CloudFront origin-facing prefix list, so a change to that rule, or CloudFront's prefix list, breaks the
origin while everything looks individually fine.

## 3. If the probe is wrong rather than the service

A false outage is possible and must not be dismissed quickly. The usual cause is the WAF rate limit catching the
checker, which arrives from many AWS addresses. Confirm by looking for blocked requests to `/healthz` in the WAF
logs before relaxing anything, and prefer excepting the checker over raising a limit that protects the service.

## What this alarm will not tell you

That signing works, that documents are being sealed, or that the queue is draining. It answers one question,
reachability, and it answers it when nothing else can. The deeper flow is deferred until there is a staging
environment to exercise it against, for the reasons in [ADR-021](../adr/021-external-availability-check.md).
