import { CONFIRMATION_KINDS } from "@theckards/domain";
import { z } from "zod";
import { withRoute } from "../../../../../server/http/with-route";
import { addConfirmation } from "../../../../../server/record";

const Body = z.object({ kind: z.enum(CONFIRMATION_KINDS), note: z.string().trim().max(500).optional() });

/** Party-only: declares one confirmation for the caller's own role. Insert-only. */
export const POST = withRoute({ auth: "user", schema: Body, idempotent: "agreement-confirmation", rateLimit: { scope: "agreement-confirmation", limit: 30, windowSeconds: 3600 } }, async ({ session, body, params }) =>
  Response.json(await addConfirmation({ userId: session!.userId, agreementId: params.id!, kind: body.kind, note: body.note }), { status: 201 }));
