# Security scan (R-SEC-3)

R-SEC-3 asks for a DAST scan with no critical or high findings. The passive OWASP ZAP scan of production on
2026-11-11, against release `a40276b`, reports **High 0, Medium 0, Low 0** and four informational findings, each
triaged below. The scan first found one Medium issue: no Content-Security-Policy anywhere. Getting it to zero
took two releases and a set of changes to the application, recorded here with what was measured.

## How the scan works

- **Tool.** ZAP 2.17.0 (cross-platform release, SHA-256
  `94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0`), run by its Automation Framework from
  [`scripts/zap/production-passive.yaml`](../scripts/zap/production-passive.yaml) through
  [`scripts/zap/run.sh`](../scripts/zap/run.sh).
- **Passive only.** ZAP requests 13 seed URLs: the public pages, the four legal texts, a 404, the published key
  set, one public verification, an unauthenticated API call and both health checks. It then follows links for
  up to three minutes (45 URLs found) and inspects every response. It submits no forms and has no active-scan
  job, so it sends no attack payloads and cannot create data. An active scan belongs on a staging environment:
  against production it would write records that cannot be deleted and trip the WAF.
- **Not a scan of the block page.** The WAF's `NoUserAgent_HEADER` rule blocks requests without a User-Agent, so the
  plan sends one that names the scan. `run.sh` refuses to report if any finding came from a 403 response.
- **Signed out.** ZAP did not crawl pages behind sign-in. Those were checked in a browser instead (below).

`run.sh` exits 1 on any Medium or High finding and 2 if the WAF blocked the scanner. Reports go to
`.kiro/artifacts/zap/`, which is not committed.

## Results

| Run | Release | High | Medium | Low | Informational |
| --- | --- | --- | --- | --- | --- |
| First scan | `876e56a` | 0 | 1: CSP header not set (10038) on `/`, `/verify`, `/legal/esign`, `/legal/notice` | 0 | 4 |
| After the policy | `cc49a1d` | 0 | 1: CSP header not set on `/api/public`, `/api/public/verify` | 0 | 4 |
| **Final** | **`a40276b`** | **0** | **0** | **0** | **4** |

The second Medium finding was the HTML 404 page. Next.js answers any unmatched path with it, and the middleware
skipped everything under `/api/` and every path that merely started with an excluded name. The crawler derived
`/api/public` from the verification URL. Exclusions are now exact paths, and an unmatched `/api` path answers a
`problem+json` 404 instead of HTML.

### Informational findings, triaged

| Rule | Where | Verdict |
| --- | --- | --- |
| 10015 Re-examine Cache-control Directives | `/.well-known/theckards-keys.json` (`public, max-age=3600`), `/api/public/verify/<hash>` (`public, max-age=60`), `/healthz` and `/readyz` (`no-store`) | Intended. The key set and verification answers are public by design ([ADR-019](adr/019-public-seal-verification.md)) and cached briefly. Health checks must never be cached. |
| 10027 Suspicious Comments | The words "bug", "select" and "from" in minified React and Next.js chunks; "Select" on `/verify` | False positive. The chunks are framework code; on `/verify` it is the page's own instruction, "Select a PDF or paste its SHA-256". |
| 10050 Retrieved from Cache | CloudFront hits on immutable build assets, the key set and one verification answer | Intended. Only public responses without personal data are cacheable. Every page is `private, no-cache, no-store`. |
| 10112 Session Management Response Identified | `/api/auth/login` sets `__Host-theckards_auth_tx` | An identification, not a weakness. The sign-in transaction cookie is `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, and lasts 10 minutes. |

## The Content-Security-Policy

Every HTML response gets its own policy from [`apps/web/src/middleware.ts`](../apps/web/src/middleware.ts), with a
new nonce per request:

```
default-src 'self';
script-src 'self' 'nonce-<per request>' 'strict-dynamic' 'wasm-unsafe-eval';
style-src 'self' 'nonce-<per request>';
img-src 'self';
connect-src 'self' https://theckards-prod-evidence-quarantine-116708768297.s3.us-east-1.amazonaws.com;
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- A script runs only if it carries the request's nonce, or was loaded by a script that did. Injected markup
  cannot run: a `<script>` from an injection has no nonce, and inline event handlers and `javascript:` URLs are
  refused.
