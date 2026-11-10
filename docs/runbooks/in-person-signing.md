# Runbook — in-person QR signing failures

Signals: `theckards-prod-target-5xx` alarm (503 "Signing unavailable"), or user reports. Logs: `/theckards/prod/web` (no PII, no tokens or codes are logged).

## 1. "In-person signing opens after the updated legal documents (version 2) are approved" (503)
Cause: TERMS, PRIVACY or ESIGN v2 is not APPROVED.
1. Admin → Legal: open each v2 draft, complete any `[TO COMPLETE:` marker, approve (owner, MFA). Approval is audited.
2. Signed-in users are asked to re-accept the documents on their next action (`/legal/consent`).

## 2. "Creator signature required" / "Already signed" (409)
Expected: the creator must sign first. The QR is offered only until the counterparty signs the current version.

## 3. Counterparty sees "QR code unavailable"
Causes: QR older than 15 min, already claimed by another device, the agreement was edited (new version), cancelled, or 5 wrong codes.
Action: creator presses **Show a new QR code**. Nothing to repair. The old session is cancelled automatically.

## 4. "Wrong code" / "Too many attempts" / "Code expired"
- Wrong code: the creator retypes the code from the counterparty's screen (5 attempts).
- Expired (10 min) or too many attempts: counterparty signs again on the same device for a new code, or the creator shows a new QR.

## 5. Sealed PDF not appearing ("being generated…" for more than 1 min)
See `seal-failure.md` and `outbox-stalled.md`. The counterparty device keeps polling; the download stays claimable for 2 h after completion.

## 6. Counterparty lost their copy
Without an account, the counterparty can download only on the signing device, once, within 2 h. Afterwards the creator downloads the sealed PDF from their account and hands it over. Any copy can be checked against the seal. Paper copies are available on request (ESIGN v2 §4).

## 7. Abuse of public QR endpoints (429 spikes)
Public `/api/in-person/*` routes are rate-limited per IP. Tokens are 256-bit and expire in 15 min. No action is needed unless WAF metrics show a flood (see ADR-006).
