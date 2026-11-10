# Runbook — public verification failure

Signals: user reports from `/verify`, `theckards-prod-target-5xx`, `theckards-prod-cdn-5xx`, or WAF `RateLimitPublicVerify` blocks.

1. Check `/healthz` and `GET /api/public/verify/{known-hash}`. The expected response is HTTP 200 with only `valid`, `kind`, `sealed_at`, `seal_id`, and `anchored`.
2. Check `/theckards/prod/web` logs by request ID. Never log the PDF, filename, receipt, party data or caller IP.
3. If all hashes return false, query the immutable `sealed_documents.sha256` index through an approved production diagnostic task. Do not expose agreement metadata.
4. If browsers cannot hash files, verify that the current `/_next/static/` assets load and that the deployed image digest matches the release.
5. If the key endpoint fails, check KMS `GetPublicKey` permission and key state. Do not replace or delete the retained sealing key. Hash lookup can remain available while key publication is repaired.
6. WAF blocks are expected above the public rate threshold. Investigate only sustained spikes; do not whitelist arbitrary IPs.
