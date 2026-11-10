# Devpost submission draft

Copy for the Kiroween submission form. Everything here is checkable against the repository or the running
service; keep it that way when you edit it.

---

## Project name

Theckards

## Elevator pitch (one line)

Two people standing next to each other close an agreement by pressing a cryptographic wax seal: in-person signing
with a single-use QR code, a KMS-signed integrity receipt, and a sealed PDF anyone can verify without an account.

## Category

**Resurrection** — the obsolete technology is the wax seal and the signet ring.

## Try it out

| | |
| --- | --- |
| Live service | https://theckards.linkealls.com |
| Verify a record, no account | https://theckards.linkealls.com/verify |
| How to verify offline | https://theckards.linkealls.com/verify/how |
| Repository | https://github.com/KevinSsteve/theckards |
| License | Apache-2.0 |
| Kiro write-up | [`docs/kiro-usage.md`](kiro-usage.md) |
| Kiro artifacts | [`/.kiro`](../.kiro) — 11 specs, 3 steering documents, 2 agent hooks |

---

## About the project

### The dead technology

For centuries a wax seal and a signet ring were how two people closed an agreement in the same room. It worked
for three reasons: breaking the wax showed tampering, only the holder of the signet could press the mark, and
anyone could recognise it. The practice died. What replaced it, for two people standing next to each other,
is an emailed link and a request to trust it.

### What Theckards does

Theckards keeps all three properties of the seal and gives each of them to a modern primitive:

| Wax seal and signet | Theckards |
| --- | --- |
| Breaking the wax reveals tampering | Changing one byte makes verification fail (SHA-256) |
| Only the signet holder can press the mark | A private key that never leaves AWS KMS (ECDSA P-256) |
| Anyone could recognise the mark | A published public key, plus a seal impression printed on the document |
| Sealed in person, before witnesses | A single-use QR code and a six-digit code exchanged between two devices |

The flow, end to end: pick a template and enter only the facts; both parties sign the exact document they can
read, with explicit consent recorded; a worker renders a deterministic PDF, hashes it, and KMS signs an integrity
receipt; the sealed file carries a wax impression pressed from the seal identifier. Anyone can then drop that file
on `/verify`, where the browser hashes it locally and never uploads it.

The impression is a pure function of the seal identifier, shared by two renderers: the PDF worker draws it with
`pdf-lib` and the verification page draws the same geometry as SVG. A test decompresses the generated PDF and
asserts the printed polygon is exactly the 24 vertices the function returns, so the mark on paper and the mark on
screen cannot drift apart.

After signing, the record keeps going: each party can declare their own confirmations ("I received it", "I paid"),
exchange messages, attach evidence files that are scanned for malware before they are ever stored, and open a case
where each side states its view and proposes a resolution. A resolution exists only as an addendum both parties
accept and sign, sealed the same way as the original.

Either party can then export the whole record as a **dossier**: one archive holding the sealed documents and
their receipts, every version of the terms, the signatures, the declarations, the messages, the evidence and any
case. Every file is listed in `manifest.json` with its SHA-256, and the archive is itself sealed, so its own hash
sits in a signed receipt. A reader with nothing but the file, `sha256sum` and `openssl` can confirm all of it;
`scripts/verify-dossier.mjs` does the same automatically and imports none of the application's code.

### What it deliberately refuses to do

The product has eleven non-negotiable guardrails in [`.kiro/steering/product.md`](../.kiro/steering/product.md),
and the refusals are the design:

- It never receives, holds, converts or transmits money between the parties. No wallets, no balances, no escrow.
- It never decides who is right. "Confirmed by both" is derived on read, never stored, and a property test proves
  one party alone can never reach it, for every template, role and payment combination.
- It makes no claim of guarantee, payment protection or legal validity, and gives no legal advice. The wording is
  "verifiable record", "integrity receipt", "recorded electronic signature".
- It holds no payment data from the parties, and never rates, scores or ranks a person.

