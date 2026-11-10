import { z } from "zod";
import { withRoute } from "../../../../../server/http/with-route";
import { addMessage } from "../../../../../server/record";

const Body = z.object({ body: z.string().trim().min(1).max(4000) });

/** Party-only, insert-only. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "agreement-message", rateLimit: { scope: "agreement-message", limit: 120, windowSeconds: 3600 } }, async ({ request, session, body, params }) =>
  Response.json(await addMessage({ userId: session!.userId, agreementId: params.id!, body: body.body, idempotencyKey: request.headers.get("idempotency-key")! }), { status: 201 }));
