import { withRoute } from "../../../../../server/http/with-route";
import { getRecord } from "../../../../../server/record";

/** Party-only: confirmations (derived outcome), messages, notes and timeline. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "agreement-record", limit: 600, windowSeconds: 3600 } }, async ({ session, params }) =>
  Response.json(await getRecord(session!.userId, params.id!)));
