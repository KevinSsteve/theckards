import { cookies } from "next/headers";
import { z } from "zod";
import { GUEST_COOKIE, GUEST_CSRF_COOKIE, csrfCookie, secureCookie } from "../../../../../server/auth/cookies";
import { withRoute } from "../../../../../server/http/with-route";
import { requestAddress } from "../../../../../server/rate-limit";
import { completeGuestAction } from "../../../../../server/signing";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign"), typedName: z.string().trim().min(3).max(120), consent: z.literal(true), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("request_changes"), consent: z.literal(true), code: z.string().regex(/^\d{6}$/) }),
]);

export const POST = withRoute({ auth: "public", schema: Body, rateLimit: { scope: "guest-complete", limit: 20, windowSeconds: 3600 } }, async ({ request, body, params }) => {
  const evidence = { ip: requestAddress(request), userAgent: request.headers.get("user-agent") ?? "unknown" };
  const result = body.action === "sign"
    ? await completeGuestAction({ token: params.token!, code: body.code, evidence, action: "sign", typedName: body.typedName })
    : await completeGuestAction({ token: params.token!, code: body.code, evidence, action: "request_changes" });
  const jar = await cookies();
  jar.set(GUEST_COOKIE, result.session.token, { ...secureCookie, expires: result.session.absoluteExpiresAt });
  jar.set(GUEST_CSRF_COOKIE, result.session.csrf, { ...csrfCookie, expires: result.session.absoluteExpiresAt });
  return Response.json({ state: result.state });
});
