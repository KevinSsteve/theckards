import { previewObject } from "../../../../../server/agreements";
import { withRoute } from "../../../../../server/http/with-route";
import { getPrivateObject } from "../../../../../server/storage";

export const GET = withRoute({ auth: "user", rateLimit: { scope: "preview-download", limit: 100, windowSeconds: 3600 } }, async ({ session, params }) => {
  const preview = await previewObject(session!.userId, params.id!);
  const bytes = await getPrivateObject(preview.key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="agreement-${params.id}.pdf"`,
    "content-security-policy": "default-src 'none'; sandbox",
    etag: `"${preview.sha256}"`,
  } });
});
