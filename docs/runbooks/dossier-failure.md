# Runbook: a dossier does not finish

**Symptom.** A party asked for a dossier and the panel still says "Building the archive and sealing it" minutes
later, or it says "Could not be built".

**Impact.** Low and contained. The record itself is untouched: a dossier is a read-only export, and nothing else
depends on it. The party can keep using the agreement, and an earlier dossier they already downloaded stays valid.

## How the job works

`POST /api/agreements/{id}/dossier` inserts a row in `dossier_requests` (status `PENDING`) and an `outbox` row
with topic `dossier.build`. The worker reads the whole record, fetches the sealed PDFs and clean evidence from the
documents bucket, writes a deterministic ZIP, hashes it, signs a receipt with KMS, inserts a `DOSSIER` row in
`sealed_documents` and sets the request to `READY`.

Two failure modes, distinguished on purpose:

- **Terminal** (`status = 'FAILED'`, `error_code` set): something in the record is wrong and retrying cannot fix
  it. The job returns without throwing, so SQS does not retry.
- **Transient** (row stays `PENDING`): S3, KMS or the database failed. The message is retried by SQS and lands in
  the dead-letter queue after five attempts, where the DLQ alarm fires.

## 1. Find out which

```sh
.kiro/artifacts/q.sh "const r=await m.pool.query(\"select id,status,error_code,created_at,ready_at from dossier_requests order by created_at desc limit 10\");console.log(JSON.stringify(r.rows,null,1))"
```

### status = FAILED

| `error_code` | Meaning | Action |
| --- | --- | --- |
| `NO_VERSION` | The agreement has no row for its `current_version_number`. | Data fault. Inspect `agreement_versions` for that agreement before anything else; do not patch the dossier. |
| `SEALED_HASH_MISMATCH` | A stored sealed PDF no longer hashes to the value in its own seal. | **Treat as an integrity incident**, not a dossier bug: a sealed file must never change. Follow [seal-failure](seal-failure.md), check the documents bucket's version history for that object, and do not let anyone re-render it. |
| `EVIDENCE_HASH_MISMATCH` | A stored evidence file no longer matches its recorded hash. | Same: integrity incident. Compare the S3 object with `evidence.sha256` and check object versions. |

A terminal failure is not retried. Once the underlying data is correct, the party can simply ask for a new
dossier; the failed row stays as a record of the attempt.

### status = PENDING for more than about two minutes

The build is stuck or failing transiently.

```sh
# Is the worker alive and consuming?
aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-worker \
  --query 'services[0].{desired:desiredCount,running:runningCount}'

# Anything parked?
aws sqs get-queue-attributes --queue-url "$(aws sqs get-queue-url --queue-name theckards-prod-jobs-dlq --query QueueUrl --output text)" \
  --attribute-names ApproximateNumberOfMessages

# What did the job say?
aws logs filter-log-events --log-group-name /theckards/prod/worker --start-time "$(( ($(date +%s) - 1800) * 1000 ))" \
  --filter-pattern '"job failed"' --query 'events[*].message' --output text
```

Common causes, in the order they actually happen:

1. **The worker is not running, or the outbox is not draining.** See [outbox-stalled](outbox-stalled.md).
2. **A large record.** The archive is built in memory, and the worker has 1 GB. Evidence is capped at 50 MB per
   archive (`EVIDENCE_BUDGET_BYTES`), so a single dossier should stay well under that, but many large sealed
   addenda could still push it. If the task was killed for memory, the log shows no job error at all and the task
   stops with `OutOfMemoryError`. Raise the worker task memory in CDK, deploy, and let SQS redeliver.
3. **KMS throttling or a disabled key.** `signReceipt` fails. Check the seal key is enabled:
   `aws kms describe-key --key-id "$SEAL_KEY_ARN" --query 'KeyMetadata.{state:KeyState,enabled:Enabled}'`.
4. **The documents bucket denied a read.** Check the worker task role still has `s3:GetObject` on the bucket.

## 2. Replay

The job is idempotent: the seal id is derived from the request id, so a replay produces the same archive bytes and
the same receipt rather than a second one. Nothing has to be cleaned up before retrying.

```sh
# Re-publish the outbox row for one request (safe to run more than once).
.kiro/artifacts/q.sh "await m.pool.query(\"insert into outbox(topic,payload) values ('dossier.build', jsonb_build_object('requestId', \$1::text))\", ['<request-id>'])"
```

If the message is in the DLQ, redrive it instead, so the original envelope id is preserved and `processed_jobs`
keeps its deduplication:

```sh
aws sqs start-message-move-task \
  --source-arn "$(aws sqs get-queue-attributes --queue-url "$(aws sqs get-queue-url --queue-name theckards-prod-jobs-dlq --query QueueUrl --output text)" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"
```

## 3. Confirm the result

```sh
curl -s -o /tmp/d.zip -b "<session cookie>" "https://theckards.linkealls.com/api/agreements/<id>/dossier/<request-id>/file"
curl -s -o /tmp/d.receipt.json -b "<session cookie>" "https://theckards.linkealls.com/api/agreements/<id>/dossier/<request-id>/receipt"
curl -s -o /tmp/keys.json https://theckards.linkealls.com/.well-known/theckards-keys.json
node scripts/verify-dossier.mjs /tmp/d.zip /tmp/d.receipt.json /tmp/keys.json
```

Every line must read `ok`. That script imports nothing from the application, so a pass means the archive is
genuinely self-consistent and signed by the published key, not merely that our code is content with it.

## What never to do

- Never rebuild an archive into an existing `s3_key` by hand. A dossier's receipt is signed over exact bytes; new
  bytes under the same key would make the receipt a lie. Ask for a new dossier instead.
- Never edit a `dossier_requests` row out of `READY` or `FAILED`: the table's trigger forbids it, and the trigger
  is the point.
- Never work around `SEALED_HASH_MISMATCH` by excluding the file. A sealed document that changed is a far more
  serious problem than a missing export.
