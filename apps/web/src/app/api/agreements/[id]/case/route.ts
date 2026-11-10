import { CASE_REASON_MAX } from "@theckards/domain";
import { z } from "zod";
import { getCase, openCase } from "../../../../../server/cases";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ reason: z.string().trim().min(3).max(CASE_REASON_MAX) });

/** Party-only view of the latest case on the agreement. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "agreement-case", limit: 600, windowSeconds: 3600 } }, async ({ session, params }) =>
  Response.json(await getCase(session!.userId, params.id!)));

/** Party-only: opens a case. Terms stay frozen; Theckards does not decide the outcome. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "case-open", rateLimit: { scope: "case-open", limit: 10, windowSeconds: 3600 } }, async ({ session, body, params }) =>
  Response.json(await openCase({ userId: session!.userId, agreementId: params.id!, reason: body.reason }), { status: 201 }));
