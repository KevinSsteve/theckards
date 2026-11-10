# Outbox or jobs queue stalled

1. Check `theckards-prod-jobs-age`, `theckards-prod-jobs-dlq`, ECS worker health and `/theckards/prod/worker`.
2. Count unpublished rows in `outbox` and inspect only topic/technical IDs; payloads may contain encrypted invitation material and must not be logged.
3. Restore worker database/SQS connectivity. The publisher uses `FOR UPDATE SKIP LOCKED` and marks a row only after SQS accepts it.
4. Redrive the DLQ after fixing the handler. Consumers skip rows already recorded in `processed_jobs` and handlers must remain idempotent.
5. Clean `outbox` rows older than seven days only after `published_at` is set and the corresponding job is confirmed.
