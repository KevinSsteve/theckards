import { cookies } from "next/headers";
import { beginAuthorization, type AuthIntent } from "../../../../server/auth/cognito";
import { AUTH_TRANSACTION_COOKIE, secureCookie } from "../../../../server/auth/cookies";
import { withRoute } from "../../../../server/http/with-route";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  { auth: "public", rateLimit: { scope: "auth-login", limit: 20, windowSeconds: 600 } },
  async ({ request }) => {
    const intent: AuthIntent = new URL(request.url).searchParams.get("intent") === "admin" ? "admin" : "user";
    const authorization = beginAuthorization(intent);
    const jar = await cookies();
    jar.set(AUTH_TRANSACTION_COOKIE, authorization.transaction, { ...secureCookie, maxAge: 600 });
    return Response.redirect(authorization.url, 302);
  },
);
