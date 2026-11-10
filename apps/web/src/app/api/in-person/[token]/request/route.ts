import { cookies } from "next/headers";
import { z } from "zod";
import { DEVICE_COOKIE, deviceCookie } from "../../../../../server/auth/cookies";
import { hmac } from "../../../../../server/crypto";
import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { requestCounterpartySignature } from "../../../../../server/in-person";
import { requestAddress } from "../../../../../server/rate-limit";

const Body = z.object({ typedName: z.string().trim().min(3).max(120), consent: z.literal(true) });

/** Public (QR token): the counterparty signs on their own device and receives the code to show the creator. */
export const POST = withRoute({ auth: "public", schema: Body, rateLimit: { scope: "in-person-request", limit: 20, windowSeconds: 3600 } }, async ({ request, body, params }) => {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
  }
  const jar = await cookies();
  const existing = jar.get(DEVICE_COOKIE)?.value;
  const deviceSecret = existing && /^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.test(existing)
    ? existing
    : hmac(`in-person-device-bootstrap:${params.token!}:${idempotencyKey}`, "auth");
  const result = await requestCounterpartySignature({
    token: params.token!, typedName: body.typedName, deviceSecret, idempotencyKey,
    evidence: { ip: requestAddress(request), userAgent: request.headers.get("user-agent") ?? "unknown" },
  });
  jar.set(DEVICE_COOKIE, deviceSecret, deviceCookie);
  return Response.json(result, { status: 201 });
});
