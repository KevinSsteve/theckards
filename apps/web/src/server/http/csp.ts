/**
 * The Content-Security-Policy of every page (R-SEC-3), built fresh for each request by src/middleware.ts.
 *
 * Scripts run only if they carry this request's nonce, or were loaded by a script that did ('strict-dynamic'). An
 * injected <script>, inline event handler or javascript: URL does nothing. Next.js reads the nonce from the policy on
 * the request and stamps it on the scripts it renders, which works only for pages rendered per request, so the root
 * layout opts every page out of prerendering (app/layout.tsx).
 *
 * Styles come only from the stylesheet. Without 'unsafe-inline' the browser ignores every style attribute in
 * server-rendered HTML, so the components carry none (middleware.test.ts). Styles that React sets after load go
 * through the CSSOM, which CSP does not restrict.
 *
 * Imported by the middleware, so it must not depend on Node.js modules.
 */

// 16 random bytes, base64: 24 characters. Anything else could break out of the policy string.
const NONCE = /^[A-Za-z0-9+/]{22}==$/;
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** A nonce that cannot be guessed, new for every response. */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Where the browser sends a presigned evidence upload: the virtual-hosted, regional endpoint that
 * @aws-sdk/s3-request-presigner signs for (pinned by a test). Undefined if either value is missing or malformed,
 * so a bad setting cannot widen or break the policy.
 */
export function s3BucketOrigin(bucket: string | undefined, region: string | undefined): string | undefined {
  if (!bucket || !region || !BUCKET.test(bucket) || !REGION.test(region)) return undefined;
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

export interface PolicyOptions {
  nonce: string;
  /** Origins a page may send requests to besides its own, such as the evidence upload bucket. */
  connectTo?: readonly string[];
  /** `next dev` evaluates code for fast refresh and injects styles without the nonce. Never in production. */
  development?: boolean;
}

export function contentSecurityPolicy({ nonce, connectTo = [], development = false }: PolicyOptions): string {
  if (!NONCE.test(nonce)) throw new Error("The CSP nonce must be 16 bytes of base64.");
  for (const origin of connectTo) {
    if (!HTTPS_ORIGIN.test(origin)) throw new Error("CSP connect-src accepts https origins only.");
  }
  const directives: string[][] = [
    ["default-src", "'self'"],
    // 'self' is for browsers older than 'strict-dynamic'; the ones that understand it ignore 'self'.
    // 'wasm-unsafe-eval' lets hash-wasm compile its SHA-256 module, so /verify can hash a file without uploading it.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(development ? ["'unsafe-eval'"] : [])],
    // A nonce switches 'unsafe-inline' off, so development gets one or the other.
    ["style-src", "'self'", development ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    ["img-src", "'self'"],
    ["connect-src", "'self'", ...connectTo],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    // Neither falls back to default-src, so each is stated.
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}
