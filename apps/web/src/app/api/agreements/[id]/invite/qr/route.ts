import QRCode from "qrcode";
import { invitationLink } from "../../../../../../server/agreements";
import { withRoute } from "../../../../../../server/http/with-route";

/** Creator-only: current invitation link plus a QR code (SVG) for the counterparty to scan in person. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "invite-qr", limit: 60, windowSeconds: 3600 } }, async ({ session, params }) => {
  const link = await invitationLink(session!.userId, params.id!);
  const svg = await QRCode.toString(link.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return Response.json({ ...link, svg });
});
