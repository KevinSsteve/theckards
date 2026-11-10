import { ProblemError } from "../../../../../../../../server/http/problem";
import { acceptProposal } from "../../../../../../../../server/cases";
import { withRoute } from "../../../../../../../../server/http/with-route";

/** Party-only: the other party accepts the author's current proposal, which creates the addendum to sign. */
export const POST = withRoute({ auth: "user", idempotent: "case-accept", rateLimit: { scope: "case-accept", limit: 20, windowSeconds: 3600 } }, async ({ session, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.proposalId ?? "")) throw new ProblemError(404, "Not Found", "Proposal not found.");
  return Response.json(await acceptProposal({ userId: session!.userId, agreementId: params.id!, proposalId: params.proposalId! }), { status: 201 });
});
