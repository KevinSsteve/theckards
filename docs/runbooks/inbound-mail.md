# Inbound mail (@theckards.linkealls.com)

- MX `theckards.linkealls.com` → `inbound-smtp.us-east-1.amazonaws.com`; active SES receipt rule set `theckards-prod-inbound` (spam/virus scan on, TLS required).
- Messages are stored in `s3://theckards-prod-inbound-mail-<account>/inbox/` (private, SSE-S3, deleted after 30 days). There is no mailbox UI and no forwarding yet.
- Read a message (operators only): `aws s3 ls s3://theckards-prod-inbound-mail-116708768297/inbox/` then `aws s3 cp s3://…/inbox/<id> -`. Never paste codes or passwords into tickets or chat.
- While SES is in the sandbox, sending to any address on this verified domain works, which enables end-to-end tests with throwaway addresses such as `buyer-test@theckards.linkealls.com`.
- Note: the SES active receipt rule set is account-wide. This account had none active before; another project must not replace it without coordination.

# Owner bootstrap (done 2026-11-10 for kevin@theckards.linkealls.com)

1. `admin-create-user` (email verified, temporary password, message suppressed) and `admin-add-user-to-group admins`.
2. Worker one-off task `node dist/register-owner.js` with `OWNER_EMAIL` and `OWNER_COGNITO_SUB` (creates `users` + `admin_users(OWNER)`).
3. Owner signs in at `/api/auth/login?intent=admin`, sets a new password, enrols TOTP at `/admin/mfa`, signs in again.
