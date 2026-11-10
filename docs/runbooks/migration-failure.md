# Database migration failure

1. Stop the release before switching ECS services to the application DB role.
2. Read the stopped migration task reason and logs; do not print database credentials.
3. Confirm RDS is `available`, the task runs in private subnets and its security group can reach port 5432.
4. Migrations use a PostgreSQL advisory lock and one transaction per migration. Correct the failing forward migration; do not edit an already-applied migration.
5. Re-run the migration task. Verify `schema_migrations` and application readiness before continuing deployment.
6. For destructive recovery, create and verify a snapshot first and obtain owner approval.

## Successful one-off task status
ECS reports `EssentialContainerExited` for a task that is designed to terminate. Treat the run as successful only when `containers[0].exitCode` is `0` and the migration log says `database migrations complete`. Do not classify the stop code alone as a failure.
