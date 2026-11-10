# ADR-017 — Receipt sealing with KMS ECDSA P-256

Status: Accepted (2026-11-10)

## Requirement
Every final document gets a receipt (id, SHA-256, time, Theckards signature) that anyone can verify offline with a published public key (R-SEAL-1, sec. 8.2).

## Decision
- Worker renders the final PDF (contract + signature certificate + QR to `/verify?seal=`), deterministically: the seal id is derived from `sha256("theckards-seal:FINAL:{agreement}:{version}")` and `sealed_at` is the time of the last signature, so retried jobs produce the same bytes and hash.
- The signed payload is the RFC 8785 canonical JSON of `{id, kind, sha256, content_sha256, sealed_at}`. KMS `Sign` uses `ECDSA_SHA_256`, `MessageType=RAW`; the signature is DER, base64 in the receipt.
- ECDSA signatures are randomized, so the first committed `sealed_documents` row is authoritative; the S3 `receipt.json` is always written from that row.
- Public keys are served at `/.well-known/theckards-keys.json`. Rotation adds a new key ARN; old keys stay published.
- Free plan watermark ("THECKARDS FREE") is applied to every final document until billing (S7) introduces entitlements.

## Estimated fixed monthly cost
About US$1 per asymmetric KMS key plus per-request signing charges (see current KMS pricing).

## Simpler alternative
HMAC receipts. Rejected: only Theckards could verify them.

## Operational risk
Losing the KMS key would prevent new seals but not verification of old ones (public key is published). The key has RETAIN and no scheduled deletion.

## Offline verification
```
openssl dgst -sha256 sealed.pdf                      # must equal receipt.sha256
# payload = canonical JSON of the five fields, e.g. built with any RFC 8785 library
echo -n "$PAYLOAD" > payload.json
base64 -d sig.b64 > sig.der
openssl dgst -sha256 -verify theckards-public.pem -signature sig.der payload.json
```
