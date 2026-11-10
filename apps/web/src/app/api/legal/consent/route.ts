import { acceptCurrentLegal } from "../../../../server/legal";
import { requestAddress } from "../../../../server/rate-limit";
import { withRoute } from "../../../../server/http/with-route";

export const POST = withRoute({ auth: "user", rateLimit: { scope: "legal-consent", limit: 10, windowSeconds: 3600 } }, async ({ request, session }) => {
  await acceptCurrentLegal(session!.userId, requestAddress(request), request.headers.get("user-agent") ?? "unknown");
  return Response.json({ accepted: true });
});
