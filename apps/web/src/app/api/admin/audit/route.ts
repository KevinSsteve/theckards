import { listAudit } from "../../../../server/admin/settings";
import { withRoute } from "../../../../server/http/with-route";

export const GET = withRoute({ auth: "admin", ownerOnly: true }, async () => Response.json({ events: await listAudit() }));
