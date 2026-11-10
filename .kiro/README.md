# .kiro

Kiro configuration for this project. Both directories below are versioned so the development process can be
reviewed.

- **[`specs/`](specs/)** — 11 feature specs (S1–S11). Each has `requirements.md` (testable statements such as
  `R-CONF-4`), `design.md` and `tasks.md`, which is checked off as work ships. Specs are written in Portuguese
  (pt-PT) by project convention; the product, its code and its interface are in English.
- **[`steering/`](steering/)** — three always-on documents applied to every Kiro session:
  - `product.md` — what Theckards is and the eleven non-negotiable guardrails (G1–G11).
  - `tech.md` — stack rules, including an ADR before adopting any AWS service.
  - `production.md` — the definition of done for anything that reaches production.

A write-up of how these were used, and where they changed the result, is in
[`docs/kiro-usage.md`](../docs/kiro-usage.md).

Session artifacts produced while working (screenshots, deploy logs, sandbox permissions) are kept out of the
repository through `.git/info/exclude`, a local file. They are deliberately not listed in `.gitignore`.