### How Kiro built it

The full write-up is in [`docs/kiro-usage.md`](kiro-usage.md). The short version: specs, steering, vibe coding,
agent hooks, MCP and Powers, with the steering documents doing most of the work.

- **11 specs** (S1–S11), each with requirements written as testable statements before any code existed.
- **3 steering documents** applied to every session, which produced three concrete outcomes:
  - *An architecture decision record before every AWS service*, with its fixed monthly cost and the simpler
    alternative. Result: **20 ADRs** and a deliberately cheap architecture. RDS single-AZ instead of Aurora;
    in-person QR signing instead of email after Amazon SES denied production access; GuardDuty Malware Protection
    for S3 in independent mode at US$0 per month instead of an always-on ClamAV task.
  - *Legal text cannot ship as a draft.* This became a server-side guard that rejects approval while placeholder
    markers remain. Asked to "approve the legal texts", Kiro refused to approve empty placeholders.
  - *Guardrails became assertions,* not comments: one test proves silence is never consent, another asserts the
    user-facing wording never contains "verified", "guarantee", "protected", "breach" or "winner".
- **2 agent hooks**: the pure-domain test suite runs when domain logic changes, and editing the migration file
  prompts a check that it was only appended to, never rewritten.

### Challenges

- **Amazon SES denied production access**, which removed the email channel the signing flow was built on. Rather
  than appeal and wait, the flow was redesigned around in-person QR signing, which turned out to fit the product
  better: the counterparty needs no account at all.
- **A silently mutable seal.** A retried sealing job re-rendered the PDF and overwrote the stored file, so any
  later change to the renderer would have broken every earlier record's verification. Sealing now refuses to
  regenerate an existing seal.
- **Sessions outliving their account.** Disabling a Cognito user left application sessions working; sessions are
  now revalidated against Cognito every five minutes.
- **Six unfixed high-severity CVEs** in the Debian base image. Two candidate bases were built and scanned before
  switching to Alpine with an OS package upgrade. Both production images now scan with zero findings.
- **A broken attempt limit.** The wrong-code path of in-person signing failed with a PostgreSQL type error that
  rolled back the transaction and silently disabled the five-attempt limit. Found in a production end-to-end run,
  reproduced against the real database, fixed, and covered by a regression test.

### What is next

Entitlements and billing (S7), a trust profile built only from counts with visible provenance (S10), and the AI
assistant (S9), which is specified to fill schema fields only — never to write clauses, sign, or decide a case,
and to receive masked text that is never stored.

---

## Built with

`typescript` · `next.js` · `node.js` · `postgresql` · `aws-cdk` · `amazon-rds` · `amazon-ecs-fargate` ·
`amazon-s3` · `amazon-sqs` · `aws-kms` · `amazon-cognito` · `amazon-guardduty` · `aws-waf` · `pdf-lib` ·
`vitest` · `playwright` · `kiro`

---

## How judges can test it

**No account needed (30 seconds).** Open https://theckards.linkealls.com/verify and paste this SHA-256 of a
record sealed in production:

```
3d4a6a935d18b8d870a8e05605547406d3cd9f4ef5d0b312a6adc430199da5ab
```

It returns a valid seal, sealed 2026-11-10, and draws that seal's impression. Change the last character and it
returns "No matching seal". `/verify/how` shows how to check the receipt signature offline with OpenSSL and the
key published at `/.well-known/theckards-keys.json`.

**The full flow (5 minutes, one account).** Sign up, accept the legal documents, create an agreement from a
template, sign it, press **Show QR code**, then open that QR link in a second browser profile as the other party.
Sign there, read the six-digit code it shows, type that code on the first screen. The agreement executes, and both
parties download the same sealed PDF byte for byte.

**Locally.**

```sh
pnpm install
pnpm lint && pnpm -r typecheck && pnpm test   # 124 tests
```

Infrastructure is AWS CDK with cdk-nag; stateful resources are RETAIN and there are no manual steps.
