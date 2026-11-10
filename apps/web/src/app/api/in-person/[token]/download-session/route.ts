import { cookies } from "next/headers";
import { DEVICE_COOKIE, GUEST_COOKIE, GUEST_CSRF_COOKIE, csrfCookie, secureCookie } from "../../../../../server/auth/cookies";
import { withRoute } from "../../../../../server/http/with-route";
import { claimDownloadSession } from "../../../../../server/in-person";

/** Public (QR token + bound device, once): issues a short guest session to download the sealed PDF. */
export const POST = withRoute({ auth: "public", rateLimit: { scope: "in-person-claim", limit: 20, windowSeconds: 3600 } }, async ({ params }) => {
  const jar = await cookies();
  const session = await claimDownloadSession(params.token!, jar.get(DEVICE_COOKIE)?.value);
  jar.set(GUEST_COOKIE, session.token, { ...secureCookie, expires: session.absoluteExpiresAt });
  jar.set(GUEST_CSRF_COOKIE, session.csrf, { ...csrfCookie, expires: session.absoluteExpiresAt });
  return Response.json({ downloadUrl: "/api/guest/documents/final" });
});
