import { withdrawCase } from "../../../../../../server/cases";
import { withRoute } from "../../../../../../server/http/with-route";

/** Only the party that opened the case; the agreement returns to EXECUTED. */
export const POST = withRoute({ auth: "user", idempotent: "case-withdraw", rateLimit: { scope: "case-withdraw", limit: 10, windowSeconds: 3600 } }, async ({ session, params }) =>
  Response.json(await withdrawCase({ userId: session!.userId, agreementId: params.id! })));
