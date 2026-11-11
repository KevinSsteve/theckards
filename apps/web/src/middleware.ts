import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce, s3BucketOrigin } from "./server/http/csp";

/** Gives every page its own Content-Security-Policy and nonce (server/http/csp.ts). */
export function middleware(request: NextRequest) {
  // Evidence goes from the browser straight to S3 with a presigned PUT (agreements/[id]/RecordPanel.tsx).
  const evidenceUploads = s3BucketOrigin(process.env.EVIDENCE_QUARANTINE_BUCKET, process.env.AWS_REGION ?? "us-east-1");
  const policy = contentSecurityPolicy({
    nonce: newNonce(),
    connectTo: evidenceUploads ? [evidenceUploads] : [],
    development: process.env.NODE_ENV === "development",
  });
  // Next.js takes the nonce from the policy on the request and stamps it on the scripts it renders. Setting it here
  // also replaces any policy header a client sent.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // Everything except responses that are never a document: API routes (data, and PDFs that Chrome's viewer must be
  // free to style; an unmatched API path answers JSON, app/api/[...path]/route.ts), build assets, and the exact
  // paths of the health checks, the published key set and the icon. Exact, because Next.js answers any other path
  // with its HTML 404 page, which needs the policy like every page: a prefix such as `healthz` would exempt
  // /healthz/anything.
  matcher: ["/((?!api/|_next/static/|healthz$|readyz$|\\.well-known/theckards-keys\\.json$|icon\\.svg$).*)"],
};