- No `'unsafe-inline'` and no `'unsafe-eval'`. ZAP rates either one Medium. In a local control run, a policy with
  `'unsafe-inline'` raised three Medium findings, and this one raised none.
- `'wasm-unsafe-eval'` exists for one reason: `/verify` hashes the file in the page with WebAssembly (hash-wasm),
  so the PDF is never uploaded.
- `connect-src` names the evidence quarantine bucket because the browser uploads evidence straight to S3 with a
  presigned PUT. The origin is built from the service's own configuration, and a test pins it to the host the
  AWS SDK presigner signs for.
- API routes carry no policy. They return JSON, PDFs and ZIPs, not documents, and the PDFs open in the browser's
  viewer. `Permissions-Policy` (camera, microphone, geolocation, payment and usb off) and
  `Cross-Origin-Opener-Policy: same-origin` apply everywhere, through `next.config.mjs`.
- There is no violation reporting. Browsers send reports without credentials, so a report endpoint would accept
  unauthenticated writes from anyone, which the production rules do not allow. Tests stop the known causes at
  build time instead (see [csp-violation](runbooks/csp-violation.md)).

### What the application had to change

| Change | Why | Cost or gain, measured |
| --- | --- | --- |
| Every page renders per request (`await connection()` in the root layout) | Next.js stamps the nonce while rendering. A page prerendered at build time has scripts without it, and the browser refuses them. | Median time to first byte, 12 requests each from us-east-1: `/` 23 → 31 ms, `/verify/how` 22 → 29 ms, `/legal/terms` 29 → 31 ms, `/verify` 29 → 28 ms. |
| The 14 `style={{}}` props became classes in `globals.css` | Under this policy the browser ignores style attributes in server-rendered HTML. | A replaced case proposal now uses `--muted` (5.38:1) instead of 0.6 opacity, which measured 4.36:1, under WCAG's 4.5:1. |
| No zod in the browser: the domain package is `sideEffects: false`, and the approval checks the Admin dashboard runs moved to a zod-free module | zod tests whether eval is allowed when it builds a schema. It catches the refusal, but the browser still reported a violation on `/verify`. | `/verify` first-load JavaScript 139 → 111 kB (`next build`). |
| Exact middleware exclusions, and a JSON 404 for unmatched `/api` paths | The HTML 404 page was served without the policy (second scan). | None. |

## Verified in production

Against release `a40276b` on 2026-11-11, unless marked `cc49a1d` (the first release with the policy):

- **Every page response carries the policy, and the nonce differs per request.** Each `<script>` carries it and no
  server HTML contains a style attribute. Checked by fetching `/`, `/verify`, `/verify/how`, the four legal texts,
  a 404 and `/dashboard` (`cc49a1d`). Unmatched paths such as `/healthz/x` and `/favicon.ico` return the 404 page
  with the policy. `/healthz`, the key set, the API and build assets return none.
- **No violation reports in a real browser.** Headless Chrome 151 reported none on `/`, `/verify`, `/verify/how`,
  the legal texts and the 404 page. Signed in with a test account (`cc49a1d`), it reported none on `/dashboard`,
  `/account`, `/agreements/new` and an agreement with a resolved case, and the class-based styles applied (computed
  styles checked). The test account was given a one-off password, then disabled again with a new random password.
- **The protected features still work.** `/verify` hashed the sealed demo PDF in the page and showed seal impression
  "SEAL A9B3 B22E". A request to the evidence bucket was allowed, and one to another origin was refused.
- **Injection is refused.** An injected inline event handler did not run, and an injected style attribute did not
  apply. Both were reported as violations.

Not exercised in a browser: the in-person QR code and confirmation-code screens, a real evidence upload, and the
Admin dashboard, which needs the owner's MFA. Running the first two would write signatures and evidence to
production, which cannot be deleted. Tests cover these instead. The QR SVG contains only shapes and presentation
attributes. The upload origin matches the presigner. No component carries a style attribute. The build output shows
no zod in any browser chunk, Admin included.

## Not covered yet

- **An active scan.** It needs a staging environment.
- **An authenticated ZAP scan** of the signed-in pages.
- **A schedule.** The scan runs by hand with `scripts/zap/run.sh`, and the browser check is manual: open the pages
  above with the developer tools console open and confirm there is no line starting with `Refused to`.
