import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { listDossiers, requestDossier } from "../../../../../server/dossier";

/** Party-only, and only the caller's own dossiers: each archive contains that party's private notes. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "dossier-list", limit: 600, windowSeconds: 3600 } }, async ({ session, params }) =>
  Response.json(await listDossiers(session!.userId, params.id!)));

/** Party-only. Queues the build and returns immediately; the panel polls for the result. */
export const POST = withRoute({ auth: "user", rateLimit: { scope: "dossier-request", limit: 20, windowSeconds: 3600 } }, async ({ request, session, params }) => {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
  }
  return Response.json(await requestDossier({ userId: session!.userId, agreementId: params.id!, idempotencyKey }), { status: 202 });
});
