import { z } from "zod";
import { addMilestone } from "../../../../../server/agreements";
import { readIfMatch } from "../../../../../server/http/etag";
import { withRoute } from "../../../../../server/http/with-route";

const Body = z.object({ title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({ offset: true }) });

export const POST = withRoute({ auth: "user", schema: Body, idempotent: "milestone-create" }, async ({ request, session, body, params }) => {
  const milestone = await addMilestone({ userId: session!.userId, agreementId: params.id!, expectedLockVersion: readIfMatch(request), ...body });
  return Response.json({ milestone }, { status: 201 });
});
