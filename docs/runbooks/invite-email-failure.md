# Invitation email failure

1. Confirm SES production access. While the account is in the SES sandbox, only verified recipient identities can receive mail.
2. Check SES configuration-set bounce/complaint events and suppression status without logging the recipient address.
3. Confirm the domain identity, DKIM, SPF and DMARC records remain valid.
4. Redrive the `email.invite` job. The invitation token stays encrypted in the outbox/SQS payload and must never be printed.
5. A resend must generate a new token and invalidate the previous token.

Source: [Amazon SES sending with SDK v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/ses-examples-sending-email.html).

Content was rephrased for compliance with licensing restrictions.
