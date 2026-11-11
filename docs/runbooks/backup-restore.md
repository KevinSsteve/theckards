# Runbook: restore the database

**When to use this.** The database is lost, corrupted, or something destructive was applied and has to be undone:
a bad migration, a mistaken bulk update, an accidental deletion.

**What you have.** Automated backups retained 14 days with point-in-time recovery, plus manual snapshots taken
before each risky migration (`theckards-pre-NNNN-*`). Measured in production on 2026-11-11: a point-in-time
restore took **23 min 42 s** and lost **nothing**, with the recoverable point trailing the present by 3 min 40 s.
See [ADR-009](../adr/009-rto-rpo.md).

**What this does not do.** Restoring never overwrites the running database. It creates a *new* instance, and the
application keeps using the old one until you repoint it. That is deliberate: it makes the restore safe to
rehearse and reversible if the recovered data turns out to be wrong.

## 1. Decide the recovery point before touching anything

```sh
aws rds describe-db-instances --db-instance-identifier theckards-prod-db \
  --query 'DBInstances[0].{latest:LatestRestorableTime,backupDays:BackupRetentionPeriod}'

# Snapshots taken before each migration, if you are undoing one:
aws rds describe-db-snapshots --db-instance-identifier theckards-prod-db \
  --snapshot-type manual --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]' --output table
```

For data loss, restore to just before the damage. For hardware loss, restore to the latest restorable time.
`EarliestRestorableTime` can read `null` on a young instance; `LatestRestorableTime` is the field that matters.

## 2. Restore into a new instance

Never reuse the production identifier. Keep the same subnet group and security group so the workers can reach it.

```sh
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier theckards-prod-db \
  --target-db-instance-identifier theckards-prod-db-restored \
  --restore-time 2026-11-11T04:51:56Z \
  --db-instance-class db.t4g.small \
  --db-subnet-group-name "$(aws rds describe-db-instances --db-instance-identifier theckards-prod-db --query 'DBInstances[0].DBSubnetGroup.DBSubnetGroupName' --output text)" \
  --vpc-security-group-ids "$(aws rds describe-db-instances --db-instance-identifier theckards-prod-db --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)" \
  --no-publicly-accessible --no-multi-az --storage-type gp3
```

From a manual snapshot instead, use `restore-db-instance-from-db-snapshot --db-snapshot-identifier <id>`.

Then wait. Expect roughly 25 minutes, passing through `creating`,
`configuring-enhanced-monitoring` and `backing-up`:

```sh
aws rds wait db-instance-available --db-instance-identifier theckards-prod-db-restored
```

## 3. Verify the data before repointing anything

The application credentials come from Secrets Manager and are restored with the database, so a worker task can
query the new instance with only `DB_HOST` overridden:

```sh
HOST=$(aws rds describe-db-instances --db-instance-identifier theckards-prod-db-restored --query 'DBInstances[0].Endpoint.Address' --output text)
TD=$(aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-worker --query 'services[0].taskDefinition' --output text)
SCRIPT='import("./dist/db.js").then(async m=>{try{
  for (const t of ["agreements","signatures","sealed_documents","evidence","legal_documents","users"]) {
    console.log(t+": "+(await m.pool.query("select count(*)::int as n from "+t)).rows[0].n);
  }
  const s=await m.pool.query("select id,kind,sha256,sealed_at from sealed_documents order by sealed_at desc limit 3");
  s.rows.forEach(r=>console.log(r.sealed_at.toISOString()+" "+r.kind+" "+r.sha256.slice(0,16)));
}finally{await m.pool.end()}})'
OVERRIDES=$(node -e 'console.log(JSON.stringify({containerOverrides:[{name:"worker",command:["node","-e",process.argv[1]],environment:[{name:"DB_HOST",value:process.argv[2]}]}]}))' "$SCRIPT" "$HOST")
aws ecs run-task --cluster theckards-prod-cluster --task-definition "$TD" --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0ec26ef358131aeb7,subnet-0e97eba7052302f8b],securityGroups=[sg-06381bb809a766589],assignPublicIp=DISABLED}' \
  --overrides "$OVERRIDES"
```

Read the log from `/theckards/prod/worker`. Three things must hold:

1. Row counts are plausible for the recovery point you chose.
2. The most recent seals are present with their SHA-256 values. A sealed document whose hash is missing or
   changed is an integrity problem, not a restore problem; stop and follow [seal-failure](seal-failure.md).
3. `select count(*) from schema_migrations` is **denied**. The application role must not be able to read it; if
   that succeeds, the grants were widened and need fixing before this instance carries traffic.

## 4. Put it into service

The application finds the database through the `DB_HOST` environment variable in the task definitions, set by
CDK from the instance endpoint. Two options:

- **Rename** (keeps infrastructure as code truthful): rename the damaged instance out of the way, then rename the
  restored one to `theckards-prod-db`. DNS for the endpoint follows the identifier, and no deploy is needed, but
  there is a short window where neither name resolves.
- **Repoint** by deploying with the new endpoint. Honest in CloudFormation, but slower, and it leaves the stack
  describing an instance that no longer matches the original name.

Prefer renaming during an incident and reconciling the stack afterwards. Either way, finish by checking
readiness and that a sealed record still verifies publicly:

```sh
curl -s https://theckards.linkealls.com/readyz
curl -s https://theckards.linkealls.com/api/public/verify/<sha256 of a known sealed PDF>
```

## 5. Clean up, and do not skip this

A forgotten restored instance is a running cost and a second copy of personal data.

```sh
aws rds delete-db-instance --db-instance-identifier theckards-prod-db-restored \
  --skip-final-snapshot --delete-automated-backups
```

Deletion protection is on for production and deliberately off for restores, so the production instance cannot be
deleted by a mistyped identifier here.

## Rehearsing this

Repeat the drill after any change to the instance class or a material growth in data, because the 24-minute
figure is a measurement of 20 GB and not a constant. The rehearsal is exactly the steps above with a throwaway
identifier, and it is safe: production is never written to at any point.
