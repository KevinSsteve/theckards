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
