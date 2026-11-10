# Runbook — cases and resolution addenda (S5 part 2)

Signals: `theckards-prod-target-5xx`, `theckards-prod-jobs-dlq`, `theckards-prod-jobs-age`; user reports.

Principle (G2): Theckards never decides a case and support never edits case content. An addendum exists only when the other party accepts the author's current proposal and both parties sign it.

1. **"Cases unavailable" (503)**: PRIVACY v4 or ESIGN v3 not approved. Owner approves both in Admin → Legal.
2. **Addendum stuck in "being generated"**: `addendum.render` job. Check `/theckards/prod/worker` for the job id and the DLQ (see `outbox-stalled.md`). Rendering is idempotent; redrive the message.
3. **Both signed but not sealed**: `seal.addendum` job (KMS sign + S3). Follow `seal-failure.md`. Sealing is idempotent (deterministic seal id; `ON CONFLICT DO NOTHING`); redrive is safe.
4. **"Proposal superseded" (409)**: expected; the author sent a newer proposal. Accept the current one.
5. **Withdrawal refused after both signatures**: expected; the case is resolving. Wait for sealing.
6. Never update `cases`, `proposals`, `proposal_acceptances`, `addenda` text or `addendum_signatures` manually. Content and signatures are protected by triggers.
