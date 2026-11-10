import { describe, expect, it } from "vitest";
import { AGREEMENT_STATES, legalApprovalBlockers } from "@theckards/domain";
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

describe("QR invitation migration", () => {
  it("adds the invitation channel and keeps the token only as hash plus KMS ciphertext", () => {
    const schema = migrations.find((migration) => migration.id === "0005")?.sql ?? "";
    expect(schema).toContain("invite_channel IN ('EMAIL', 'LINK')");
    expect(schema).toContain("invite_token_ciphertext bytea");
    expect(schema).not.toMatch(/invite_token text/);
  });
});

describe("legal drafts v1", () => {
  const schema = migrations.find((migration) => migration.id === "0006")?.sql ?? "";
  it("only replaces untouched DRAFT placeholders and never approves", () => {
    expect(schema.match(/status = 'DRAFT' AND char_length\(body_md\) < 200/g)).toHaveLength(4);
    expect(schema).not.toMatch(/status\s*=\s*'APPROVED'/);
    expect(schema).not.toContain("$legal$$legal$");
  });
  it("includes the federal ESIGN consumer disclosures", () => {
    for (const phrase of ["Paper copies", "Withdrawing consent", "Hardware and software requirements", "contact information current"]) expect(schema).toContain(phrase);
  });
  it("keeps owner-only fields marked so approval stays blocked until completed", () => {
    expect(legalApprovalBlockers(schema).length).toBeGreaterThanOrEqual(3);
  });
});
