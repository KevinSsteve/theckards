import { describe, expect, it } from "vitest";
import { SEAL_MARK_SIZE, sealMark } from "./seal-mark.js";

const A = "b932630c-7185-5168-b469-745fd725c0c9";
const B = "b4183d27-79c9-558c-ba5e-437d1453797f";

describe("seal impression", () => {
  it("presses the same mark for the same seal, and a different one for another seal", () => {
    expect(sealMark(A).impression).toBe(sealMark(A).impression);
    expect(sealMark(A).impression).not.toBe(sealMark(B).impression);
  });
  it("uses only straight lines, so every renderer draws it identically", () => {
    expect(sealMark(A).impression).toMatch(/^M[\d.,]+(L[\d.,]+)+Z$/);
    expect(sealMark(A).impression.match(/L/g)).toHaveLength(23);
  });
  it("keeps the impression inside the inner ring", () => {
    const mark = sealMark(A);
    const half = SEAL_MARK_SIZE / 2;
    for (const pair of mark.impression.replace(/[MLZ]/g, " ").trim().split(/\s+/)) {
      const [x, y] = pair.split(",").map(Number) as [number, number];
      expect(Math.hypot(x - half, y - half)).toBeLessThan(mark.innerRing);
    }
  });
  it("never fails on an unexpected identifier", () => {
    for (const id of ["", "zzz", "0"]) expect(sealMark(id).impression).toMatch(/^M.*Z$/);
  });
  it("shows a short code a person can compare with the receipt", () => {
    expect(sealMark(A).code).toBe("B932 630C");
  });
});
