import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderAgreementPdf } from "./pdf.js";

const input = {
  agreementId: "00000000-0000-0000-0000-000000000001",
  version: 1,
  title: "Sale of iPhone 14",
  templateId: "purchase_sale" as const,
  fields: { itemDescription: "iPhone 14", price: "400.00", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person", serialNumber: "ABC123" },
  createdAt: new Date("2026-11-10T00:00:00.000Z"),
};

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("agreement PDF", () => {
  it("produces the same bytes for the same immutable version", async () => {
    const [one, two] = await Promise.all([renderAgreementPdf(input), renderAgreementPdf(input)]);
    expect(hash(one)).toBe(hash(two));
    expect(one.byteLength).toBeGreaterThan(1_000);
  });
});
