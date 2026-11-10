# ADR-018 — Phase 1: in-person QR signing, no email delivery

Status: Accepted (2026-11-10)

## Requirement
Amazon SES denied production access (case 179429657400653), so email invitations, codes and receipts cannot reach arbitrary addresses. Phase 1 is for two people standing next to each other (service contract or sale of goods). The owner asked to drop email and sign in person via QR code.

## Decision
- Feature flag `EMAIL_DELIVERY_ENABLED` (AppConfig/`app_settings.feature_flags`, Admin dashboard), default **false**. While off, every email path (invite, guest OTP, receipt emails) is rejected or skipped.
- Creator signs from the signed-in account (`verification_method = ACCOUNT_SESSION`; Cognito verified the email at sign-up).
- Creator shows a single-use QR (`/s/{token}`, 15 min, only `HMAC(token)` stored, any previous session cancelled).
- Counterparty scans, reviews (text + exact PDF), types name, consents and signs on their own device. That device is bound with `__Host-theckards_device` (httpOnly, SameSite=Strict; only its HMAC is stored) and shows a 6-digit code (10 min, HMAC stored).
- The creator types the code on their own screen (max 5 attempts, then the session is cancelled). Then the counterparty signature is recorded with `verification_method = IN_PERSON_QR` and `confirmed_by_party_id = creator`, the agreement executes and is sealed.
- The bound device can claim, once and within 2 h of completion, a 2-hour guest session to download the sealed PDF. The creator downloads from their account.
- Requires approved v2 of TERMS, PRIVACY and ESIGN (`IN_PERSON_MIN_LEGAL_VERSION = 2`); migration 0007 creates them as DRAFT derived from approved v1. The owner approves them in Admin → Legal.
- The start endpoint is not stored by the idempotency layer, because its response carries the QR secret. Retrying it simply opens a new session and cancels the old one.

## Estimated fixed monthly cost
US$0 (no new AWS service).

## Simpler alternative
Show the email-link QR and keep email OTP. Rejected: it needs SES production access. A second option was a typed name only, with no cross-confirmation. Rejected: anyone who photographs the QR could sign from elsewhere. The code shown on the signing device and typed by the creator proves the creator saw the device that signed.

## Operational risk
- Counterparties without an account keep only the copy they download during the session. The ESIGN v2 disclosure says so, and paper or email copies are available on request via support@.
- None of these methods is strong identity verification (the certificate and Terms say so; G3).
- Re-enabling email later is only the flag plus SES production access; the guest email flow remains in code behind the flag.
