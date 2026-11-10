# Demo video: script and shot list

Kiroween judges stop watching at three minutes, so this is cut to **2:45**. It shows one complete journey
(create → sign in person → seal → verify) and ends on how Kiro built it, because "implementation of Kiro" is one
of the three judging criteria.

Narration is written to be read aloud at a normal pace, about 2.4 words per second. Word counts are given per
shot so you can tell immediately if you are running long.

---

## Before you record

1. **Use a demo account, not your own.** Sign up at https://theckards.linkealls.com with an address you are happy
   to show on screen, and accept the legal documents once so the banner does not appear mid-take.
2. **Seal a fresh agreement.** Sealed bytes are immutable, so the two records sealed earlier today carry no
   printed impression. Only an agreement sealed from now on shows the wax mark. Do a full practice run, keep the
   sealed PDF from it, and use that file for the verification shot.
3. **Two windows, two shapes.** Window A: your normal browser, signed in, 1080p. Window B: a second browser
   profile or an incognito window with device emulation set to a phone. Window B needs **no account** — the QR
   link carries a single-use guest token.
4. **Prepare a tampered copy.** Take the sealed PDF, change one byte, save it as `tampered.pdf`:
   ```sh
   cp sealed.pdf tampered.pdf && printf 'x' | dd of=tampered.pdf bs=1 seek=900 conv=notrunc
   ```
5. **Have the hash ready as a fallback.** If the file picker misbehaves on camera, `/verify` also accepts a typed
   SHA-256. Compute it with `shasum -a 256 sealed.pdf`.
6. **Browser zoom 110–125 %.** Judges may watch on a laptop in a window.

## What not to show

- No real personal data: no personal email addresses, no real phone numbers, no real serial numbers. The product
  rule is that we never log personal data; do not put it in the video either.
- Do not film typing a password. Use a password manager, or cut from the sign-in button to the dashboard.
- Keep out of `/admin`. It holds legal texts and owner settings and adds nothing to the story.
- Skip the **Case** and **Evidence** panels until Privacy Policy v4 and ESIGN v3 are approved. Until then they
  show "opens after the updated Privacy Policy is approved", which reads as unfinished on camera.

---

## Shot list

### 1 · Cold open — the mark (0:00–0:12)

**Screen:** the signature certificate page of a sealed PDF, zoomed on the wax seal and its `SEAL ####` caption.

> For centuries, two people closed a deal by pressing a signet ring into wax. Breaking the wax showed tampering.
> Theckards brings that ceremony back, with cryptography doing the work the wax used to do.

*(32 words)*

### 2 · Create the agreement (0:12–0:32)

**Screen:** `/dashboard` → **New agreement** → template **Purchase and sale** → fill the fields → submit.

> Two people standing next to each other: one sells a phone, the other pays four hundred dollars in cash. Pick a
> template, enter only the facts. There is no free text box and no legal advice. The form fills a reviewed
> template, and that is all it does.

*(48 words)*

### 3 · The creator signs (0:32–0:50)

**Screen:** the agreement page, scroll the rendered document, type the full name, tick the consent box, **Sign**.

> The creator reads the exact document that will be sealed, types their name and consents explicitly. That
> consent, the method and the timestamp all end up on the record.

*(29 words)*

### 4 · The ceremony: signing in person (0:50–1:28)

**Screen:** **Show QR code** in window A → window B (phone) opens the link → review → type name → consent →
**Sign** → the six-digit code appears → back to window A → type the code → **Confirm signature**.

> Now the part that replaces the emailed link. The other party scans a single-use QR code with their own phone,
> reads the same agreement, and signs on their device. Their phone then shows a six-digit code. I type that code
> on my screen. Neither of us can complete this alone, and neither of us has to wait for an email.

*(62 words)*

### 5 · Sealed (1:28–1:55)

**Screen:** the page reloads as executed → **Download sealed PDF** → open it → scroll to the certificate page →
zoom on the impression beside the QR code.

> A worker renders a deterministic PDF, hashes it, and AWS KMS signs an integrity receipt with a private key that
> never leaves AWS. The seal presses its own impression, derived from the seal identifier, so every record has a
> distinct mark.

*(42 words)*

### 6 · Anyone can check it (1:55–2:20)

**Screen:** `/verify` in a clean window → choose the sealed PDF → **Valid Theckards seal** with the impression on
screen → choose `tampered.pdf` → **No matching seal**.

> Verification needs no account. The browser hashes the file on your device; the file is never uploaded. The same
> impression is drawn on screen, so you can compare it with the one printed on the page. Change a single byte and
> the seal stops matching.

*(45 words)*

### 7 · How Kiro built it (2:20–2:45)

**Screen:** the repository, scrolling `/.kiro` → `specs/` → `steering/` → `hooks/`, then `docs/adr/`, then a
terminal showing `pnpm test` passing.

> Theckards was built with Kiro: eleven specs, three steering documents that applied to every session, and two
> agent hooks. Steering is why there are twenty architecture decision records, each with a fixed monthly cost, and
> why the product guardrails became assertions. One test proves that one party alone can never reach "confirmed
> by both".

*(55 words)*

**Closing card (last 3 seconds, no narration):**

```
Theckards · theckards.linkealls.com
Built with Kiro · Resurrection
github.com/KevinSsteve/theckards
```

---

## Totals

| | |
| --- | --- |
| Narration | ~313 words, about 2:10 of speech |
| Runtime | 2:45, leaving ~35 s of silence for the actions on screen |
| Shots | 7 |

## Recording notes

- 1080p, 30 fps is enough. Mono voice recorded separately is easier to re-cut than live narration.
- **Add on-screen captions.** Judges often watch muted. Each shot's first sentence as a subtitle is enough.
- Keep the mouse still while you speak; move it only during the action beats.
- Speed up the typing in shots 2 and 3 to 2× if you run long. Never speed up shot 4: the two-device exchange is
  the thing that needs to be believed.
- Upload public on YouTube or Vimeo, no sign-in required, English audio or captions.

## If something fails mid-take

Record in this order so a failure costs you one shot, not the take: 4 → 5 → 6 → 2 → 3 → 1 → 7. Shot 4 produces
the artifacts the later shots need, and shot 1 is just a zoom on the file shot 5 produced.
