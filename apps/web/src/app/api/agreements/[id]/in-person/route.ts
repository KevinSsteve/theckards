import { readIfMatch } from "../../../../../server/http/etag";
import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { inPersonStatusForCreator, startInPerson } from "../../../../../server/in-person";

/**
 * Creator-only: opens a single-use QR session and cancels any previous one.
 * The token is derived from the high-entropy Idempotency-Key, so exact retries return the same QR without storing its secret.
 */
export const POST = withRoute({ auth: "user", rateLimit: { scope: "in-person-start", limit: 30, windowSeconds: 3600 } }, async ({ request, session, params }) => {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
  }
  const result = await startInPerson(session!.userId, params.id!, readIfMatch(request), idempotencyKey);
  return Response.json(result, { status: 201 });
});

/** Creator-only: polled while the QR code is shown. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "in-person-status", limit: 2400, windowSeconds: 3600 } }, async ({ session, params }) => {
  return Response.json(await inPersonStatusForCreator(session!.userId, params.id!));
});
