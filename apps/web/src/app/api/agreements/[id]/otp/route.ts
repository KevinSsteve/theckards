import { requestAddress } from "../../../../../server/rate-limit";
import { requestCreatorCode } from "../../../../../server/signing";
import { withRoute } from "../../../../../server/http/with-route";

export const POST = withRoute({ auth: "user", idempotent: "agreement-otp" }, async ({ request, session, params }) => {
  const result = await requestCreatorCode(session!.userId, params.id!, requestAddress(request));
  return Response.json(result, { status: 202 });
});
