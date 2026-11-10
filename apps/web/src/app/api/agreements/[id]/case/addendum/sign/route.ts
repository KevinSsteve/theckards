import { z } from "zod";
import { signAddendum } from "../../../../../../../server/cases";
import { withRoute } from "../../../../../../../server/http/with-route";
import { requestAddress } from "../../../../../../../server/rate-limit";

const Body = z.object({ typedName: z.string().trim().min(3).max(120), consent: z.literal(true) });

/** Party-only: signs the resolution addendum from the signed-in account (ACCOUNT_SESSION). */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "addendum-sign", rateLimit: { scope: "addendum-sign", limit: 20, windowSeconds: 3600 } }, async ({ request, session, body, params }) =>
  Response.json(await signAddendum({
    userId: session!.userId, agreementId: params.id!, typedName: body.typedName,
    evidence: { ip: requestAddress(request), userAgent: request.headers.get("user-agent") ?? "unknown" },
  }), { status: 201 }));
