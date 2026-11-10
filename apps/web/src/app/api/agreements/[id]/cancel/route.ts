import { cancelAgreement } from "../../../../../server/agreements";
import { etag, readIfMatch } from "../../../../../server/http/etag";
import { withRoute } from "../../../../../server/http/with-route";

export const POST = withRoute({ auth: "user", idempotent: "agreement-cancel" }, async ({ request, session, params }) => {
  const agreement = await cancelAgreement(session!.userId, params.id!, readIfMatch(request));
  return Response.json({ agreement }, { headers: { etag: etag(agreement.lockVersion) } });
});
