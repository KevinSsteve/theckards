import { UpdateAgreementSchema } from "@theckards/domain";
import { getAgreement, updateAgreement } from "../../../../server/agreements";
import { etag, readIfMatch } from "../../../../server/http/etag";
import { withRoute } from "../../../../server/http/with-route";

export const GET = withRoute({ auth: "user" }, async ({ session, params }) => {
  const agreement = await getAgreement(session!.userId, params.id!);
  return Response.json({ agreement }, { headers: { etag: etag(agreement.lockVersion) } });
});

export const PATCH = withRoute({ auth: "user", schema: UpdateAgreementSchema, idempotent: "agreement-update" }, async ({ request, session, body, params }) => {
  const agreement = await updateAgreement({ userId: session!.userId, agreementId: params.id!, expectedLockVersion: readIfMatch(request), ...body });
  return Response.json({ agreement }, { headers: { etag: etag(agreement.lockVersion) } });
});
