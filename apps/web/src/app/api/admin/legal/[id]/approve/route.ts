import { approveLegalDocument } from "../../../../../../server/legal";
import { ProblemError } from "../../../../../../server/http/problem";
import { withRoute } from "../../../../../../server/http/with-route";

export const POST = withRoute({ auth: "admin", ownerOnly: true, idempotent: "admin-legal-approve" }, async ({ session, params, requestId }) => {
  if (Date.now() - session!.recentAuthAt.getTime() > 5 * 60_000) {
    throw new ProblemError(403, "Reauthentication required", "Sign in again before approving legal text.");
  }
  await approveLegalDocument({ id: params.id!, actorId: session!.userId, requestId });
  return Response.json({ approved: true });
});
