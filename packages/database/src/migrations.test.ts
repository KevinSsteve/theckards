import { describe, expect, it } from "vitest";
import { AGREEMENT_STATES } from "@theckards/domain";
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

describe("agreement migration", () => {
  it("derives every agreement state from the domain enum", () => {
    const schema = migrations.find((migration) => migration.id === "0003")?.sql ?? "";
    for (const state of AGREEMENT_STATES) expect(schema).toContain(`'${state}'`);
  });

  it("stores immutable versions and hashed invitation tokens", () => {
    const schema = migrations.find((migration) => migration.id === "0003")?.sql ?? "";
    expect(schema).toContain("agreement_versions_content_immutable");
    expect(schema).toContain("invite_token_hash char(64)");
    expect(schema).not.toContain("invite_token text");
  });
});

describe("signing migration", () => {
  const schema = migrations.find((migration) => migration.id === "0004")?.sql ?? "";
  it("makes signatures, guest consents and sealed documents append-only", () => {
    for (const trigger of ["signatures_append_only", "party_consents_append_only", "sealed_documents_append_only"]) expect(schema).toContain(trigger);
  });
  it("allows only one signature per party per version and one seal per hash", () => {
    expect(schema).toContain("UNIQUE(version_id, party_id)");
    expect(schema).toContain("sha256 char(64) NOT NULL UNIQUE");
  });
});
