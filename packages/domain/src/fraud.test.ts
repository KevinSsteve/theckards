import { describe, expect, it } from "vitest";
import { DEFAULT_FRAUD_THRESHOLDS, fraudFlags, isNewAccount, isSamePerson, normalizeEmail, type AgreementFact } from "./fraud.js";

const at = (iso: string) => new Date(iso);
const fact = (id: string, over: Partial<AgreementFact> = {}): AgreementFact => ({
  id, counterpartyKey: "other", createdAt: at("2026-11-01T10:00:00Z"), executedAt: null, confirmedAt: [], samePerson: false, ...over,
});

describe("normalizing an address to decide if both sides are one person", () => {
  it("ignores case, surrounding space and address tags", () => {
    expect(normalizeEmail("  Alex+Theckards@Example.com ")).toBe("alex@example.com");
  });

  it("ignores dots only where the provider does", () => {
    expect(normalizeEmail("a.l.e.x@gmail.com")).toBe("alex@gmail.com");
    expect(normalizeEmail("a.l.e.x@googlemail.com")).toBe("alex@googlemail.com");
    // Elsewhere two addresses differing by a dot can be two different people.
    expect(normalizeEmail("a.lex@example.com")).toBe("a.lex@example.com");
  });

  it("leaves something that is not an address alone rather than mangling it", () => {
    expect(normalizeEmail("not-an-address")).toBe("not-an-address");
    expect(normalizeEmail("@example.com")).toBe("@example.com");
    expect(normalizeEmail("alex@")).toBe("alex@");
  });

  it("catches the same mailbox on both sides of an agreement", () => {
    expect(isSamePerson("Alex@Gmail.com", "a.l.e.x+sale@gmail.com")).toBe(true);
    expect(isSamePerson("alex@example.com", "alex@other.com")).toBe(false);
  });
});

describe("agreements excluded from the numbers", () => {
  it("excludes nothing when there is nothing wrong", () => {
    expect(fraudFlags([fact("a"), fact("b", { counterpartyKey: "second" })]).size).toBe(0);
  });

  it("F1: excludes an agreement whose two sides are the same person", () => {
    expect(fraudFlags([fact("a", { samePerson: true })]).get("a")).toEqual(["F1_SAME_PERSON"]);
  });

  it("F2: keeps the first few agreements with one counterparty and excludes the rest", () => {
    const facts = Array.from({ length: 5 }, (_, index) =>
      fact(`a${index}`, { createdAt: at(`2026-11-0${index + 1}T10:00:00Z`) }));
    const flags = fraudFlags(facts);
    expect([...flags.keys()].sort()).toEqual(["a3", "a4"]);
    expect(flags.get("a3")).toEqual(["F2_SAME_PAIR"]);
  });

  it("F2: counts each counterparty separately", () => {
    const facts = [
      ...Array.from({ length: 3 }, (_, i) => fact(`x${i}`, { counterpartyKey: "one", createdAt: at(`2026-11-0${i + 1}T10:00:00Z`) })),
      ...Array.from({ length: 3 }, (_, i) => fact(`y${i}`, { counterpartyKey: "two", createdAt: at(`2026-11-0${i + 1}T11:00:00Z`) })),
    ];
    expect(fraudFlags(facts).size).toBe(0);
  });

  it("F3: excludes the agreements beyond the daily limit in any 24 hours", () => {
    const facts = Array.from({ length: 12 }, (_, index) =>
      fact(`b${index}`, { counterpartyKey: `cp${index}`, createdAt: new Date(at("2026-11-01T00:00:00Z").getTime() + index * 60_000) }));
    const flags = fraudFlags(facts);
    expect([...flags.keys()]).toEqual(["b10", "b11"]);
    expect(flags.get("b10")).toEqual(["F3_BURST"]);
  });

  it("F3: leaves the same volume spread over days alone", () => {
    const facts = Array.from({ length: 12 }, (_, index) =>
      fact(`c${index}`, { counterpartyKey: `cp${index}`, createdAt: new Date(at("2026-11-01T00:00:00Z").getTime() + index * 86_400_000) }));
    expect(fraudFlags(facts).size).toBe(0);
  });

  it("F5: excludes an agreement confirmed within seconds of signing", () => {
    const executedAt = at("2026-11-01T12:00:00Z");
    const immediate = Array.from({ length: 5 }, (_, index) => new Date(executedAt.getTime() + index * 5_000));
    expect(fraudFlags([fact("d", { executedAt, confirmedAt: immediate })]).get("d")).toEqual(["F5_IMMEDIATE_CONFIRMATIONS"]);
  });

  it("F5: leaves confirmations declared later alone", () => {
    const executedAt = at("2026-11-01T12:00:00Z");
    const later = Array.from({ length: 5 }, (_, index) => new Date(executedAt.getTime() + 61_000 + index * 1_000));
    expect(fraudFlags([fact("e", { executedAt, confirmedAt: later })]).size).toBe(0);
  });

  it("records every rule that applies to the same agreement", () => {
    const executedAt = at("2026-11-01T12:00:00Z");
    const flags = fraudFlags([fact("f", {
      samePerson: true, executedAt,
      confirmedAt: Array.from({ length: 5 }, () => executedAt),
    })]);
    expect(flags.get("f")).toEqual(["F1_SAME_PERSON", "F5_IMMEDIATE_CONFIRMATIONS"]);
  });

  it("does not depend on the order the records arrive in", () => {
    const facts = Array.from({ length: 5 }, (_, index) =>
      fact(`g${index}`, { createdAt: at(`2026-11-0${index + 1}T10:00:00Z`) }));
    const forward = [...fraudFlags(facts).keys()].sort();
    const backward = [...fraudFlags([...facts].reverse()).keys()].sort();
    expect(forward).toEqual(backward);
  });

  it("respects thresholds the owner changed", () => {
    const facts = Array.from({ length: 3 }, (_, index) =>
      fact(`h${index}`, { createdAt: at(`2026-11-0${index + 1}T10:00:00Z`) }));
    expect(fraudFlags(facts, { ...DEFAULT_FRAUD_THRESHOLDS, samePairAgreements: 1 }).size).toBe(2);
  });
});

describe("new accounts", () => {
  it("shows a note instead of numbers for the first week", () => {
    expect(isNewAccount(at("2026-11-05T00:00:00Z"), at("2026-11-10T00:00:00Z"))).toBe(true);
    expect(isNewAccount(at("2026-11-01T00:00:00Z"), at("2026-11-10T00:00:00Z"))).toBe(false);
  });
});
