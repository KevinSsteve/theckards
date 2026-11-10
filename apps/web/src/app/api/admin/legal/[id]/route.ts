import { z } from "zod";
import { updateLegalDraft } from "../../../../../server/legal";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ title: z.string().trim().min(3).max(120), bodyMd: z.string().trim().min(20).max(100_000) });

export const PATCH = withRoute({ auth: "admin", ownerOnly: true, schema: Body, idempotent: "admin-legal-draft-update" }, async ({ session, body, params, requestId }) => {
  await updateLegalDraft({ id: params.id!, title: body.title, bodyMd: body.bodyMd, actorId: session!.userId, requestId });
  return Response.json({ updated: true });
});
