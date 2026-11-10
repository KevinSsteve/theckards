import { cookies } from "next/headers";
import { DEVICE_COOKIE, GUEST_COOKIE, GUEST_CSRF_COOKIE, csrfCookie, secureCookie } from "../../../../../server/auth/cookies";
import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { claimDownloadSession } from "../../../../../server/in-person";

/** Public (QR token + bound device): idempotently issues a short guest session to download the sealed PDF. */
export const POST = withRoute({ auth: "public", rateLimit: { scope: "in-person-claim", limit: 20, windowSeconds: 3600 } }, async ({ request, params }) => {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
  }
  const jar = await cookies();
  const session = await claimDownloadSession(params.token!, jar.get(DEVICE_COOKIE)?.value, idempotencyKey);
  jar.set(GUEST_COOKIE, session.token, { ...secureCookie, expires: session.absoluteExpiresAt });
  jar.set(GUEST_CSRF_COOKIE, session.csrf, { ...csrfCookie, expires: session.absoluteExpiresAt });
  return Response.json({ downloadUrl: "/api/guest/documents/final" });
});
