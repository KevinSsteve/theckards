import { describe, expect, it } from "vitest";
import { AGREEMENT_STATES, legalApprovalBlockers } from "@theckards/domain";
import { PRIVACY_V1, TERMS_V1 } from "./legal-v1.js";
import { ESIGN_V2, PRIVACY_V2, PRIVACY_V2_REPLACEMENTS, TERMS_V2, TERMS_V2_REPLACEMENTS } from "./legal-v2.js";
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

describe("corrective legal v2 migration", () => {
  const schema = migrations.find((migration) => migration.id === "0008")?.sql ?? "";
  it("replaces only v2 drafts that are still identical to approved v1", () => {
    expect(schema).toContain("code_expires_at timestamptz");
    expect(schema).toContain("download_claim_hash char(64)");
    expect(schema).toContain("v2.status = 'DRAFT'");
    expect(schema.match(/v2\.body_md = \(SELECT v1\.body_md/g)).toHaveLength(2);
    expect(schema.match(/v1\.status = 'APPROVED'/g)).toHaveLength(2);
  });
  it("provides complete unblocked en-US terms and privacy drafts for in-person signing", () => {
    expect(legalApprovalBlockers(TERMS_V2)).toEqual([]);
    expect(legalApprovalBlockers(PRIVACY_V2)).toEqual([]);
    for (const heading of ["## 1.", "## 5.", "## 10."]) expect(TERMS_V2).toContain(heading);
    for (const phrase of ["in-person QR", "15 minutes", "10 minutes", "SQUARE CIRCLE X SERVICES LDA."]) {
      expect(`${TERMS_V2}\n${PRIVACY_V2}`).toContain(phrase);
    }
    expect(TERMS_V2).not.toMatch(/one-time code sent to your email/i);
    expect(PRIVACY_V2).not.toMatch(/send verification codes, invitations and receipts/i);
  });
});

describe("record migration (S5 part 1)", () => {
  const schema = migrations.find((migration) => migration.id === "0009")?.sql ?? "";
  it("keeps confirmations, messages and notes insert-only and bounded", () => {
    for (const table of ["confirmations", "messages", "record_notes"]) expect(schema).toContain(`${table}_append_only`);
    expect(schema).toContain("UNIQUE (agreement_id, party_id, kind)");
    expect(schema).toContain("char_length(body) BETWEEN 1 AND 4000");
    expect(schema).toContain("char_length(body) BETWEEN 1 AND 500");
    expect(schema).not.toMatch(/outcome|MUTUAL/);
  });
});

describe("privacy v3 draft (S5 record entries)", () => {
  const schema = migrations.find((migration) => migration.id === "0010")?.sql ?? "";
  it("derives from approved v2 with replacements that all match, as a draft only", async () => {
    const { PRIVACY_V3_REPLACEMENTS } = await import("./legal-v3.js");
    for (const [from, to] of PRIVACY_V3_REPLACEMENTS) { expect(PRIVACY_V2).toContain(from); expect(to).not.toBe(from); }
    expect(schema).toContain("version = 2 AND status = 'APPROVED'");
    expect(schema).toContain("3, 'DRAFT'");
    const v3 = PRIVACY_V3_REPLACEMENTS.reduce((body, [from, to]) => body.replace(from, to), PRIVACY_V2);
    expect(v3).toContain("confirmations, messages and notes");
    expect(v3).toContain("Theckards does not verify them");
    expect(legalApprovalBlockers(v3)).toEqual([]);
  });
});

describe("cases and addenda migration (S5 part 2)", () => {
  const schema = migrations.find((migration) => migration.id === "0011")?.sql ?? "";
  it("keeps proposals, acceptances and addendum signatures insert-only and addendum text immutable", () => {
    for (const trigger of ["proposals_append_only", "proposal_acceptances_append_only", "addendum_signatures_append_only", "addenda_content_immutable"]) expect(schema).toContain(trigger);
    expect(schema).toContain("cases_one_open_per_agreement ON cases(agreement_id) WHERE status = 'OPEN'");
    expect(schema).not.toMatch(/winner|decision|verdict|at_fault/i);
  });
  it("derives PRIVACY v4 and ESIGN v3 drafts from approved text whose anchors all exist", async () => {
    const { PRIVACY_V3_REPLACEMENTS } = await import("./legal-v3.js");
    const { PRIVACY_V4_REPLACEMENTS, ESIGN_V3_REPLACEMENTS } = await import("./legal-v4.js");
    const v3 = PRIVACY_V3_REPLACEMENTS.reduce((body, [from, to]) => body.replace(from, to), PRIVACY_V2);
    for (const [from, to] of PRIVACY_V4_REPLACEMENTS) { expect(v3).toContain(from); expect(to).not.toBe(from); }
    for (const [from, to] of ESIGN_V3_REPLACEMENTS) { expect(ESIGN_V2).toContain(from); expect(to).not.toBe(from); }
    expect(schema).toContain("4, 'DRAFT'");
    expect(schema).toContain("3, 'DRAFT'");
    expect(schema).not.toMatch(/status = 'APPROVED'\s*,/);
  });
});

describe("evidence migration (S5 part 3)", () => {
  const schema = migrations.find((migration) => migration.id === "0012")?.sql ?? "";
  it("only lets a file become visible through a clean scan, and keeps the declaration immutable", () => {
    expect(schema).toContain("evidence_append_only");
    expect(schema).toContain("CHECK ((scan_status = 'CLEAN') = (stored_key IS NOT NULL AND sha256 IS NOT NULL))");
    expect(schema).toContain("declared_bytes integer NOT NULL CHECK (declared_bytes BETWEEN 1 AND 26214400)");
    expect(schema).toContain("content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')");
    expect(schema).toContain("OLD.scan_status NOT IN ('AWAITING_UPLOAD', 'PENDING')");
  });
  it("discloses evidence in the privacy draft using anchors the draft really contains", async () => {
    const { PRIVACY_V3_REPLACEMENTS } = await import("./legal-v3.js");
    const { PRIVACY_V4_REPLACEMENTS, PRIVACY_V4_EVIDENCE_REPLACEMENTS } = await import("./legal-v4.js");
    const v3 = PRIVACY_V3_REPLACEMENTS.reduce((body, [from, to]) => body.replace(from, to), PRIVACY_V2);
    const v4 = PRIVACY_V4_REPLACEMENTS.reduce((body, [from, to]) => body.replace(from, to), v3);
    for (const [from, to] of PRIVACY_V4_EVIDENCE_REPLACEMENTS) { expect(v4).toContain(from); expect(to).not.toBe(from); }
    const withEvidence = PRIVACY_V4_EVIDENCE_REPLACEMENTS.reduce((body, [from, to]) => body.replace(from, to), v4);
    expect(withEvidence).toContain("Evidence files:");
    expect(withEvidence).toContain("metadata such as where and when it was taken");
    expect(legalApprovalBlockers(withEvidence)).toEqual([]);
    // Idempotent: the update only runs while the draft has no evidence paragraph yet.
    expect(schema).toContain("NOT LIKE '%Evidence files:%'");
    expect(schema).toContain("version = 4 AND status = 'DRAFT'");
  });
});
