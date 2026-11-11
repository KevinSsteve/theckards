import { describe, expect, it } from "vitest";
import type { Outcome } from "./confirmations.js";
import {
  FORBIDDEN_PROFILE_PHRASES, PROFILE_DISCLAIMER, PROFILE_NUMBERS, forbiddenProfileWording, isProfileHandle,
  profileCounts, type ProfileRecord,
} from "./profile.js";

const record = (outcome: Outcome, over: Partial<ProfileRecord> = {}): ProfileRecord =>
  ({ counterpartyKey: "cp-1", signedByBoth: true, outcome, flagged: false, ...over });

describe("the five numbers", () => {
  it("counts only agreements both parties signed", () => {
    const counts = profileCounts([
      record("MUTUAL"),
      record("PENDING", { signedByBoth: false }),
    ]);
    expect(counts.agreementsSignedByBoth).toBe(1);
  });

  it("separates the three outcomes and leaves pending out of all of them", () => {
    const counts = profileCounts([
      record("MUTUAL", { counterpartyKey: "a" }),
      record("ONE_SIDED", { counterpartyKey: "b" }),
      record("NONE", { counterpartyKey: "c" }),
      record("PENDING", { counterpartyKey: "d" }),
    ]);
    expect(counts).toMatchObject({
      agreementsSignedByBoth: 4, confirmedByBoth: 1, oneSidedConfirmation: 1, noConfirmationRecorded: 1,
    });
    // Deliberately does not reconcile: silence gets no category of its own.
    expect(counts.confirmedByBoth + counts.oneSidedConfirmation + counts.noConfirmationRecorded)
      .toBeLessThan(counts.agreementsSignedByBoth);
  });

  it("counts distinct counterparties, not agreements", () => {
    const counts = profileCounts([
      record("MUTUAL", { counterpartyKey: "same" }),
      record("MUTUAL", { counterpartyKey: "same" }),
      record("MUTUAL", { counterpartyKey: "other" }),
    ]);
    expect(counts.agreementsSignedByBoth).toBe(3);
    expect(counts.differentCounterparties).toBe(2);
  });

  // The whole point of the fraud rules: a flagged agreement must not be able to move any number.
  it("counts a flagged agreement nowhere, not even as a counterparty", () => {
    const honest = profileCounts([record("MUTUAL", { counterpartyKey: "real" })]);
    const padded = profileCounts([
      record("MUTUAL", { counterpartyKey: "real" }),
      record("MUTUAL", { counterpartyKey: "fake", flagged: true }),
      record("NONE", { counterpartyKey: "fake2", flagged: true }),
    ]);
    expect(padded).toEqual(honest);
  });

  it("reports zeroes for an account with no records", () => {
    expect(profileCounts([])).toEqual({
      agreementsSignedByBoth: 0, confirmedByBoth: 0, oneSidedConfirmation: 0, noConfirmationRecorded: 0,
      differentCounterparties: 0,
    });
  });

  it("publishes exactly five numbers, each with a definition", () => {
    expect(PROFILE_NUMBERS).toHaveLength(5);
    for (const number of PROFILE_NUMBERS) {
      expect(number.definition.length).toBeGreaterThan(40);
      expect(Object.keys(profileCounts([]))).toContain(number.key);
    }
  });
});

describe("handles", () => {
  it("accepts lowercase letters, digits and underscores, 3 to 30 characters", () => {
    for (const handle of ["abc", "alex_c", "a_1", "a".repeat(30)]) expect(isProfileHandle(handle)).toBe(true);
  });

  it("rejects anything that could impersonate or be mistaken for something else", () => {
    for (const handle of ["ab", "a".repeat(31), "Alex", "alex-c", "alex.c", "alex c", "aléx", "", "admin@x"]) {
      expect(isProfileHandle(handle), handle).toBe(false);
    }
  });
});

describe("profile wording (G11)", () => {
  it("flags the drift from counting records to rating people", () => {
    expect(forbiddenProfileWording("Trusted seller with a 5 star rating")).toEqual(expect.arrayContaining(["rating", "star", "trusted"]));
    expect(forbiddenProfileWording("Five stars")).toContain("star");
    expect(forbiddenProfileWording("Reputation score: 98")).toEqual(expect.arrayContaining(["reputation", "score"]));
    expect(forbiddenProfileWording("12 successful transactions")).toContain("successful transaction");
  });

  it("allows the mandated disclaimer, which has to name what it denies", () => {
    expect(forbiddenProfileWording(PROFILE_DISCLAIMER)).toEqual([]);
    expect(PROFILE_DISCLAIMER).toContain("not a guarantee, a rating or a verification of identity");
  });

  it("matches whole words, so ordinary language is not caught", () => {
    expect(forbiddenProfileWording("The agreement started on 1 November and the parties credited each other")).toEqual([]);
  });

  it("passes every number label and definition we publish", () => {
    const surface = PROFILE_NUMBERS.map((number) => `${number.label} ${number.definition}`).join(" ");
    expect(forbiddenProfileWording(surface)).toEqual([]);
  });

  it("keeps the forbidden list non-empty, so a broken lint is visible", () => {
    expect(FORBIDDEN_PROFILE_PHRASES.length).toBeGreaterThan(15);
  });
});
