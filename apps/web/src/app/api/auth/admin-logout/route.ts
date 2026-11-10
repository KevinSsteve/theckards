import { cookies } from "next/headers";
import { cognitoLogoutUrl } from "../../../../server/auth/cognito";
import { ADMIN_COOKIE, CSRF_COOKIE } from "../../../../server/auth/cookies";
import { revokeSession } from "../../../../server/auth/session-store";
import { withRoute } from "../../../../server/http/with-route";

export const POST = withRoute({ auth: "admin" }, async ({ session }) => {
  await revokeSession(session!.sessionHash);
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  jar.delete(CSRF_COOKIE);
  return Response.json({ logoutUrl: cognitoLogoutUrl() });
});
