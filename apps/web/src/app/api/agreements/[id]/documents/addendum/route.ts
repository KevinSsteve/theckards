import { addendumObject } from "../../../../../../server/cases";
import { withRoute } from "../../../../../../server/http/with-route";
import { getPrivateObject } from "../../../../../../server/storage";

/** Party-only. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "addendum-download", limit: 100, windowSeconds: 3600 } }, async ({ session, params }) => {
  const object = await addendumObject(session!.userId, params.id!, "sealed");
  const bytes = await getPrivateObject(object.key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${object.name}"`,
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
