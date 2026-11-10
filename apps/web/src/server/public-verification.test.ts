import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./db", () => ({ getPool: () => ({ query }) }));
const { INVALID_VERIFICATION, verifyPublicHash } = await import("./public-verification");

describe("public seal verification", () => {
  beforeEach(() => query.mockReset());

  it("returns only the public fields for a known hash", async () => {
    query.mockResolvedValue({ rows: [{ id: "seal-id", kind: "FINAL", sealed_at: new Date("2026-11-10T10:00:00Z"), anchored: false }] });
    const result = await verifyPublicHash("A".repeat(64));
    expect(result).toEqual({ valid: true, kind: "FINAL", sealed_at: "2026-11-10T10:00:00.000Z", seal_id: "seal-id", anchored: false });
    expect(Object.keys(result).sort()).toEqual(["anchored", "kind", "seal_id", "sealed_at", "valid"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM sealed_documents WHERE sha256 = $1"), ["a".repeat(64)]);
  });

  it("makes malformed and unknown hashes indistinguishable", async () => {
    query.mockResolvedValue({ rows: [] });
    const malformed = await verifyPublicHash("not-a-hash");
    const unknown = await verifyPublicHash("f".repeat(64));
    expect(malformed).toEqual(INVALID_VERIFICATION);
    expect(unknown).toEqual(INVALID_VERIFICATION);
    expect(malformed).toEqual(unknown);
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), ["0".repeat(64)]);
  });

  it("rejects a PDF changed by one byte", async () => {
    const original = Buffer.from("%PDF-1.7 original sealed bytes");
    const changed = Buffer.from(original);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    const originalHash = createHash("sha256").update(original).digest("hex");
    const changedHash = createHash("sha256").update(changed).digest("hex");
    query
      .mockResolvedValueOnce({ rows: [{ id: "seal-id", kind: "FINAL", sealed_at: new Date("2026-11-10T10:00:00Z"), anchored: false }] })
      .mockResolvedValueOnce({ rows: [] });
    expect((await verifyPublicHash(originalHash)).valid).toBe(true);
    expect((await verifyPublicHash(changedHash)).valid).toBe(false);
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [originalHash]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [changedHash]);
    expect(changedHash).not.toBe(originalHash);
  });

  it("ignores a database match for the malformed-input dummy digest", async () => {
    query.mockResolvedValue({ rows: [{ id: "impossible", kind: "FINAL", sealed_at: new Date(), anchored: false }] });
    expect(await verifyPublicHash("bad")).toEqual(INVALID_VERIFICATION);
  });
});
