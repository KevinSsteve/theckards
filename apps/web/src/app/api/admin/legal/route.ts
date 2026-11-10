import { LegalDraftSchema } from "@theckards/domain";
import { createLegalDraft, listLegalDocuments } from "../../../../server/legal";
import { withRoute } from "../../../../server/http/with-route";

export const GET = withRoute({ auth: "admin" }, async () => Response.json({ documents: await listLegalDocuments() }));

export const POST = withRoute({ auth: "admin", ownerOnly: true, schema: LegalDraftSchema }, async ({ body, session, requestId }) => {
  const document = await createLegalDraft({ ...body, actorId: session!.userId, requestId });
  return Response.json({ document }, { status: 201 });
});
