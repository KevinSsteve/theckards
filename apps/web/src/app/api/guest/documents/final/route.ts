import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { finalDocumentFor } from "../../../../../server/signing";
import { getPrivateObject } from "../../../../../server/storage";

export const GET = withRoute({ auth: "guest", rateLimit: { scope: "guest-final-download", limit: 50, windowSeconds: 3600 } }, async ({ guest }) => {
  const document = await finalDocumentFor(guest!.agreementId);
  if (!document) throw new ProblemError(404, "Not Found", "The sealed document is not available yet.");
  const bytes = await getPrivateObject(document.s3Key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="theckards-${document.id}.pdf"`,
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
