import { describe, expect, it } from "vitest";
import { legalDocumentApprovalBlockers } from "./legal.js";

describe("legal document approval guard", () => {
  it("blocks an obviously truncated Terms document even without placeholders", () => {
    expect(legalDocumentApprovalBlockers("TERMS", "Only the final clauses remain."))
      .toContain("document is too short for TERMS");
  });

  it("keeps unresolved owner fields blocked", () => {
    const body = `${"x".repeat(4_000)} [TO COMPLETE: operator]`;
    expect(legalDocumentApprovalBlockers("TERMS", body)).toContain("[TO COMPLETE: operator]");
  });
});
