import { z } from "zod";
import { inviteCounterparty } from "../../../../../server/agreements";
import { etag, readIfMatch } from "../../../../../server/http/etag";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ email: z.string().email().max(320), displayName: z.string().trim().min(1).max(120) });

export const POST = withRoute({ auth: "user", schema: Body, idempotent: "agreement-invite", rateLimit: { scope: "agreement-invite", limit: 20, windowSeconds: 86_400 } }, async ({ request, session, body, params }) => {
  const result = await inviteCounterparty({ userId: session!.userId, agreementId: params.id!, expectedLockVersion: readIfMatch(request), ...body });
  return Response.json(result, { headers: { etag: etag(result.agreement.lockVersion) } });
});
