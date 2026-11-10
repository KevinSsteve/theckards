import { z } from "zod";
import { withRoute } from "../../../../../../server/http/with-route";
import { confirmInPerson } from "../../../../../../server/in-person";

const Body = z.object({ code: z.string().regex(/^\d{6}$/) });

/** Creator-only: enters the code shown on the counterparty's device to record their signature. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "in-person-confirm", rateLimit: { scope: "in-person-confirm", limit: 30, windowSeconds: 3600 } }, async ({ session, body, params }) => {
  return Response.json(await confirmInPerson(session!.userId, params.id!, body.code));
});
