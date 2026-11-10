import { PROPOSAL_MAX } from "@theckards/domain";
import { z } from "zod";
import { addProposal } from "../../../../../../server/cases";
import { withRoute } from "../../../../../../server/http/with-route";

const Body = z.object({ body: z.string().trim().min(3).max(PROPOSAL_MAX) });

/** Party-only, insert-only. A newer proposal from the same party supersedes the previous one. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "case-proposal", rateLimit: { scope: "case-proposal", limit: 30, windowSeconds: 3600 } }, async ({ request, session, body, params }) =>
  Response.json(await addProposal({ userId: session!.userId, agreementId: params.id!, body: body.body, idempotencyKey: request.headers.get("idempotency-key")! }), { status: 201 }));
