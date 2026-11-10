# ADR-019 — Public, privacy-preserving seal verification

Status: Accepted (2026-11-10)

## Requirement
Anyone holding a sealed PDF must be able to check whether it matches a Theckards integrity seal. The PDF and party data must not be disclosed to the public endpoint.

## Decision
- `/verify` hashes a selected file locally in 4 MiB chunks using `hash-wasm`; no file bytes or filename are uploaded.
- `GET /api/public/verify/{sha256}` receives only the digest and returns `valid`, seal kind, seal time, seal ID and anchor existence. It never returns agreement IDs, titles, names, S3 keys or receipt contents.
- Malformed and unknown digests execute the same database query and return the same HTTP status and JSON body.
- Successful public responses are cached for 60 seconds. The route is limited in the application and by a WAF IP rule.
- `/verify/how` documents independent receipt verification against the published KMS public key.

## Fixed monthly cost
US$0. This reuses the existing web service, RDS index, CloudFront and WAF. Normal request charges apply.

## Simpler alternative
Upload PDFs to the server and compare them there. Rejected because Theckards would receive potentially sensitive agreement content merely to verify integrity.

## Operational risk
Public hashes can be probed, but a SHA-256 digest is not practically guessable. Responses expose only the documented seal metadata. Rate limits reduce automated abuse. A unavailable KMS key can affect the public-key endpoint but not hash lookup; the existing target 5xx alarm covers unexpected endpoint failures.
