import { cookies } from "next/headers";
import { beginAuthorization, isPostLoginPath, type AuthIntent } from "../../../../server/auth/cognito";
import { AUTH_TRANSACTION_COOKIE, secureCookie } from "../../../../server/auth/cookies";
import { withRoute } from "../../../../server/http/with-route";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  { auth: "public", rateLimit: { scope: "auth-login", limit: 20, windowSeconds: 600 } },
  async ({ request }) => {
    const url = new URL(request.url);
    const intent: AuthIntent = url.searchParams.get("intent") === "admin" ? "admin" : "user";
    const requested = url.searchParams.get("next");
    const next = intent === "user" && isPostLoginPath(requested) ? requested : undefined;
    const authorization = beginAuthorization(intent, intent === "admin" && url.searchParams.get("fresh") === "1", next);
    const jar = await cookies();
    jar.set(AUTH_TRANSACTION_COOKIE, authorization.transaction, { ...secureCookie, maxAge: 600 });
    return Response.redirect(authorization.url, 302);
  },
);
