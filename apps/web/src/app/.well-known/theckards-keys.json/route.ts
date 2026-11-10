import { withRoute } from "../../../server/http/with-route";
import { publicSealKeys } from "../../../server/seal-keys";

export const dynamic = "force-dynamic";

export const GET = withRoute({ auth: "public", rateLimit: { scope: "public-keys", limit: 300, windowSeconds: 600 }, cacheControl: "public, max-age=3600" }, async () => Response.json(await publicSealKeys()));
