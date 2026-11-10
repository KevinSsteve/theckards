import { beginTotpSetup } from "../../../../../server/auth/cognito";
import { getSessionAccessToken, requirePendingAdmin } from "../../../../../server/auth/session-store";
import { withRoute } from "../../../../../server/http/with-route";

export const POST = withRoute({ auth: "user", rateLimit: { scope: "mfa-setup", limit: 5, windowSeconds: 3600 } }, async ({ session }) => {
  await requirePendingAdmin(session!);
  const secret = await beginTotpSetup(await getSessionAccessToken(session!));
  return Response.json({ secret });
});
