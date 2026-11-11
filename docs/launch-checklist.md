# Launch checklist

The S8 acceptance criterion is that every pillar here is verified **with evidence**, not asserted. So each row
says how it was checked and on what date, and the rows that are not done say so plainly. A checklist that marks
itself green is worth nothing.

Verified against production on 2026-11-11 unless stated otherwise. Account 116708768297, us-east-1,
https://theckards.linkealls.com.

## Done, with evidence

| Requirement | Evidence |
| --- | --- |
| Infrastructure entirely in CDK, stateful resources RETAIN, no manual steps | `infra/` with cdk-nag; every deploy in this project went through `cdk deploy`. RDS shows `DeletionProtection: true`. |
| Database encrypted, backups retained | `aws rds describe-db-instances`: `StorageEncrypted: true`, `BackupRetentionPeriod: 14`, latest restorable point minutes old. Single-AZ by [ADR-002](adr/002-database.md). |
| **ALB unreachable outside CloudFront** (R-SEC-3, part) | ALB security group ingress is 443 from the CloudFront origin-facing prefix list `pl-3b927c52` only, with no CIDR rules. A direct request to the ALB DNS name times out (curl exit 000). |
| WAF in front of the edge | `theckards-prod-waf` on the CloudFront scope ([ADR-006](adr/006-waf.md)). |
| Admin surface restricted | `/admin` and `/api/admin/*` require the Cognito `admins` group with MFA and a separate ADMIN session cookie ([ADR-015](adr/015-admin-mfa.md)); audited in `audit_logs`. |
| Every route authorizes by resource, with an IDOR test | Enforced by a build gate: every server module that authorizes through `member()` must ship a test naming IDOR, exercising an outsider and asserting 404. Verified to fail when a module without a test is added. |
| Production build fails on unfinished legal text (R-LEG-6, build half) | `Dockerfile.web` runs `pnpm lint && pnpm -r typecheck && pnpm test`, and the suite composes every legal version the way the migrations do, requires each replacement to match exactly once, and rejects placeholders. Verified to fail when a placeholder is injected. |
| Legal texts approved by the owner | TERMS v2, PRIVACY v4, ESIGN v3, NOTICE v1 all `APPROVED`; v1–v3 predecessors `RETIRED`. No stored document contains a `[TO COMPLETE:` marker. |
| Retention matches what the Privacy Policy promises (R-PRV-1, part) | Policy section 6 checked row by row against the database: completed in-person sessions have `code_hash` cleared, no expired invite still holds a token hash, CloudWatch log groups are 90 days, RDS backups 14 days, S3 lifecycle expires noncurrent versions at 90 days and the quarantine bucket at 7. |
| Only essential cookies, no analytics carrying content | Cookies are `__Host-` prefixed session, CSRF, device and guest-session only; no analytics dependency in `apps/web/package.json`. |
| No personal data in logs | Job failures mask addresses before logging; the one place IP and user agent exist is field-encrypted and never exported, including in the dossier. |
| Images scanned, zero findings | ECR scan on every deployed tag; `theckards-web` and `theckards-worker` at the current tag both return empty severity counts. |
| Public verification works without an account | `/verify` hashes locally; valid hash returns the seal, one character changed returns no match. Checked for all three kinds: FINAL, ADDENDUM, DOSSIER. |
| Dossier verifies itself | `scripts/verify-dossier.mjs`, which imports none of the application code, passes all eight checks against a dossier built in production, including the ECDSA signature against the published key. |
| Alarms reach a person (R-OPS-1) | **Fixed on 2026-11-11.** Ten alarms existed and the topic they publish to had zero subscribers, so nothing could ever be delivered. The stack now refuses to synthesize without a destination. See [alerts-not-delivered](runbooks/alerts-not-delivered.md). |
| A runbook for each predictable failure | 18 runbooks in [`docs/runbooks/`](runbooks/); each alarm's description names its runbook file. |
| Decision records | 20 ADRs in [`docs/adr/`](adr/), each with the fixed monthly cost, the simpler alternative and the operational risk. |

## Not done, and what it would take

| Requirement | Status |
| --- | --- |
| R-OPS-2 SLOs with burn-rate alarms | Not defined. The ten alarms are threshold alarms on symptoms (5xx, queue age, DLQ depth, CPU, storage), not error-budget burn rates. Needs the SLOs written down first; a burn-rate alarm on an undefined objective is theatre. |
| R-OPS-3 Canary every 5 minutes | Not built. CloudWatch Synthetics is not free: roughly US$0.0012 per run, about US$10/month at a five-minute cadence, so it needs an ADR on whether that is worth it before go-live. |
| R-OPS-5 Load test at 3× target, measured RTO/RPO | Not done. No k6 run, and no restore has been rehearsed, so the RTO and RPO in [ADR-009](adr/009-rto-rpo.md) are design targets rather than measurements. A restore drill into a throwaway instance is the next step and costs only the instance hours. |
| R-A11Y-1 WCAG 2.2 AA, Lighthouse CI | Not verified. The UI is plain semantic HTML with labelled inputs and `aria-live` on the polling regions, which is a good start, but no axe or Lighthouse run has been recorded. |
| R-SEC-3 DAST (ZAP) | Not run. |
| R-EML-1 SES out of sandbox, DKIM/SPF/DMARC, bounce suppression | **Blocked by AWS.** SES production access was denied, so email delivery is off (`EMAIL_DELIVERY_ENABLED=false`) and signing happens in person by QR code instead ([ADR-018](adr/018-in-person-qr-signing.md)). Bounce and complaint alarms exist and are wired. |
| R-ABU-1 Report button, account suspension | Not built. Rate limits and WAF rules are in place; the user-facing report flow and suspension are S11 T11.7. |
| R-COST-1 Cost per agreement, budgets, anomaly detection | Not done. No resource tags exist yet, so a budget cannot be scoped to Theckards in an account shared with other projects. Needs stack-wide tagging, cost allocation tag activation (about 24 hours to take effect), then a budget and an anomaly monitor, both free at this scale. |
| R-PRV-1 Bedrock retention and training terms reviewed | Not applicable yet: no model agreement is accepted for this account, so Bedrock is unreachable and the AI assistant (S9) is not built. Review before enabling it. |
| Retention sweeper job | Not built, and not yet needed: nothing is accumulating on a service this young, and every promise the policy makes is currently kept. Needed before volume arrives. |

## Before switching on sign-ups

1. **Confirm the alarm subscription.** AWS emails a confirmation link to the operator mailbox; until it is
   opened, `SubscriptionArn` reads `PendingConfirmation` and no alert is delivered. Check with the command in
   [alerts-not-delivered](runbooks/alerts-not-delivered.md).
2. **Rehearse a restore.** Until a backup has been restored once, the recovery plan is untested.
3. **Decide on the canary** with an ADR, since it is the first item here with a recurring cost.
4. **Tag the stack and set a budget**, so spend is attributable in an account that hosts other projects.
