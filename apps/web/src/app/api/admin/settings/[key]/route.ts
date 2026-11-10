import { z } from "zod";
import { isSettingKey } from "@theckards/domain";
import { deployFeatureFlags } from "../../../../../server/admin/appconfig";
import { settingsRegistry } from "../../../../../server/admin/settings-registry";
import { updateSetting } from "../../../../../server/admin/settings";
import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ value: z.unknown(), expectedVersion: z.number().int().positive() });

export const PATCH = withRoute({ auth: "admin", schema: Body, ownerOnly: true, idempotent: "admin-setting", rateLimit: { scope: "admin-setting", limit: 60, windowSeconds: 3600 } }, async ({ session, body, params, requestId }) => {
  const key = params.key;
  if (!key || !isSettingKey(key)) throw new ProblemError(404, "Not Found", "Setting not found.");
  const definition = settingsRegistry.find((item) => item.key === key)!;
  if (definition.requiresReauth && Date.now() - session!.recentAuthAt.getTime() > 5 * 60_000) {
    throw new ProblemError(403, "Reauthentication required", "Sign in again before changing this setting.");
  }
  let updated;
  try {
    updated = await updateSetting({ key, value: body.value, expectedVersion: body.expectedVersion, actorId: session!.userId, requestId });
  } catch (error) {
    if (error instanceof Error && error.message === "Setting version conflict") throw new ProblemError(409, "Conflict", "The setting changed. Reload and try again.");
    if (error instanceof Error && error.message === "Setting not found") throw new ProblemError(404, "Not Found", "Setting not found.");
    throw error;
  }
  const appConfig = key === "feature_flags"
    ? await deployFeatureFlags(updated.value as Record<string, boolean | readonly string[]>)
    : undefined;
  return Response.json({ setting: updated, appConfig });
});
