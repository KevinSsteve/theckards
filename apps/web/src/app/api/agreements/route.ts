import { CreateAgreementSchema } from "@theckards/domain";
import { createAgreement, listAgreements } from "../../../server/agreements";
import { withRoute } from "../../../server/http/with-route";

export const GET = withRoute({ auth: "user" }, async ({ session }) => Response.json({ agreements: await listAgreements(session!.userId) }));

export const POST = withRoute({ auth: "user", schema: CreateAgreementSchema, idempotent: "agreement-create", rateLimit: { scope: "agreement-create", limit: 20, windowSeconds: 86_400 } }, async ({ session, body }) => {
  const agreement = await createAgreement({ userId: session!.userId, ...body });
  return Response.json({ agreement }, { status: 201, headers: { location: `/agreements/${agreement.id}` } });
});
