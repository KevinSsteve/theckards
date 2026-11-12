# Runbook: database capacity

**Signals.** `theckards-prod-db-cpu` (CPU above 80% for 15 minutes) or `theckards-prod-db-storage`
(free storage below 5 GiB).

## 1. Confirm the pressure

```sh
aws rds describe-db-instances --db-instance-identifier theckards-prod-db \
  --query 'DBInstances[0].{status:DBInstanceStatus,class:DBInstanceClass,allocated:AllocatedStorage,max:MaxAllocatedStorage,restorable:LatestRestorableTime}'

for metric in CPUUtilization FreeStorageSpace DatabaseConnections ReadLatency WriteLatency FreeableMemory; do
  aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name "$metric" \
    --dimensions Name=DBInstanceIdentifier,Value=theckards-prod-db \
    --start-time "$(date -u -d '2 hours ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
    --period 300 --statistics Average Minimum Maximum --query 'Datapoints[]' --output json
done
```

Inspect `CPUUtilization`, `FreeStorageSpace`, `DatabaseConnections`, `ReadLatency`, `WriteLatency` and
`FreeableMemory` together. One point is not a trend. The CPU alarm requires three five-minute breaches; storage is
one point because exhausting it is harder to recover from.

Do not copy SQL text, bind values, email addresses or agreement content into the incident record.

## 2. CPU

Check whether the change matches traffic, a deployment or the worker queue. If queue depth and request count are
flat, inspect PostgreSQL's aggregate activity and lock counts, not query parameters. Stop an obviously runaway
maintenance or migration task only after identifying it; do not terminate ordinary application sessions blindly.

If the load is legitimate and sustained, change the RDS instance class in CDK. A larger always-on instance changes
the fixed monthly cost, so update ADR-002/ADR-022 before deploy. Never resize manually in the console.

## 3. Storage

The instance starts at 20 GiB and can auto-scale to 100 GiB. Confirm `AllocatedStorage`, `MaxAllocatedStorage` and the
recent free-space slope. Automated backups and S3 documents are not stored in the database volume; an unexpected
slope points to table/index growth or PostgreSQL logs.

Do not delete agreement, signature, evidence, case or dossier records to clear space. If 100 GiB is becoming
insufficient, raise the limit through CDK after recording the cost. Storage changes do not shrink later.

## 4. Verify recovery

Both alarms must return to OK, `/readyz` must report the database as `ok`, and the most recent restorable time must
continue advancing. If requests failed while the database was pressured, also follow [target-5xx](target-5xx.md).
