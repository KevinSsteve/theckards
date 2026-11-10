# Auth callback failure

1. Check CloudWatch log group `/theckards/prod/web` using the request ID. Do not log tokens, email addresses or callback parameters.
2. Check Cognito user-pool domain, app-client callback URL and client-secret age.
3. Confirm `https://theckards.linkealls.com/api/auth/callback` is the exact configured callback.
4. If the app-client secret was rotated, deploy the new Secrets Manager version to ECS before disabling the old secret.
5. Test with a dedicated non-admin account. Never bypass state, nonce, PKCE or ID-token signature validation.
