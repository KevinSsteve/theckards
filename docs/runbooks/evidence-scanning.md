# Runbook — evidence uploads and malware scanning (S5 part 3)

Signals: the `theckards-prod-alerts` topic receives `GuardDuty Malware Protection Resource Status Warning` or
`Error` for the quarantine bucket; `theckards-prod-jobs-dlq`; users report evidence stuck on "Checking the file".

Design intent (ADR-020): if scanning degrades, evidence stays invisible. That is the safe direction. Never serve a
file that is not `CLEAN`, and never mark one clean by hand.

1. **Plan status Warning or Error.** Check the malware protection plan and the role it uses:
   `aws guardduty list-malware-protection-plans` then `get-malware-protection-plan --malware-protection-plan-id <id>`.
   The usual causes are the role losing `s3:GetObject`/`kms:Decrypt` on the quarantine bucket, or the EventBridge
   managed rule being deleted. Both live in CDK: redeploy rather than editing by hand.
2. **Evidence stuck in PENDING.** Confirm the object exists in the quarantine bucket and that a scan result arrived:
   check the `theckards-prod-evidence-scan-result` rule metrics and the worker log for `evidence.scanned`. If the
   result was delivered but the job failed, it is on the DLQ; see `outbox-stalled.md` and redrive. Handling is
   idempotent: it only acts on rows still `AWAITING_UPLOAD` or `PENDING`.
3. **Status INFECTED.** Expected behaviour, not an incident. The file was deleted from quarantine and was never
   copied anywhere else. Nothing to clean up. Do not attempt to recover the file for the uploader.
4. **Status UNSUPPORTED with reason `DECLARED_TYPE_MISMATCH`.** The bytes were not the type the uploader declared,
   so the file was refused even though the scan was clean. Ask the uploader for a plain JPEG, PNG, WebP or PDF.
5. **Status UNSUPPORTED from GuardDuty** (password-protected file, archive limits). Same remedy: a plain file.
6. **Quarantine bucket filling up.** Objects are deleted after scanning and expire after 7 days by lifecycle rule.
   If objects accumulate, scanning or the worker is broken; start at step 1.
7. **Cost.** Scanning is free up to 1 GB and 1,000 objects per month per region, then billed per GB and per
   request. Check Cost Explorer for `MalwareProtectionS3` usage types if the bill moves unexpectedly.
