import { cookies } from "next/headers";
import { GUEST_COOKIE } from "../../../server/auth/cookies";
import { loadGuestSession } from "../../../server/auth/session-store";
import { ProblemError } from "../../../server/http/problem";
import { withRoute } from "../../../server/http/with-route";
import { claimParty } from "../../../server/record";

/**
 * Signed-in user + the counterparty's short guest session (bound signing device): links that party to the account,
 * so the counterparty keeps access after the 2-hour guest window. The agreement and party come only from the guest session.
 */
export const POST = withRoute({ auth: "user", idempotent: "party-claim", rateLimit: { scope: "party-claim", limit: 10, windowSeconds: 3600 } }, async ({ session, requestId }) => {
  const guest = await loadGuestSession((await cookies()).get(GUEST_COOKIE)?.value);
  if (!guest) throw new ProblemError(404, "Nothing to link", "Open this page on the device you signed with, within 2 hours of signing.");
  return Response.json(await claimParty(session!.userId, guest, requestId));
});
