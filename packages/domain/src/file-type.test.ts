import { describe, expect, it } from "vitest";
import { detectEvidenceType, isEvidenceType } from "./file-type.js";

const bytes = (...values: number[]) => new Uint8Array(values);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);

describe("evidence type detection", () => {
  it("recognises the four accepted types from their own bytes", () => {
    expect(detectEvidenceType(JPEG)).toBe("image/jpeg");
    expect(detectEvidenceType(PNG)).toBe("image/png");
    expect(detectEvidenceType(WEBP)).toBe("image/webp");
    expect(detectEvidenceType(PDF)).toBe("application/pdf");
  });

  it("rejects anything else, including files that merely claim to be accepted", () => {
    // An executable, a shell script, a zip, a RIFF container that is not WebP, and an empty file.
    expect(detectEvidenceType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    expect(detectEvidenceType(bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e))).toBeNull();
    expect(detectEvidenceType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(detectEvidenceType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20))).toBeNull();
    expect(detectEvidenceType(new Uint8Array())).toBeNull();
  });

  it("never reads past the end of a short file", () => {
    for (const length of [1, 2, 3, 4, 7]) expect(() => detectEvidenceType(PNG.slice(0, length))).not.toThrow();
    expect(detectEvidenceType(PNG.slice(0, 4))).toBeNull();
  });

  it("accepts only the declared types as upload targets", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) expect(isEvidenceType(type)).toBe(true);
    for (const type of ["text/html", "image/svg+xml", "application/zip", "", "__proto__"]) expect(isEvidenceType(type)).toBe(false);
  });
});
