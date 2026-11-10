import { withRoute } from "../../../../../server/http/with-route";
import { inPersonStatusForCreator, startInPerson } from "../../../../../server/in-person";

/**
 * Creator-only: opens a new single-use QR session (any previous one is cancelled, so retries are safe).
 * Not stored by the idempotency layer on purpose: the response carries the QR secret.
 */
export const POST = withRoute({ auth: "user", rateLimit: { scope: "in-person-start", limit: 30, windowSeconds: 3600 } }, async ({ session, params }) => {
  const result = await startInPerson(session!.userId, params.id!);
  return Response.json(result, { status: 201 });
});

/** Creator-only: polled while the QR code is shown. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "in-person-status", limit: 2400, windowSeconds: 3600 } }, async ({ session, params }) => {
  return Response.json(await inPersonStatusForCreator(session!.userId, params.id!));
});
