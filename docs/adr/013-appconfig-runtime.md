# ADR-013 — Runtime configuration with AWS AppConfig

Status: Accepted (2026-11-10)

## Requirement
Feature flags must change without an application deployment, with a controlled production rollout and an audit trail.

## Decision
Keep business settings in PostgreSQL and deploy the `feature_flags` setting to the existing AWS AppConfig hosted configuration. Production uses `AppConfig.Linear50PercentEvery30Seconds`; non-production uses `AppConfig.AllAtOnce`. CloudFormation owns the application, environment, profile and seed version. The Admin dashboard owns later hosted versions and deployments. CDK must not change the seed payload after launch.

## Estimated fixed monthly cost (us-east-1)
No material fixed charge; AppConfig charges configuration requests and hosted configuration operations according to current AWS pricing.

## Simpler alternative
Read every flag from PostgreSQL. Rejected because it has no managed rollout or automatic rollback behavior.

## Operational risk
A CDK change to the seed version can redeploy stale values over an Admin-created version. Mitigation: keep the seed immutable, persist the source value and version in PostgreSQL, and audit every Admin deployment.

## Sources
- [AWS AppConfig overview](https://docs.aws.amazon.com/appconfig/latest/userguide/)
- [Deploying feature flags](https://docs.aws.amazon.com/appconfig/latest/userguide/deploying-feature-flags.html)

Content was rephrased for compliance with licensing restrictions.
