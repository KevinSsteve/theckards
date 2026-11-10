# ADR-015 — MFA for administrators

Status: Accepted (2026-11-10)

## Requirement
Administrators must use TOTP MFA without forcing every product user to enroll in MFA.

## Decision
Keep user-pool MFA optional, enable software-token MFA, and require administrators to enable TOTP as their preferred factor. The BFF creates an ADMIN session only when the Cognito account has `SOFTWARE_TOKEN_MFA`; when `amr` is present in the ID token it must also include `otp` or `mfa`. Cognito managed login then performs the TOTP challenge. The `admin_users` database allow-list is checked in addition to the Cognito group.

## Estimated fixed monthly cost
No additional fixed charge on the existing Cognito Essentials user pool.

## Simpler alternative
Require MFA for the whole user pool. Rejected because it adds friction to every ordinary user.

## Operational risk
AWS notes that ACR/AMR token claims are rolling out and may not be present in every pool. The BFF therefore also verifies the account's configured MFA settings. An administrator without TOTP cannot receive an ADMIN session.

## Sources
- [Adding MFA to a user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html)
- [TOTP software token MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [Authentication levels with ACR and AMR claims](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-step-up-authentication.html)

Content was rephrased for compliance with licensing restrictions.
