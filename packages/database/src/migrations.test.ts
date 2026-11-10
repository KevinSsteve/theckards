import { describe, expect, it } from "vitest";
import { AGREEMENT_STATES, legalApprovalBlockers } from "@theckards/domain";
import { PRIVACY_V1, TERMS_V1 } from "./legal-v1.js";
import { ESIGN_V2, PRIVACY_V2_REPLACEMENTS, TERMS_V2_REPLACEMENTS } from "./legal-v2.js";
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

describe("in-person QR signing migration", () => {
  const schema = migrations.find((migration) => migration.id === "0007")?.sql ?? "";
  it("every v2 replacement matches text that exists in the approved v1 drafts", () => {
    for (const [from, to] of TERMS_V2_REPLACEMENTS) { expect(TERMS_V1).toContain(from); expect(from).not.toBe(to); }
    for (const [from, to] of PRIVACY_V2_REPLACEMENTS) { expect(PRIVACY_V1).toContain(from); expect(from).not.toBe(to); }
  });
  it("creates v2 legal documents only as drafts, derived from approved v1", () => {
    expect(schema).toContain("version = 1 AND status = 'APPROVED'");
    expect(schema.match(/2, 'DRAFT'/g)?.length).toBe(3);
    expect(schema).not.toMatch(/status\s*=\s*'APPROVED'\s*,/);
    expect(legalApprovalBlockers(ESIGN_V2)).toEqual([]);
    expect(ESIGN_V2).not.toMatch(/one-time code sent to your email/i);
  });
  it("stores only hashes of the QR token, device and code, and turns email delivery off", () => {
    expect(schema).toContain("token_hash char(64) NOT NULL UNIQUE");
    expect(schema).toContain("device_hash char(64)");
    expect(schema).toContain("code_hash char(64)");
    expect(schema).not.toMatch(/\b(token|code) text\b/);
    expect(schema).toContain("'IN_PERSON_QR'");
    expect(schema).toContain('{"EMAIL_DELIVERY_ENABLED": false}');
  });
});
