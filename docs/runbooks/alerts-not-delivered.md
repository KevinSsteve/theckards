# Runbook: alarms fire but nobody is told

**Symptom.** An incident happened, CloudWatch shows an alarm went to `ALARM`, and no email arrived. Or the
opposite and worse: everything looks healthy for weeks because no alarm has ever been able to reach anyone.

**Why this runbook exists.** Every paging Theckards alarm publishes to one SNS topic, `theckards-prod-alerts`.
The burn-rate component alarms deliberately have no actions; their two composite alarms publish instead, so one
incident produces one notification. The topic
was created from the first deploy, but the email subscription came from a CDK context value (`-c alertEmail=`)
that no deploy command passed, so for a time ten alarms were wired to a topic with zero subscribers. An unwatched
system that looks watched is worse than one known to be unwatched, so the stack now refuses to synthesize without
a destination and defaults to the operator mailbox already supplied for mail forwarding.

## 1. Is there a subscriber, and has it been confirmed?

```sh
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:116708768297:theckards-prod-alerts \
  --query 'Subscriptions[*].[Protocol,Endpoint,SubscriptionArn]' --output table
```

Read the `SubscriptionArn` carefully:

| What you see | What it means |
| --- | --- |
| No rows | Nothing is subscribed. Deploy again; synth now fails rather than leaving it empty. |
| `PendingConfirmation` | AWS emailed a confirmation link to that address and it was never opened. **Nothing is delivered until it is.** Open the link, or resend with the command below. |
| A real ARN ending in a UUID | The subscription is live. |

Resend the confirmation:

```sh
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:116708768297:theckards-prod-alerts \
  --protocol email --notification-endpoint "$(aws ssm get-parameter --name /theckards/prod/mail-forward-to --query Parameter.Value --output text)"
```

Subscribing an address that is already subscribed is harmless; AWS re-sends the confirmation.

## 2. Prove delivery end to end

Do not wait for a real incident to find out. Publish to the topic directly:

```sh
aws sns publish --topic-arn arn:aws:sns:us-east-1:116708768297:theckards-prod-alerts \
  --subject "Theckards alert pipeline test" \
  --message "Ignore. Confirms the alert path reaches a human."
```

If that arrives but alarms do not, the problem is between the alarm and the topic, not in delivery. Check that
the alarm has actions and that they are enabled:

```sh
aws cloudwatch describe-alarms --alarm-name-prefix theckards \
  --query '{metric:MetricAlarms[*].{name:AlarmName,state:StateValue,enabled:ActionsEnabled,actions:AlarmActions},composite:CompositeAlarms[*].{name:AlarmName,state:StateValue,enabled:ActionsEnabled,actions:AlarmActions}}' \
  --output json
```

`ActionsEnabled: false` is expected only on alarms named `theckards-prod-slo-*-fast-*` or
`theckards-prod-slo-*-slow-*`; their composite owns the action. On any paging alarm it means someone disabled the
action by hand. Re-enable the paging alarm:

```sh
aws cloudwatch enable-alarm-actions --alarm-names theckards-prod-<name>
```

## 3. The topic is encrypted, which has a failure mode

The topic uses a customer-managed KMS key. If the key is disabled or its policy no longer lets CloudWatch
publish, alarms fail silently at publish time and nothing is delivered.

```sh
aws kms describe-key --key-id alias/theckards-prod-alerts --query 'KeyMetadata.{state:KeyState,enabled:Enabled}'
```

The key policy must allow `cloudwatch.amazonaws.com` and `events.amazonaws.com` to call `kms:GenerateDataKey*`
and `kms:Decrypt`. CDK grants this; a manual edit to the key policy is the usual cause of losing it.

## 4. What is still not covered

Email to one mailbox is a single point of failure, and it is not a pager: nothing escalates if the message is not
read. R-OPS-1 asks for the on-call to be alerted within five minutes, which this meets only to the extent that
someone reads that inbox. A second destination belongs in the Admin dashboard (S11 T11.9, configurable alert
destinations) rather than in code.

## Related

- [outbox-stalled](outbox-stalled.md), [target-5xx](target-5xx.md), [seal-failure](seal-failure.md): what the
  individual alarms mean once they do reach you.
- [`docs/launch-checklist.md`](../launch-checklist.md): the full operational readiness picture, including what is
  verified and what is not.
