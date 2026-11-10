import { listLegalDocuments } from "../../../../server/legal";
import { withRoute } from "../../../../server/http/with-route";

export const GET = withRoute({ auth: "admin" }, async () => Response.json({ documents: await listLegalDocuments() }));
