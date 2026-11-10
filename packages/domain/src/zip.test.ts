import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crc32, unzipStore, zipStore } from "./zip.js";

const text = (value: string) => new TextEncoder().encode(value);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("deterministic zip", () => {
  it("round-trips entries unchanged", () => {
    const entries = [
      { path: "README.txt", bytes: text("how to verify\n") },
      { path: "documents/agreement.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255, 128]) },
      { path: "manifest.json", bytes: text('{"format":1}') },
    ];
    const read = unzipStore(zipStore(entries));
    expect(read.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    read.forEach((entry, index) => expect(entry.bytes).toEqual(entries[index]!.bytes));
  });

  // A dossier is rebuilt on request, and a reader comparing two copies of the same record must see the same
  // bytes. Nothing in the container may depend on when it was built.
  it("produces identical bytes across builds", () => {
    const entries = [{ path: "a.txt", bytes: text("a") }, { path: "b.txt", bytes: text("b") }];
    expect(hash(zipStore(entries))).toBe(hash(zipStore(entries)));
  });

  it("changes bytes when any content changes", () => {
    const one = zipStore([{ path: "a.txt", bytes: text("a") }]);
    const two = zipStore([{ path: "a.txt", bytes: text("b") }]);
    expect(hash(one)).not.toBe(hash(two));
  });

  it("keeps an empty entry readable", () => {
    const read = unzipStore(zipStore([{ path: "empty", bytes: new Uint8Array() }]));
    expect(read).toEqual([{ path: "empty", bytes: new Uint8Array() }]);
  });

  it("handles unicode paths and content", () => {
    const read = unzipStore(zipStore([{ path: "provas/acordo-assinatura.txt", bytes: text("ação, señor, 日本") }]));
    expect(new TextDecoder().decode(read[0]!.bytes)).toBe("ação, señor, 日本");
  });

  it("computes the CRC-32 of the standard check value", () => {
    expect(crc32(text("123456789")).toString(16)).toBe("cbf43926");
  });

  it("refuses paths that would escape extraction", () => {
    expect(() => zipStore([{ path: "../escape", bytes: text("x") }])).toThrow(/Invalid archive path/);
    expect(() => zipStore([{ path: "/absolute", bytes: text("x") }])).toThrow(/Invalid archive path/);
    expect(() => zipStore([{ path: "a\\b", bytes: text("x") }])).toThrow(/Invalid archive path/);
  });

  it("refuses duplicate paths", () => {
    expect(() => zipStore([{ path: "a", bytes: text("1") }, { path: "a", bytes: text("2") }])).toThrow(/Duplicate/);
  });

  it("detects a tampered archive", () => {
    const archive = zipStore([{ path: "a.txt", bytes: text("original") }]);
    const tampered = Uint8Array.from(archive);
    const offset = tampered.indexOf(text("original")[0]!, 30);
    tampered[offset] = tampered[offset]! ^ 0xff;
    expect(() => unzipStore(tampered)).toThrow(/CRC mismatch/);
  });

  it("rejects bytes that are not an archive", () => {
    expect(() => unzipStore(text("not a zip file at all"))).toThrow(/Not a ZIP archive/);
  });
});
