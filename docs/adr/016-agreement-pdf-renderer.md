# ADR-016 — Agreement preview PDF renderer

Status: Accepted (2026-11-10)

## Requirement
Render versioned agreement previews in under 10 seconds p95, with stable bytes for the same immutable input and Unicode-capable embedded fonts.

## Decision
Use `pdf-lib` 1.17.1 with `@pdf-lib/fontkit` and the OFL-licensed Noto Sans package. Disable automatic metadata updates, set all metadata timestamps from the immutable version timestamp, embed a subset of the font and save without object streams. A regression test renders the same version twice and compares SHA-256 hashes.

## Estimated fixed monthly cost
US$0 fixed; Fargate CPU and S3 request/storage usage only.

## Simpler alternative
Render HTML in the browser. Rejected because final records need a stable downloadable artefact and server-side hash.

## Operational risk
A library/font upgrade can change bytes and hashes. Pin versions through the lockfile and never re-render an existing signed version with a different renderer revision.

## Source
- [pdf-lib PDFDocument API](https://pdf-lib.js.org/docs/api/classes/pdfdocument)

Content was rephrased for compliance with licensing restrictions.
