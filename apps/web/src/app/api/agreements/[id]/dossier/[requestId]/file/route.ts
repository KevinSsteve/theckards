import { dossierArtifact } from "../../../../../../../server/dossier";
import { ProblemError } from "../../../../../../../server/http/problem";
import { withRoute } from "../../../../../../../server/http/with-route";
import { getPrivateObject } from "../../../../../../../server/storage";

/** Party-only, requester-only, and only once the archive has been sealed. Always an attachment. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "dossier-download", limit: 60, windowSeconds: 3600 } }, async ({ session, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.requestId ?? "")) throw new ProblemError(404, "Not Found", "Dossier not found.");
  const artifact = await dossierArtifact(session!.userId, params.id!, params.requestId!);
  const bytes = await getPrivateObject(artifact.key);
  return new Response(Buffer.from(bytes), { headers: {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${artifact.filename}"`,
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  } });
});
