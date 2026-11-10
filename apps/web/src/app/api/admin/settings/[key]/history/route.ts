import { isSettingKey } from "@theckards/domain";
import { listSettingHistory } from "../../../../../../server/admin/settings";
import { ProblemError } from "../../../../../../server/http/problem";
import { withRoute } from "../../../../../../server/http/with-route";

export const GET = withRoute({ auth: "admin", ownerOnly: true }, async ({ params }) => {
  const key = params.key;
  if (!key || !isSettingKey(key)) throw new ProblemError(404, "Not Found", "Setting not found.");
  return Response.json({ history: await listSettingHistory(key) });
});
