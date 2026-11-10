import { EVIDENCE_MAX_BYTES } from "@theckards/domain";
import { z } from "zod";
import { withRoute } from "../../../../../server/http/with-route";
import { listEvidence, requestEvidenceUpload } from "../../../../../server/evidence";

const Body = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(3).max(100),
  bytes: z.number().int().min(1).max(EVIDENCE_MAX_BYTES),
  note: z.string().trim().max(500).optional(),
});

/** Party-only list. Files are listed with their scan status; only a clean file can be downloaded. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "evidence-list", limit: 600, windowSeconds: 3600 } }, async ({ session, params }) =>
  Response.json(await listEvidence(session!.userId, params.id!)));

/** Party-only: returns a presigned PUT into the quarantine bucket, signed for this exact type and length. */
export const POST = withRoute({ auth: "user", schema: Body, rateLimit: { scope: "evidence-upload", limit: 60, windowSeconds: 3600 } }, async ({ request, session, body, params }) => {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    const { ProblemError } = await import("../../../../../server/http/problem");
    throw new ProblemError(400, "Idempotency-Key required", "Provide a valid Idempotency-Key header.");
  }
  return Response.json(await requestEvidenceUpload({
    userId: session!.userId, agreementId: params.id!, idempotencyKey,
    filename: body.filename, contentType: body.contentType, bytes: body.bytes, note: body.note,
  }), { status: 201 });
});
