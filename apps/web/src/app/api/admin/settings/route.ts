import { listSettings } from "../../../../server/admin/settings";
import { withRoute } from "../../../../server/http/with-route";

export const GET = withRoute({ auth: "admin" }, async () => Response.json({ settings: await listSettings() }));
