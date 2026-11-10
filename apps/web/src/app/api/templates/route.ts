import { templateDefinitions } from "@theckards/domain";
import { withRoute } from "../../../server/http/with-route";

export const GET = withRoute({ auth: "user" }, async () => Response.json({ templates: Object.values(templateDefinitions) }));
