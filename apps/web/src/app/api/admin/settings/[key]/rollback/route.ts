import { z } from "zod";
import { isSettingKey } from "@theckards/domain";
import { deployFeatureFlags } from "../../../../../../server/admin/appconfig";
import { rollbackSetting } from "../../../../../../server/admin/settings";
import { ProblemError } from "../../../../../../server/http/problem";
import { withRoute } from "../../../../../../server/http/with-route";

const Body = z.object({ targetVersion: z.number().int().positive(), expectedVersion: z.number().int().positive() });

export const POST = withRoute({ auth: "admin", ownerOnly: true, schema: Body, idempotent: "admin-setting-rollback" }, async ({ params, body, session, requestId }) => {
  const key = params.key;
  if (!key || !isSettingKey(key)) throw new ProblemError(404, "Not Found", "Setting not found.");
  if (Date.now() - session!.recentAuthAt.getTime() > 5 * 60_000) throw new ProblemError(403, "Reauthentication required", "Sign in again before rolling back a setting.");
  const setting = await rollbackSetting({ key, targetVersion: body.targetVersion, expectedVersion: body.expectedVersion, actorId: session!.userId, requestId });
  const appConfig = key === "feature_flags" ? await deployFeatureFlags(setting.value as Record<string, boolean | readonly string[]>) : undefined;
  return Response.json({ setting, appConfig });
});
