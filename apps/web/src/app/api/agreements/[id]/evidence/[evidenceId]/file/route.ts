import { evidenceObject } from "../../../../../../../server/evidence";
import { ProblemError } from "../../../../../../../server/http/problem";
import { withRoute } from "../../../../../../../server/http/with-route";
import { getPrivateObject } from "../../../../../../../server/storage";

/** Party-only, and only for a file that passed the malware check. Always an attachment, never rendered inline. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "evidence-download", limit: 200, windowSeconds: 3600 } }, async ({ session, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.evidenceId ?? "")) throw new ProblemError(404, "Not Found", "Evidence not found.");
  const object = await evidenceObject(session!.userId, params.id!, params.evidenceId!);
  const bytes = await getPrivateObject(object.key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": object.contentType,
    "content-disposition": `attachment; filename="${object.filename.replace(/[^\w.\- ]/g, "_")}"`,
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  } });
});
