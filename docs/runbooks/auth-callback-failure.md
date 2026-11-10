# Auth callback failure

1. Check CloudWatch log group `/theckards/prod/web` using the request ID. Do not log tokens, email addresses or callback parameters.
2. Check Cognito user-pool domain, app-client callback URL and client-secret age.
3. Confirm `https://theckards.linkealls.com/api/auth/callback` is the exact configured callback.
4. If the app-client secret was rotated, deploy the new Secrets Manager version to ECS before disabling the old secret.
5. Test with a dedicated non-admin account. Never bypass state, nonce, PKCE or ID-token signature validation.

## Sessions revalidated against Cognito
App sessions are checked against Cognito at least every 5 minutes (refresh token). Disabling a Cognito user or a global sign-out ends their Theckards sessions within 5 minutes. If Cognito is unreachable, sessions are kept and a `cognito session check unavailable` warning is logged; investigate if it persists.
