import { cookies } from "next/headers";
import { DEVICE_COOKIE } from "../../../../../server/auth/cookies";
import { ProblemError } from "../../../../../server/http/problem";
import { withRoute } from "../../../../../server/http/with-route";
import { counterpartyView, loadInPersonByToken } from "../../../../../server/in-person";
import { getPrivateObject } from "../../../../../server/storage";

/** Public (QR token): the exact PDF the counterparty is asked to sign, while the session is live. */
export const GET = withRoute({ auth: "public", rateLimit: { scope: "in-person-preview", limit: 60, windowSeconds: 3600 } }, async ({ params }) => {
  const jar = await cookies();
  const context = await loadInPersonByToken(params.token!);
  const view = counterpartyView(context, jar.get(DEVICE_COOKIE)?.value);
  if (!context?.documentS3Key || (view.status !== "OPEN" && view.status !== "AWAITING_CONFIRMATION")) {
    throw new ProblemError(404, "Not Found", "This document is not available.");
  }
  const bytes = await getPrivateObject(context.documentS3Key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="agreement-v${context.versionNumber}.pdf"`,
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
