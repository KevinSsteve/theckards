import { cookies } from "next/headers";
import { exchangeAuthorizationCode, groupsFromClaims, hasConfiguredTotp, readAuthTransaction } from "../../../../server/auth/cognito";
import { ADMIN_COOKIE, AUTH_TRANSACTION_COOKIE, CSRF_COOKIE, USER_COOKIE, csrfCookie, secureCookie } from "../../../../server/auth/cookies";
import { createSession, isAllowedAdmin, upsertUser } from "../../../../server/auth/session-store";
import { env } from "../../../../server/env";
import { ProblemError } from "../../../../server/http/problem";
import { withRoute } from "../../../../server/http/with-route";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  { auth: "public", rateLimit: { scope: "auth-callback", limit: 30, windowSeconds: 600 } },
  async ({ request }) => {
    const url = new URL(request.url);
    const jar = await cookies();
    const transaction = readAuthTransaction(jar.get(AUTH_TRANSACTION_COOKIE)?.value);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    jar.delete(AUTH_TRANSACTION_COOKIE);
    if (!transaction || !code || state !== transaction.state) throw new ProblemError(400, "Invalid callback", "The sign-in transaction is invalid or expired.");
    if (url.searchParams.has("error")) throw new ProblemError(401, "Sign-in failed", "Cognito did not complete sign-in.");

    const tokens = await exchangeAuthorizationCode(code, transaction);
    const groups = groupsFromClaims(tokens.claims);
    const identity = {
      sub: tokens.claims.sub!, email: tokens.claims.email!, groups,
      accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      authTime: new Date((tokens.claims.auth_time ?? Math.floor(Date.now() / 1000)) * 1000),
    };

    if (transaction.intent === "admin") {
      if (!groups.includes("admins")) throw new ProblemError(403, "Forbidden", "This account is not an administrator.");
      const userId = await upsertUser(identity);
      if (!(await isAllowedAdmin(userId))) throw new ProblemError(403, "Forbidden", "This administrator is not allow-listed.");
      const mfaReady = await hasConfiguredTotp(tokens.claims);
      const kind = mfaReady ? "ADMIN" : "USER";
      const session = await createSession(identity, kind);
      jar.set(kind === "ADMIN" ? ADMIN_COOKIE : USER_COOKIE, session.token, { ...secureCookie, expires: session.absoluteExpiresAt });
      jar.set(CSRF_COOKIE, session.csrf, { ...csrfCookie, expires: session.absoluteExpiresAt });
      return Response.redirect(new URL(mfaReady ? "/admin" : "/admin/mfa", env().APP_BASE_URL), 302);
    }

    const session = await createSession(identity, "USER");
    jar.set(USER_COOKIE, session.token, { ...secureCookie, expires: session.absoluteExpiresAt });
    jar.set(CSRF_COOKIE, session.csrf, { ...csrfCookie, expires: session.absoluteExpiresAt });
    // Behind CloudFront/ALB, request.url carries the container host (0.0.0.0:3000); always redirect to the public origin.
    return Response.redirect(new URL(transaction.next ?? "/account", env().APP_BASE_URL), 302);
  },
);
