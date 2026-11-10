import { confirmEvidenceUpload } from "../../../../../../../server/evidence";
import { ProblemError } from "../../../../../../../server/http/problem";
import { withRoute } from "../../../../../../../server/http/with-route";

/** Party-only: the uploader reports the PUT finished. GuardDuty starts the scan from the S3 event, not from here. */
export const POST = withRoute({ auth: "user", idempotent: "evidence-confirm", rateLimit: { scope: "evidence-confirm", limit: 60, windowSeconds: 3600 } }, async ({ session, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.evidenceId ?? "")) throw new ProblemError(404, "Not Found", "Evidence not found.");
  return Response.json(await confirmEvidenceUpload({ userId: session!.userId, agreementId: params.id!, evidenceId: params.evidenceId! }));
});
