# ADR-014 — Admin code in the web service

Status: Accepted for M1 (2026-11-10)

## Requirement
The owner needs one dashboard while the application remains simple and authorization failures cannot expose administrative actions.

## Decision
Keep `/admin` and `/api/admin/*` in the existing Next.js BFF. Every Admin handler uses the shared route wrapper, requires a dedicated ADMIN session, Cognito `admins` membership, a live `admin_users` allow-list row and TOTP MFA. PostgreSQL settings/legal changes are available in M1. Integration secrets remain unavailable until a separate write-only broker or service can enforce that the Admin route cannot read them.

## Estimated fixed monthly cost
US$0 additional for M1.

## Simpler alternative
Give the whole web task role read/write access to all Secrets Manager values. Rejected because a route-level convention cannot enforce write-only access at the IAM boundary.

## Operational risk
An RCE in the web service can reach the PostgreSQL administrative APIs granted to the task. Mitigation: least-privilege DB role, resource-level authorization, MFA, CSRF, audit log, WAF rate limits and later extraction of secret management into an isolated component.
