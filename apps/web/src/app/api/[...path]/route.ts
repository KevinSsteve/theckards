import { ProblemError } from "../../../server/http/problem";
import { withRoute } from "../../../server/http/with-route";

/**
 * Any /api path no route handles. Without this, Next.js answers with its HTML 404 page, a document the
 * Content-Security-Policy does not cover, because the middleware leaves /api alone (src/middleware.ts). An API
 * client gets a machine-readable 404 instead. Reads nothing, writes nothing.
 */
const boundary = withRoute({ auth: "public" }, () => {
  throw new ProblemError(404, "Not Found", "No API route matches this path.");
});

// A catch-all's params hold an array of segments, which the boundary does not take, and this handler reads none.
const notFound = (request: Request) => boundary(request, { params: Promise.resolve({}) });

export { notFound as DELETE, notFound as GET, notFound as PATCH, notFound as POST, notFound as PUT };
