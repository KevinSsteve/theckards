import { getAgreement } from "../../../../../../server/agreements";
import { ProblemError } from "../../../../../../server/http/problem";
import { withRoute } from "../../../../../../server/http/with-route";
import { finalDocumentFor } from "../../../../../../server/signing";
import { getPrivateObject } from "../../../../../../server/storage";

export const GET = withRoute({ auth: "user", rateLimit: { scope: "final-download", limit: 100, windowSeconds: 3600 } }, async ({ session, params }) => {
  await getAgreement(session!.userId, params.id!);
  const document = await finalDocumentFor(params.id!);
  if (!document) throw new ProblemError(404, "Not Found", "The sealed document is not available yet.");
  const bytes = await getPrivateObject(document.s3Key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="theckards-${document.id}.pdf"`,
    "content-security-policy": "default-src 'none'; sandbox",
    etag: `"${document.sha256}"`,
  } });
});
