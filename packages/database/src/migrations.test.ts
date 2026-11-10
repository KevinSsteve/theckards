import { describe, expect, it } from "vitest";
import { migrations } from "./migrations.js";

describe("database migrations", () => {
  it("have unique, ordered identifiers", () => {
    const ids = migrations.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("seed legal documents as drafts", () => {
    const seed = migrations.find((migration) => migration.id === "0002")?.sql ?? "";
    expect(seed).toContain("'DRAFT'");
    expect(seed).not.toMatch(/'APPROVED'/);
  });

  it("keeps consent and audit tables append-only", () => {
    const schema = migrations.find((migration) => migration.id === "0001")?.sql ?? "";
    expect(schema).toContain("user_consents_append_only");
    expect(schema).toContain("audit_logs_append_only");
    expect(schema).not.toContain("DROP TABLE");
  });
});
