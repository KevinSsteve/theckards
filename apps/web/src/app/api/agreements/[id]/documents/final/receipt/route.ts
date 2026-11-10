import { getAgreement } from "../../../../../../../server/agreements";
import { ProblemError } from "../../../../../../../server/http/problem";
import { withRoute } from "../../../../../../../server/http/with-route";
import { finalReceiptFor } from "../../../../../../../server/signing";

export const GET = withRoute({ auth: "user", rateLimit: { scope: "final-receipt-download", limit: 100, windowSeconds: 3600 } }, async ({ session, params }) => {
  await getAgreement(session!.userId, params.id!);
  const receipt = await finalReceiptFor(params.id!);
  if (!receipt) throw new ProblemError(404, "Not Found", "The receipt is not available yet.");
  return Response.json(receipt, { headers: {
    "content-disposition": `attachment; filename="theckards-${receipt.id}.receipt.json"`,
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
