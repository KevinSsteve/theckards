import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { expectedSlots, outcome, type Confirmation } from "./confirmations.js";

const now = new Date("2026-11-10T00:00:00Z");
const due = new Date("2026-11-01T00:00:00Z");

describe("confirmation outcome", () => {
  const slots = expectedSlots("purchase_sale", true);
  it("a single confirmation is never MUTUAL", () => {
    for (const s of slots) expect(outcome(slots, [s], due, now)).toBe("ONE_SIDED");
  });
  it("all slots => MUTUAL, regardless of order", () => {
    fc.assert(fc.property(fc.shuffledSubarray(slots, { minLength: slots.length, maxLength: slots.length }), (perm) => {
      expect(outcome(slots, perm as Confirmation[], due, now)).toBe("MUTUAL");
    }));
  });
  it("order never changes the result", () => {
    fc.assert(fc.property(fc.subarray(slots), (subset) => {
      const rev = [...subset].reverse();
      expect(outcome(slots, subset, due, now)).toBe(outcome(slots, rev, due, now));
    }));
  });
  it("silence is PENDING before due+14d and NONE after, never a breach", () => {
    expect(outcome(slots, [], due, new Date("2026-11-10T00:00:00Z"))).toBe("PENDING");
    expect(outcome(slots, [], due, new Date("2026-11-16T00:00:00Z"))).toBe("NONE");
    expect(outcome(slots, [], null, new Date("2030-01-01"))).toBe("PENDING");
  });
  it("payment pairs only expected when payment is involved", () => {
    expect(expectedSlots("services", false)).toHaveLength(2);
    expect(expectedSlots("services", true)).toHaveLength(4);
    expect(expectedSlots("general", false)).toHaveLength(2);
  });
});

describe("party roles and wording", () => {
  it("one party alone can never reach MUTUAL, for any template, role or payment", async () => {
    const { confirmationRole, kindsForRole } = await import("./confirmations.js");
    fc.assert(fc.property(
      fc.constantFrom<"purchase_sale" | "services" | "general">("purchase_sale", "services", "general"),
      fc.constantFrom(undefined, "seller", "buyer", "provider", "client"),
      fc.boolean(), fc.constantFrom<"CREATOR" | "COUNTERPARTY">("CREATOR", "COUNTERPARTY"),
      (template, creatorRole, pay, party) => {
        const slots = expectedSlots(template, pay);
        const role = confirmationRole(template, party, creatorRole ? { creatorRole } : {});
        const mine = kindsForRole(slots, role).map((kind) => ({ kind, role }));
        expect(outcome(slots, mine, due, now)).not.toBe("MUTUAL");
      },
    ));
  });
  it("the two parties always get opposite roles", async () => {
    const { confirmationRole } = await import("./confirmations.js");
    for (const [template, creatorRole] of [["purchase_sale", "seller"], ["purchase_sale", "buyer"], ["services", "provider"], ["services", "client"], ["general", undefined]] as const) {
      const fields = creatorRole ? { creatorRole } : {};
      expect(confirmationRole(template, "CREATOR", fields)).not.toBe(confirmationRole(template, "COUNTERPARTY", fields));
    }
    expect(confirmationRole("purchase_sale", "CREATOR", { creatorRole: "buyer" })).toBe("BUYER");
  });
  it("payment pairs only when an amount above zero was agreed", async () => {
    const { involvesPayment } = await import("./confirmations.js");
    expect(involvesPayment("purchase_sale", { price: "350.00" })).toBe(true);
    expect(involvesPayment("purchase_sale", { price: "0.00" })).toBe(false);
    expect(involvesPayment("general", {})).toBe(false);
  });
  it("labels never imply verification, guarantee or a decision (G2, G3, G5)", async () => {
    const { CONFIRMATION_LABELS, OUTCOME_LABELS } = await import("./confirmations.js");
    const text = [...Object.values(CONFIRMATION_LABELS), ...Object.values(OUTCOME_LABELS)].join(" ");
    expect(text).not.toMatch(/verified|guarantee|protected|breach|default|winner|fault|valid/i);
    expect(CONFIRMATION_LABELS.PAYMENT_SENT).toContain("declared");
  });
});
