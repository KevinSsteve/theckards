import { cookies } from "next/headers";
import { z } from "zod";
import { DEVICE_COOKIE, deviceCookie } from "../../../../../server/auth/cookies";
import { randomToken } from "../../../../../server/crypto";
import { withRoute } from "../../../../../server/http/with-route";
import { requestCounterpartySignature } from "../../../../../server/in-person";
import { requestAddress } from "../../../../../server/rate-limit";

const Body = z.object({ typedName: z.string().trim().min(3).max(120), consent: z.literal(true) });

/** Public (QR token): the counterparty signs on their own device and receives the code to show the creator. */
export const POST = withRoute({ auth: "public", schema: Body, rateLimit: { scope: "in-person-request", limit: 20, windowSeconds: 3600 } }, async ({ request, body, params }) => {
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  const deviceSecret = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomToken(32);
  const result = await requestCounterpartySignature({
    token: params.token!, typedName: body.typedName, deviceSecret,
    evidence: { ip: requestAddress(request), userAgent: request.headers.get("user-agent") ?? "unknown" },
  });
  jar.set(DEVICE_COOKIE, deviceSecret, deviceCookie);
  return Response.json(result, { status: 201 });
});
