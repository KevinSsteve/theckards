# How Kiro built Theckards

Theckards was built with Kiro from an empty directory to a running production system on AWS. This document
records which Kiro features were used and, more importantly, where they changed the outcome.

Everything judges need to verify this is in [`/.kiro`](../.kiro): 11 specs and 3 steering documents.

## Kiro features used

| Feature | How it was used |
| --- | --- |
| **Specs** | 11 specs (S1–S11) in [`.kiro/specs`](../.kiro/specs), each with `requirements.md`, `design.md` and `tasks.md`. Requirements were written as testable statements (`R-CONF-4`, `R-DSP-3`) before any code, and tasks are checked off as they ship. |
| **Steering** | 3 always-on documents in [`.kiro/steering`](../.kiro/steering): product guardrails, tech rules and the production definition of done. They applied to every session without being restated. |
| **Vibe coding** | Interactive sessions for implementation, debugging production incidents and reviewing diffs. |
| **Powers** | `playwright` for end-to-end tests against production with two browser contexts (one per device), and `github-cli` for publishing. |
| **MCP** | The Playwright MCP server provides the browser automation tools used for those production tests. |

Agent hooks were not used. The repeated checks (`pnpm lint && pnpm -r typecheck && pnpm test`, image scans,
`cdk-nag`) were run explicitly before each deploy and are documented in the steering rules instead.

## Where steering changed the outcome

Steering was not decoration. Three concrete cases:

**1. An ADR before every AWS service.** `tech.md` requires a decision record with the fixed monthly cost, the
simpler alternative and the operational risk before adopting a service. Result: [19 ADRs](adr/), and a
deliberately cheaper architecture. [ADR-002](adr/002-database.md) rejected Aurora for RDS PostgreSQL single-AZ;
[ADR-018](adr/018-in-person-qr-signing.md) replaced email delivery with in-person QR signing at zero added cost
after Amazon SES denied production access.

**2. Legal text cannot ship as a draft.** `production.md` states that the production build fails with legal texts
in draft. This became `legalApprovalBlockers` in [`packages/domain/src/legal.ts`](../packages/domain/src/legal.ts)
plus a server-side guard: approval is rejected while `[TO COMPLETE: …]` markers remain or the document is
implausibly short. When asked to "approve the legal texts", Kiro refused to approve empty placeholders and wrote
real drafts for the owner to complete instead.

**3. Guardrails became tests, not comments.** `product.md` lists eleven non-negotiables (G1–G11). Two of them are
now enforced by assertions:

- G2, never decide a case: an addendum exists only if the *other* party accepts the current proposal and both
  parties sign it. Tested in [`apps/web/src/server/cases.test.ts`](../apps/web/src/server/cases.test.ts).
- G3/G5, no guarantees or payment verification: a test asserts the user-facing wording never contains
  `verified`, `guarantee`, `protected`, `breach` or `winner`, in
  [`packages/domain/src/confirmations.test.ts`](../packages/domain/src/confirmations.test.ts).

## What spec-driven development caught

Working from specs surfaced defects that a prompt-by-prompt build would likely have shipped:

- **Silence is not confirmation** (`R-CONF-4`). The outcome of an agreement is derived on read, never stored, and a
  property test proves that one party alone can never reach "confirmed by both", for every template, role and
  payment combination.
- **A broken attempt limit.** The wrong-code path of in-person signing failed with a PostgreSQL type error, which
  rolled back the transaction and silently disabled the 5-attempt limit. Found during a production end-to-end run,
  reproduced against the real database, fixed and covered by a regression test.
- **Sessions outliving their account.** Disabling a Cognito user left application sessions working. Sessions are
  now revalidated against Cognito every five minutes.
- **Vulnerable base images.** The Debian base image carried six high-severity CVEs with no vendor fix. Two
  candidate bases were built and scanned before switching to Alpine with an OS package upgrade. Both production
  images now scan with zero findings.

## Running and testing it

Production: **https://theckards.linkealls.com** · public verification: **/verify**

Local checks:

```sh
pnpm install
pnpm lint && pnpm -r typecheck && pnpm test
```

### Verifying a sealed record (no account needed)

1. Open `/verify`.
2. Select any Theckards sealed PDF. The browser computes its SHA-256 locally; the file is never uploaded.
3. Change one byte of that PDF and try again: verification fails.
4. `/verify/how` explains how to check the receipt signature offline with OpenSSL and the published public key.

### Signing an agreement in person (two devices, or two browser windows)

1. Sign in, accept the legal documents and create an agreement from a template.
2. Sign it as the creator, then press **Show QR code**.
3. Open the QR link in a second browser profile, acting as the counterparty. Review the agreement, type a name,
   consent and sign. A six-digit code appears on that device.
4. Type that code on the creator's screen. The agreement executes and is sealed.
5. Both parties download the same sealed PDF, byte for byte, plus its receipt.

Deployment uses AWS CDK; see the [README](../README.md) and the [runbooks](runbooks/).
