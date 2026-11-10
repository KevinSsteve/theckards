# Runbook — web target 5xx

Signal: `theckards-prod-target-5xx`.

1. Check ECS service health and recent deployment events. If the deployment circuit breaker rolled back, inspect the new task logs and keep the last healthy revision.
2. In `/theckards/prod/web`, group errors by request ID and exception name. Logs must not contain personal data, tokens or secrets.
3. Test `/healthz` and `/readyz`. Readiness failures usually indicate database or required AWS dependency access.
4. For route-specific failures, follow the matching runbook: authentication, AppConfig, PDF/seal, in-person signing, or public verification.
5. Roll back through CDK if a release caused the errors. Do not change ECS, IAM, database or secrets manually.
