import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { AGREEMENT_STATES, TRANSITIONS, canTransition, transition, isTerminal, InvalidTransitionError, agreementStateCheckSql } from "./state-machine.js";

const state = fc.constantFrom(...AGREEMENT_STATES);

describe("state machine", () => {
  it("allows every documented transition and rejects all others", () => {
    fc.assert(fc.property(state, state, (a, b) => {
      const allowed = TRANSITIONS[a].includes(b);
      if (allowed) expect(transition(a, b)).toBe(b);
      else expect(() => transition(a, b)).toThrow(InvalidTransitionError);
    }));
  });
  it("terminal states have no exits", () => {
    for (const s of ["COMPLETED", "RESOLVED", "EXPIRED", "CANCELLED"] as const) {
      expect(isTerminal(s)).toBe(true);
      for (const t of AGREEMENT_STATES) expect(canTransition(s, t)).toBe(false);
    }
  });
  it("random walks never reach an undefined state", () => {
    fc.assert(fc.property(fc.array(fc.nat(), { maxLength: 30 }), (picks) => {
      let cur: (typeof AGREEMENT_STATES)[number] = "DRAFT";
      for (const p of picks) {
        const next: readonly (typeof AGREEMENT_STATES)[number][] = TRANSITIONS[cur];
        if (next.length === 0) break;
        cur = next[p % next.length]!;
        expect(AGREEMENT_STATES).toContain(cur);
      }
    }));
  });
  it("generates a CHECK constraint with all states", () => {
    const sql = agreementStateCheckSql();
    for (const s of AGREEMENT_STATES) expect(sql).toContain(`'${s}'`);
  });
});
