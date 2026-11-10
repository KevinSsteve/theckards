import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "../../../../../server/auth/cookies";
import { withRoute } from "../../../../../server/http/with-route";
import { counterpartyStatus } from "../../../../../server/in-person";

/** Public (QR token): polled by the counterparty's device. Details only for the bound device. */
export const GET = withRoute({ auth: "public", rateLimit: { scope: "in-person-poll", limit: 2400, windowSeconds: 3600 } }, async ({ params }) => {
  const jar = await cookies();
  return Response.json(await counterpartyStatus(params.token!, jar.get(DEVICE_COOKIE)?.value));
});
