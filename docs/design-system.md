# Theckards interface system

The interface should feel quiet, direct and dependable. The design helps two people read and act on a record; it
must not make promises that the product does not make. The implementation lives in
[`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) and uses no UI library, external font, remote image
or client-side styling runtime.

## Principles

1. **The record is the focus.** Navigation is compact. Agreement terms, signatures and next actions receive the
   strongest hierarchy.
2. **Space before decoration.** Separation comes from spacing, type and one-pixel borders. Shadows are quiet and
   never communicate state.
3. **One primary action at a time.** Green is reserved for the action that moves a flow forward. Secondary actions
   are white. Destructive actions are dark red and always retain their confirmation step.
4. **Words carry meaning.** Colour supports status but never replaces its text. The product never uses ratings,
   scores or labels about people.
5. **Mobile is the hard constraint.** Every screen works without horizontal page scroll at 320 px. Dense action
   groups stack; grids become one column; Admin navigation becomes a visible 2×2 grid.
6. **Functional marks stay functional.** The QR code keeps a white quiet zone. The generated seal impression keeps
   its geometry and colours so it remains comparable with already sealed PDFs.

## Foundations

### Colour

| Role | Token | Value |
| --- | --- | --- |
| Main text | `--ink` | `#17201d` |
| Secondary text | `--muted` | `#5e6a65` |
| Primary action | `--accent` | `#126b4b` |
| Destructive action | `--danger` | `#9b2c2c` |
| Page | `--canvas` | `#f4f6f5` |
| Card | `--surface` | `#ffffff` |
| Quiet surface | `--paper` | `#f8faf9` |
| Seal accent | `--seal` | `#7a1f1f` |

Body text is 16.66:1 on cards and 15.35:1 on the page. Secondary text is at least 4.85:1 on every soft surface.
White text on primary buttons is 6.50:1. Field borders are at least 3.09:1 on every surface.

### Type

The stack is the operating system's sans serif. This avoids a render-blocking font request, keeps private pages
self-contained and needs no wider Content-Security-Policy. Headings use weight and tight tracking rather than a
second family. Body copy uses a 1.55 line height; long legal copy uses 1.72 and stays within 68 characters.

### Shape and depth

Controls use a 0.55 rem radius, cards 0.9 rem and prominent editorial panels 1.25 rem. Cards have one border and a
small two-part shadow. Nested cards lose the shadow and use the quiet surface, so hierarchy remains clear without
adding colours.

## Patterns

- **Top bar.** The mark and product name lead. At 560 px, groups move to a second row instead of squeezing or
  overlapping.
- **Page header.** An optional uppercase kicker, one `h1`, a short lead and an optional primary action.
- **Card.** One topic or one action. The first and last children own no outside margin.
- **Status badge.** Text plus a dot. Red is used only for failed, cancelled, unavailable or withdrawn states.
- **Forms.** Inputs are at least 45 px high and remain 16 px on phones, avoiding iOS zoom. Labels precede fields.
  Busy buttons stay focusable through `aria-disabled`; incomplete forms use native `disabled`.
- **Notices.** Pale amber means important context, not success. Success and error messages include text and a
  bordered soft background when they carry a live-region role.
- **Lists of records.** Slots and timelines use separators, never zebra stripes. Long names, hashes and user text
  wrap without widening the page.
- **Admin.** A sticky side navigation on desktop, a 2×2 navigation grid on phones, and internally scrolling audit
  output.

## Responsive behaviour

| Width | Behaviour |
| --- | --- |
| Above 760 px | Two-column home, Admin side navigation, flexible grids. |
| 560–760 px | One-column home and Admin content; Admin navigation is horizontal while all four items fit. |
| 320–560 px | Top-bar action groups take their own row; main action groups stack; grids are one column; Admin navigation is 2×2; definition lists and seal results stack. |

The content shell is fluid and capped at 70 rem. Reading pages are capped at 47.5 rem. Grid columns use
`minmax(min(100%, 17rem), 1fr)`, so their minimum can never exceed the viewport.

## Accessibility and security constraints

- Every page has one `#main-content`, reached by the first keyboard-focusable item, “Skip to content”.
- Focus uses the same three-pixel green ring throughout.
- The Content-Security-Policy rejects style attributes. Add a class to `globals.css`; never use `style={{...}}`, a
  CSS-in-JS runtime or a remote stylesheet.
- Do not replace the shared `Button` busy state with `disabled={busy}`. That loses keyboard and screen-reader focus.
- Keep labels, live regions, focus-transfer refs and conditional DOM transitions intact when changing appearance.
- Do not put controls inside dashboard card links.
- Do not embed PDFs in a frame or introduce a custom viewer. Downloads and browser tabs preserve the current CSP
  and accessibility boundary.

## Verification matrix

For a visual change, check 320, 390, 768 and 1440 px; 200% zoom; keyboard order; no horizontal page scroll; no
CSP console errors; and axe WCAG 2.2 AA. The main state set includes home, verification result, empty and populated
dashboard, agreement before and after signing, evidence, case/addendum, dossier, guest OTP, in-person code, legal
consent, expired links, Admin settings/legal/audit, loading, error and 404.

## Production verification

Release `c10bd27` was checked on 2026-11-11 at 320, 390, 768 and 1,440 px. Across 40 public and 24 signed-in
route/width combinations, axe found no WCAG or best-practice violation and the document never exceeded the
viewport. Buttons remain at least 44 px high; checkbox and radio labels are at least 28 px. The skip link transfers
focus to the main content and normal-browser runs reported no CSP violation.

Under the Lighthouse mobile throttling profile, the six measured pages stayed between 1,288 and 1,704 ms LCP and
102–111 KB initial JavaScript. The passive production ZAP scan remained High 0, Medium 0, Low 0. Detailed coverage,
the two manually resolved axe contrast checks on the long agreement, and the states that could not be recreated
without writing append-only production records are in [accessibility.md](accessibility.md).
