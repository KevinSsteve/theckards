/**
 * Evidence file types we accept, and detection from the file's own leading bytes.
 *
 * A browser's declared content type is a claim, not a fact. After a clean malware scan the worker checks the
 * stored bytes against the type the uploader declared, so a file cannot be served as something it is not.
 */
export const EVIDENCE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
} as const;

export type EvidenceType = keyof typeof EVIDENCE_TYPES;
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

export function isEvidenceType(value: string): value is EvidenceType {
  return Object.hasOwn(EVIDENCE_TYPES, value);
}

const starts = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

/** Returns the type the bytes actually are, or null when they are not an accepted evidence file. */
export function detectEvidenceType(bytes: Uint8Array): EvidenceType | null {
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}
