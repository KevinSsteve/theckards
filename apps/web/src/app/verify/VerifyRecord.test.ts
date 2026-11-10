import { describe, expect, it } from "vitest";
import { hashFileLocally } from "./VerifyRecord";

describe("local PDF hashing", () => {
  it("changes the digest when one file byte changes", async () => {
    const original = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1])], "sealed.pdf", { type: "application/pdf" });
    const changed = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 2])], "sealed.pdf", { type: "application/pdf" });
    const [left, right] = await Promise.all([hashFileLocally(original), hashFileLocally(changed)]);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(right).toMatch(/^[a-f0-9]{64}$/);
    expect(left).not.toBe(right);
  });
});
