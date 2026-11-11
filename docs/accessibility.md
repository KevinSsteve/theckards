# Accessibility and page performance

R-A11Y-1 asks for WCAG 2.2 AA on the main flows, checked with axe and by hand, with LCP at or under 2.5 s and
initial JavaScript under 200 KB. This page records what was measured in production on 2026-11-11, what was wrong,
what changed, and what has **not** been checked.

## How it was measured

| | |
| --- | --- |
| Rules | axe-core **4.14.0**, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, plus `best-practice` |
| Integrity | Loaded from jsDelivr with SRI `sha384-lFUXB8tI4BaTE1bqxH9eeAXON2NH1qsdAhs7S5L++nUNP5QOy+hwr0C3TYEJUEl0`; a deliberately wrong hash was refused, so integrity was enforced |
| Browser | Chromium 151 driven by Playwright, desktop 1280×900 and mobile 390×844 with touch |
| By hand | Scripted keyboard walks recording where focus lands, contrast computed from computed styles, reflow at 320 CSS px, page titles, and what happens when the session ends with a page open |
| Performance | Lighthouse's mobile throttling values applied through the DevTools protocol: 4× CPU, 562.5 ms request latency, 1.44 Mbps down, cache disabled. This is the same profile Lighthouse uses, not Lighthouse itself |

## Result: axe

**Zero violations, zero incomplete checks, zero best-practice findings on all 18 page states**, after the fixes:

- Public, desktop: `/`, `/verify`, `/verify/how`, the four legal documents, the not-found page.
- Public, mobile: `/`, `/verify`, the counterparty's signing page once signed.
- Signed in: dashboard, account, new agreement, an agreement with a resolved case, an addendum and a dossier.
- The signing flow itself: the creator's sign form on a draft, the QR code shown to the other party, and the
  counterparty's sign form on a phone.

Before the fixes axe already reported no WCAG violations on 18 states, and two best-practice findings on the
framework's default not-found page, which had no `main` landmark. **Every real defect below was invisible to
axe** and was found by measuring.

## What was wrong, and what changed

| Check | Before | After |
| --- | --- | --- |
| Focus while an action runs (2.4.3) | Every action button used `disabled={busy}`. A disabled element cannot hold focus, so pressing "Verify hash" sent focus to `BODY`, and it stayed there after the result appeared | Focus stays on the button, which announces `aria-busy="true"`. Three Enter presses during one check sent one request. 32 controls in 12 components now use `components/Button.tsx` |
| Focus when the control is replaced | "Show QR code", "Sign", "Get the sealed PDF", "Email me a code", "Open a case", "Accept", "Declare" each remove the button that was pressed | Focus moves to what replaces it. Measured: after "Show QR code", focus is on "Ask the other party to scan this code…" |
| Field borders (1.4.11) | `#aab6b0`: **2.09:1** on white, **2.00:1** on the card background | `#7d8a84`: **3.60:1** and **3.43:1** |
| Reflow at 320 px (1.4.10) | After a result, `/verify` was **527 px** wide: seal ids and hashes did not wrap | 320 px |
| Page titles (2.4.2) | Every signed-in page and every legal page was titled "Theckards" | Each page has its own title; the agreement page says "Agreement" rather than the agreement's name, because titles end up in history and synced tabs |
| Session ends with a page open | The agreement page kept polling: **13 failed requests in 31 s**, and the only message was "The record could not be loaded" | **1 request**, then polling stops; one notice takes focus, and "Sign in again" returns to the same agreement (verified end to end) |
| Consent checkbox, every signing form | 13×13 px | 20×20 px, inside a label that also takes the click |
| Not-found page | No `main` landmark, no way back | Main landmark, links home and to `/verify` |
| Focus ring | Browser default | One 3 px ring everywhere, 6.2:1 or better on every background in the stylesheet |

Each fix is pinned by a test that was checked to fail when its defect was reintroduced:
`apps/web/src/app/accessibility.test.ts` (no self-disabling controls, a distinct title per page, contrast computed
from the stylesheet itself, wrapping, checkbox sizing), `components/focus.test.ts` (every focus target can take
focus), `components/Button.test.ts` and `components/session-watch.test.ts`.

## Result: performance

| Page | LCP | Initial JavaScript |
| --- | --- | --- |
| `/` | 1,224 ms | 101.7 KB |
| `/verify` | 1,296 ms | 138.7 KB |
| `/verify/how` | 1,256 ms | 101.7 KB |
| Counterparty signing page | 1,192 ms | 101.7 KB |
| Dashboard | 1,512 ms | 102.7 KB |
| New agreement | 1,244 ms | 103.4 KB |
| Agreement with a resolved case | 1,536 ms | 110.5 KB |

All under both targets: LCP 2.5 s, initial JavaScript 200 KB transferred. `/verify` is the largest because it
hashes files in the browser with `hash-wasm`, which is the price of never uploading the document. Measured from
the sandbox, not a real phone; the throttling makes the numbers comparable with a Lighthouse mobile run, not
identical to one.

## Not checked, and why

- **No screen reader was used.** The checks above are automated or scripted. A pass with NVDA or VoiceOver
  through the signing flow is the most valuable remaining step, and it needs a person.
- **No Lighthouse CI.** The measurement was run by hand. Running the axe pass after each deploy is the natural
  next step, and it needs no credentials for the public pages.
- **The sign-in page** is Amazon Cognito's hosted UI, outside this codebase.
- **The Admin dashboard** was not rendered, because it requires the owner's MFA. Its controls were converted to
  the same `Button`, so the focus fix applies there too.
- **Sealed PDFs are not tagged.** `pdf-lib` cannot write a tagged PDF. Their text can be extracted, but headings
  and reading order are not exposed to assistive technology. The same content is on the agreement page as HTML.
- **The six-digit in-person code** is typed from the other person's screen. WCAG 3.3.8 forbids transcription as
  part of *authentication* unless an alternative exists. Here the person typing is already signed in, and the
  code confirms that the other party is present, so we read it as outside 3.3.8. That is a judgment call, not a
  measurement.

## What the audit left behind in production

Reaching the signing forms needed one real agreement: `db5dab79`, titled "E2E A11Y audit – draft, will be
cancelled", created by the test seller, signed by that account, shown as a QR code, then cancelled. Its QR
session is `CANCELLED`. One signature row remains, because signatures are append-only by design. The test
account was disabled again with its password rotated.
