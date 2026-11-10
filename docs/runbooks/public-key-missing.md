# Runbook — public sealing key unavailable

Signal: `theckards-prod-target-5xx` or reports that `/.well-known/theckards-keys.json` returns 5xx. The public verification hash lookup can remain available while this is repaired.

1. Request `/.well-known/theckards-keys.json` and record the `x-request-id`; do not copy receipts or party data into tickets.
2. In `/theckards/prod/web`, locate the request ID. Expected technical causes are KMS access denied, a disabled key, or a bad `SEAL_KEY_ARN` task configuration.
3. Check the retained KMS seal key state. Never schedule key deletion or replace the key as a quick fix; old receipts depend on its public key.
4. Check that the web task role has `kms:GetPublicKey` and `kms:DescribeKey` on the configured seal key.
5. If a deployment supplied the wrong ARN, roll back the ECS task definition through CDK. Do not edit the service manually.
6. Verify that the endpoint returns the key ID referenced by existing receipts and that an offline receipt fixture verifies before resolving the incident.
