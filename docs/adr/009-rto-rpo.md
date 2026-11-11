# ADR-009: Availability, recovery objectives, and what a restore actually costs

Status: Accepted (2026-11-10), **measured 2026-11-11**

## Requirement

An agreement people rely on must survive the loss of its database. Section 5.3 sets availability at 99.9 %,
RTO at 4 hours and RPO at 5 minutes. Until a restore has been performed, those are intentions, so T8.3 required
measuring them before go-live.

## Decision

Single-AZ RDS PostgreSQL with automated backups retained 14 days and point-in-time recovery, recovering by
restoring to a new instance. No Multi-AZ, no read replica, no cross-region copy.

## Measurement (2026-11-11, production, us-east-1)

A point-in-time restore of `theckards-prod-db` into a throwaway instance of the same class:

| | |
| --- | --- |
| Restore started | 04:55:36Z |
| Recovery point requested (latest restorable) | 04:51:56Z |
| Instance `available` | 05:19:18Z |
| **Database restore duration** | **23 min 42 s** |
| **Recovery point lag at the moment of failure** | **3 min 40 s** |

The restored copy was compared against production: 35 tables, identical row counts across agreements, versions,
signatures, sealed documents, confirmations, messages, evidence, dossier requests, legal documents, users,
profiles and agreement flags; the three most recent seals identical by id and SHA-256; the same newest agreement
timestamp. **Nothing was lost**, and the `REVOKE` on `schema_migrations` survived the restore, so the recovered
database keeps the same least-privilege grants rather than quietly widening them.

So RPO is met with margin: the recoverable point trailed the present by under four minutes against a five-minute
objective. RTO is met for the database step with large margin, 24 minutes against four hours, which leaves the
rest of the budget for the human parts: noticing, deciding, repointing the application and verifying. Those were
not measured and are the real risk, which is why the procedure is written down in
[`docs/runbooks/backup-restore.md`](../runbooks/backup-restore.md) rather than left to improvisation.

## Fixed monthly cost

US$0 beyond what is already paid. Backups up to the volume size are included, and this instance holds 20 GB.
The drill itself cost minutes of a `db.t4g.small`, a few cents, and the instance was deleted immediately with
`--skip-final-snapshot --delete-automated-backups`.

## Simpler alternative

Accepting a longer RTO with no rehearsal, which is what the project had before this measurement: the numbers
were written down and nobody knew whether they held.

## Alternative considered and rejected

**Multi-AZ** would cut failover to minutes and remove the restore from the critical path, at roughly double the
instance cost. Rejected because the measured 24-minute restore sits six times inside the objective, so paying
continuously to improve a number that already passes buys nothing a user would notice. Worth revisiting when
either the data volume makes restores materially slower, or an availability commitment to users makes a
24-minute recovery unacceptable.

## Operational risk

The risk is not the restore, which is now a measured 24 minutes. It is three things around it.

**Restore time grows with data.** Twenty gigabytes restored in 24 minutes; this figure is not a constant and
must be re-measured as the database grows. The checklist says to repeat the drill, not to trust this row forever.

**A single AZ means an AZ outage is an outage.** PITR does not help with availability, only with durability.
During an AZ failure the service is down until a restore completes elsewhere.

**Nobody has practised the cutover.** The application reaches the database by `DB_HOST`, so recovery means
restoring under a new name and repointing, or renaming instances. The drill proved the data comes back; it did
not prove the team can put it back into service under pressure.
