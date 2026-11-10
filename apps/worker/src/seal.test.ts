import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { receiptSigningPayload, uuidFromHex } from "@theckards/domain";
import { buildMime } from "./mime.js";
import { renderAgreementPdf } from "./pdf.js";
import { sealIdFor } from "./seal.js";

const input = {
  agreementId: "00000000-0000-0000-0000-000000000001",
  version: 2,
  title: "Sale of iPhone 14",
  templateId: "purchase_sale" as const,
  fields: { itemDescription: "iPhone 14", price: "400.00", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person", serialNumber: "" },
  createdAt: new Date("2026-11-10T00:00:00.000Z"),
};
const final = {
  sealId: sealIdFor(input.agreementId, "00000000-0000-0000-0000-0000000000aa", "FINAL"),
  sealedAt: new Date("2026-11-11T10:00:00.000Z"),
  contentSha256: "a".repeat(64),
  signedDocumentSha256: "b".repeat(64),
  signers: [
    { role: "Creator" as const, typedName: "Alex Seller", signedAt: new Date("2026-11-11T09:00:00.000Z"), method: "ACCOUNT_SESSION" as const },
    { role: "Counterparty" as const, typedName: "Jamie Buyer", signedAt: new Date("2026-11-11T10:00:00.000Z"), method: "IN_PERSON_QR" as const },
  ],
  verifyUrl: "https://theckards.linkealls.com/verify?seal=x",
  watermark: true,
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("final sealed PDF", () => {
  it("is byte-identical for the same signatures, so retried seal jobs reuse the hash", async () => {
    const [a, b] = await Promise.all([renderAgreementPdf(input, final), renderAgreementPdf(input, final)]);
    expect(sha(a)).toBe(sha(b));
  });

  it("differs from the unsigned preview", async () => {
    const [preview, sealed] = await Promise.all([renderAgreementPdf(input), renderAgreementPdf(input, final)]);
    expect(sha(preview)).not.toBe(sha(sealed));
  });

  it("changes hash if one signer name changes by one character", async () => {
    const altered = { ...final, signers: [{ ...final.signers[0]!, typedName: "Alex Sellex" }, final.signers[1]!] };
    const [a, b] = await Promise.all([renderAgreementPdf(input, final), renderAgreementPdf(input, altered)]);
    expect(sha(a)).not.toBe(sha(b));
  });
});

describe("receipt signature", () => {
  it("verifies offline with ECDSA P-256 over the canonical payload and rejects tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const core = { id: final.sealId, kind: "FINAL" as const, sha256: "c".repeat(64), content_sha256: "a".repeat(64), sealed_at: final.sealedAt.toISOString() };
    const signature = sign("sha256", Buffer.from(receiptSigningPayload(core)), privateKey);
    expect(verify("sha256", Buffer.from(receiptSigningPayload(core)), publicKey, signature)).toBe(true);
    const tampered = { ...core, sha256: "d".repeat(64) };
    expect(verify("sha256", Buffer.from(receiptSigningPayload(tampered)), publicKey, signature)).toBe(false);
  });

  it("derives stable, UUID-shaped seal ids", () => {
    expect(sealIdFor("a", "b", "FINAL")).toBe(sealIdFor("a", "b", "FINAL"));
    expect(sealIdFor("a", "b", "FINAL")).not.toBe(sealIdFor("a", "b", "ADDENDUM"));
    expect(uuidFromHex("f".repeat(64))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("MIME builder", () => {
  it("rejects header injection", () => {
    expect(() => buildMime({ from: "a@b.c", to: "x@y.z\r\nBcc: evil@example.com", subject: "s", text: "t", attachments: [] })).toThrow();
  });
  it("encodes attachments", () => {
    const raw = Buffer.from(buildMime({ from: "a@b.c", to: "x@y.z", subject: "Sealed record", text: "hello", attachments: [{ filename: "r.json", contentType: "application/json", content: Buffer.from("{}") }] })).toString();
    expect(raw).toContain('filename="r.json"');
    expect(raw).toContain("multipart/mixed");
  });
});

describe("resolution addendum PDF", () => {
  const document = { subtitle: "Resolution addendum · 2026-11-11", subject: "Addendum", sections: [{ heading: "Accepted proposal", paragraphs: ["Seller refunds USD 100."] }] };
  it("renders deterministically from the stored sections, independent of template fields", async () => {
    const [a, b] = await Promise.all([
      renderAgreementPdf({ ...input, fields: {}, document }, { ...final, signers: final.signers.map((s) => ({ ...s, method: "ACCOUNT_SESSION" as const })) }),
      renderAgreementPdf({ ...input, fields: {}, document }, { ...final, signers: final.signers.map((s) => ({ ...s, method: "ACCOUNT_SESSION" as const })) }),
    ]);
    expect(sha(a)).toBe(sha(b));
    const other = await renderAgreementPdf({ ...input, fields: {}, document: { ...document, sections: [{ heading: "Accepted proposal", paragraphs: ["Seller refunds USD 101."] }] } }, final);
    expect(sha(other)).not.toBe(sha(a));
  });
});
