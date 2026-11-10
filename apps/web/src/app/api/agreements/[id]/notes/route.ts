import { z } from "zod";
import { withRoute } from "../../../../../server/http/with-route";
import { addNote } from "../../../../../server/record";

const Body = z.object({ body: z.string().trim().min(1).max(500) });

/** Party-only, insert-only. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "agreement-note", rateLimit: { scope: "agreement-note", limit: 60, windowSeconds: 3600 } }, async ({ request, session, body, params }) =>
  Response.json(await addNote({ userId: session!.userId, agreementId: params.id!, body: body.body, idempotencyKey: request.headers.get("idempotency-key")! }), { status: 201 }));
