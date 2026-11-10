import { withRoute } from "../../../../../server/http/with-route";
import { verifyPublicHash } from "../../../../../server/public-verification";

/** Public metadata only. A selected PDF never reaches this endpoint; the browser sends its SHA-256. */
export const GET = withRoute({
  auth: "public",
  rateLimit: { scope: "public-verify", limit: 120, windowSeconds: 60 },
  cacheControl: "public, max-age=60",
}, async ({ params }) => Response.json(await verifyPublicHash(params.sha256 ?? "")));
