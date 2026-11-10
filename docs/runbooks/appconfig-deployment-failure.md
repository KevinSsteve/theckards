# AppConfig deployment failure

1. Keep the previous deployed flag version active; do not redeploy an unvalidated payload.
2. Compare the PostgreSQL `feature_flags` setting/history with the active AppConfig hosted version.
3. Correct validation or IAM errors and start a new deployment with the production linear strategy.
4. If a flag causes errors, stop or roll back the AppConfig deployment and record the action in `audit_logs`.
5. Dangerous flags (`ANCHOR_ENABLED`, `PUBLIC_PROFILE_ENABLED`) remain off unless their launch checklists are complete.
