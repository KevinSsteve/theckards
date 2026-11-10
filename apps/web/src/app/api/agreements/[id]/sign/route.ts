import { z } from "zod";
import { readIfMatch } from "../../../../../server/http/etag";
import { withRoute } from "../../../../../server/http/with-route";
import { requestAddress } from "../../../../../server/rate-limit";
import { signAsCreator } from "../../../../../server/signing";

const Body = z.object({
  typedName: z.string().trim().min(3).max(120),
  consent: z.literal(true),
  code: z.string().regex(/^\d{6}$/),
});

export const POST = withRoute({ auth: "user", schema: Body, idempotent: "agreement-sign", rateLimit: { scope: "agreement-sign", limit: 20, windowSeconds: 3600 } }, async ({ request, session, body, params }) => {
  const result = await signAsCreator({
    userId: session!.userId, agreementId: params.id!, expectedLockVersion: readIfMatch(request),
    typedName: body.typedName, code: body.code,
    evidence: { ip: requestAddress(request), userAgent: request.headers.get("user-agent") ?? "unknown" },
  });
  return Response.json(result);
});
