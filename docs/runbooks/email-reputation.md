# Runbook: SES bounce or complaint reputation

**Signals.** `theckards-prod-ses-bounce` above 5% or `theckards-prod-ses-complaint` above 0.1%.

These SES reputation metrics are regional/account-level, not scoped to the Theckards configuration set. Another
project in the account can therefore trigger them. Production email delivery for Theckards is currently disabled;
do not assume an alarm came from an agreement email.

## 1. Locate the source without exposing recipients

Check aggregate SES reputation, configuration-set event counts and suppression-list reason totals. Do not print,
download or paste recipient addresses, message bodies, invite links, OTPs or SES event payloads into logs or tickets.

If Theckards sending has been enabled, inspect counts for `theckards-prod-default` and the worker's error names. A
bounce or complaint is not retried to the same suppressed destination.

## 2. Contain

If Theckards is the source, turn `EMAIL_DELIVERY_ENABLED` off through the Admin feature flags. This returns signing
to the in-person path without changing records. Do not disable SES, edit the configuration set or remove suppression
entries manually.

For a bounce spike, verify the address source and suppression behavior. For complaints, stop the triggering message
type until its expectation and content are understood. Never work around suppression by changing the sender.

## 3. Recover

Correct the producer, deploy through CDK, and test only with a verified test address. Resume delivery through Admin
only after the rolling reputation metric is below its threshold. The email-delivery SLO remains unavailable until
sanitized delivery-event instrumentation exists (ADR-023); SES production access itself is enabled.
