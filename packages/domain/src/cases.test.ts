import { describe, expect, it } from "vitest";
import { renderAddendum } from "./cases.js";

const base = { agreementTitle: "Bicycle sale", originalSealId: "seal-1", originalSha256: "a".repeat(64), proposalBody: "Seller refunds USD 100 in cash by 2026-11-20.", proposedBy: "Alex (seller)", proposedAt: "2026-11-10", acceptedBy: "Jamie (buyer)", acceptedAt: "2026-11-11" };

describe("resolution addendum text (G2, G3, G4, G9)", () => {
  it("reproduces the accepted proposal verbatim and references the original seal", () => {
    const text = renderAddendum(base).flatMap((s) => s.paragraphs).join("\n");
    expect(text).toContain(base.proposalBody);
    expect(text).toContain("seal seal-1");
    expect(text).toContain("does not replace or modify the original sealed record");
  });
  it("never states a winner, fault, guarantee, enforcement or legal validity", () => {
    const text = renderAddendum({ ...base, proposalBody: "x" }).flatMap((s) => [s.heading, ...s.paragraphs]).join(" ");
    expect(text).not.toMatch(/winner|at fault|guarantee|legally binding|valid|enforceable|Theckards (decided|determined|finds)/i);
    expect(text).toContain("Theckards did not decide this resolution");
  });
});
