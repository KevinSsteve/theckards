import { z } from "zod";
import { verifyTotpSetup } from "../../../../../server/auth/cognito";
import { getSessionAccessToken, requirePendingAdmin, revokeSession } from "../../../../../server/auth/session-store";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ code: z.string().regex(/^\d{6}$/) });

export const POST = withRoute({ auth: "user", schema: Body, rateLimit: { scope: "mfa-verify", limit: 5, windowSeconds: 600 } }, async ({ session, body }) => {
  await requirePendingAdmin(session!);
  await verifyTotpSetup(await getSessionAccessToken(session!), body.code);
  await revokeSession(session!.sessionHash);
  return Response.json({ next: "/api/auth/login?intent=admin" });
});
