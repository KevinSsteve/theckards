import { dossierArtifact } from "../../../../../../../server/dossier";
import { ProblemError } from "../../../../../../../server/http/problem";
import { withRoute } from "../../../../../../../server/http/with-route";

/** The archive's integrity receipt, delivered beside it: a receipt cannot live inside the file it signs. */
export const GET = withRoute({ auth: "user", rateLimit: { scope: "dossier-receipt", limit: 120, windowSeconds: 3600 } }, async ({ session, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.requestId ?? "")) throw new ProblemError(404, "Not Found", "Dossier not found.");
  const artifact = await dossierArtifact(session!.userId, params.id!, params.requestId!);
  return new Response(`${JSON.stringify(artifact.receipt, null, 2)}\n`, { headers: {
    "content-type": "application/json",
    "content-disposition": `attachment; filename="${artifact.filename.replace(/\.zip$/, "")}.receipt.json"`,
  } });
});
