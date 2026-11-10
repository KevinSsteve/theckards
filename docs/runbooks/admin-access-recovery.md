# Admin access recovery

Use only after confirming the requester controls the AWS account and product.

1. Confirm the user has signed in once so a `users` row exists.
2. Add the Cognito user to group `admins` with `AdminAddUserToGroup`.
3. Run the one-off owner-registration task or an approved migration to create `admin_users(role=OWNER)`. Never edit the production database from a public endpoint.
4. The owner signs in at `/api/auth/login?intent=admin` and enrolls TOTP if required.
5. Record the recovery in the incident log and review CloudTrail/Cognito sign-in events.

Do not create shared administrator accounts or send passwords in chat.
