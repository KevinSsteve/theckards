import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.js";
import { renderAgreement, templateDefinitions, validateTemplateFields } from "./templates.js";

describe("agreement templates", () => {
  it("has exactly three templates with at most eight fields", () => {
    expect(Object.keys(templateDefinitions)).toEqual(["purchase_sale", "services", "general"]);
    for (const template of Object.values(templateDefinitions)) expect(template.fields.length).toBeLessThanOrEqual(8);
  });

  it("validates and renders purchase-and-sale facts into static template text", () => {
    const fields = { itemDescription: "iPhone 14", price: "400.00", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person", serialNumber: "ABC123" };
    expect(validateTemplateFields("purchase_sale", fields)).toEqual(fields);
    const text = JSON.stringify(renderAgreement("purchase_sale", fields));
    expect(text).toContain("iPhone 14");
    expect(text).toContain("does not receive or process it");
  });

  it("rejects dates in reverse order", () => {
    expect(() => validateTemplateFields("services", { serviceDescription: "Design a logo", amount: "100.00", paymentMethod: "cash", startDate: "2026-11-20", completionDate: "2026-11-10", deliverables: "SVG logo files" })).toThrow();
  });

  it("canonicalizes object keys", () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: true } })).toBe('{"a":{"b":true,"d":2},"z":1}');
  });
});

describe("money fields", () => {
  const base = { itemDescription: "Road bicycle", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person" };
  it("accepts whole and one-decimal amounts and stores two decimals", async () => {
    const { validateTemplateFields } = await import("./templates.js");
    for (const [input, stored] of [["350", "350.00"], ["350.5", "350.50"], [" 0400.00 ", "400.00"]] as const) {
      expect((validateTemplateFields("purchase_sale", { ...base, price: input }) as { price: string }).price).toBe(stored);
    }
  });
  it("reports the failing field without echoing the value", async () => {
    const { templateFieldErrors } = await import("./templates.js");
    const errors = templateFieldErrors("purchase_sale", { ...base, price: "35O,00" });
    expect(Object.keys(errors)).toEqual(["price"]);
    expect(errors.price).not.toContain("35O");
    expect(templateFieldErrors("purchase_sale", { ...base, price: "350" })).toEqual({});
  });
});

describe("party roles", () => {
  const sale = { itemDescription: "Road bicycle", price: "350", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person" };
  it("states explicitly which party sells and which buys", async () => {
    const { renderAgreement } = await import("./templates.js");
    const asBuyer = renderAgreement("purchase_sale", { ...sale, creatorRole: "buyer" });
    expect(asBuyer[0]).toEqual({ heading: "Parties", paragraphs: [expect.stringContaining("The creator of this agreement is the buyer. The counterparty is the seller.")] });
  });
  it("renders versions created before roles existed exactly as before", async () => {
    const { renderAgreement } = await import("./templates.js");
    expect(renderAgreement("purchase_sale", sale).map((s) => s.heading)).toEqual(["Item", "Price and payment", "Delivery", "Important notice"]);
  });
  it("requires the role for new agreements", async () => {
    const { missingRequiredFields } = await import("./templates.js");
    expect(missingRequiredFields("purchase_sale", sale)).toEqual(["creatorRole"]);
    expect(missingRequiredFields("purchase_sale", { ...sale, creatorRole: "seller" })).toEqual([]);
    expect(missingRequiredFields("general", { purpose: "x", creatorCommitment: "y", counterpartyCommitment: "z", effectiveDate: "2026-11-20" })).toEqual([]);
  });
});
