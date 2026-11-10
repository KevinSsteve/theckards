import { z } from "zod";
import { withRoute } from "../../../../../server/http/with-route";
import { requestAddress } from "../../../../../server/rate-limit";
import { requestGuestCode } from "../../../../../server/signing";

const Body = z.object({ email: z.string().email().max(320).optional() });

export const POST = withRoute({ auth: "public", schema: Body, rateLimit: { scope: "guest-otp", limit: 10, windowSeconds: 3600 } }, async ({ request, params, body }) => {
  const result = await requestGuestCode(params.token!, requestAddress(request), body.email);
  return Response.json(result, { status: 202 });
});
