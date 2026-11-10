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
