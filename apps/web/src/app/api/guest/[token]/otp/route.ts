import { withRoute } from "../../../../../server/http/with-route";
import { requestAddress } from "../../../../../server/rate-limit";
import { requestGuestCode } from "../../../../../server/signing";

export const POST = withRoute({ auth: "public", rateLimit: { scope: "guest-otp", limit: 10, windowSeconds: 3600 } }, async ({ request, params }) => {
  const result = await requestGuestCode(params.token!, requestAddress(request));
  return Response.json(result, { status: 202 });
});
