# Seal job failure (`seal.final`)

Symptoms: agreement in EXECUTED without a FINAL row in `sealed_documents`; `jobs-age` or `jobs-dlq` alarm.

1. Find the failing envelope in `/theckards/prod/worker` (`job failed`, error name only; emails are redacted).
2. Common causes: KMS `Sign` denied or throttled (check the worker task role and key policy), S3 write denied, signatures missing for a party (data issue — do not insert signatures manually).
3. Redrive the message from the DLQ after fixing the cause. The job is idempotent: same seal id and PDF bytes; only the first stored receipt is authoritative.
4. Confirm `sealed_documents` has one row, `receipt.json` in S3 matches it, and the two `email.receipt` jobs completed.
5. Never re-seal with a different renderer revision for an existing seal id.
