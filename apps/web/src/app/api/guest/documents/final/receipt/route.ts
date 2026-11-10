import { ProblemError } from "../../../../../../server/http/problem";
import { withRoute } from "../../../../../../server/http/with-route";
import { finalReceiptFor } from "../../../../../../server/signing";

export const GET = withRoute({ auth: "guest", rateLimit: { scope: "guest-final-receipt", limit: 50, windowSeconds: 3600 } }, async ({ guest }) => {
  const receipt = await finalReceiptFor(guest!.agreementId);
  if (!receipt) throw new ProblemError(404, "Not Found", "The receipt is not available yet.");
  return Response.json(receipt, { headers: {
    "content-disposition": `attachment; filename="theckards-${receipt.id}.receipt.json"`,
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
