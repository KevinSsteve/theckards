/**
 * A deterministic ZIP container, stored (uncompressed) only.
 *
 * The dossier has to be reproducible and self-verifiable: the same record must produce the same archive bytes,
 * and an independent script must be able to read it back without trusting the code that wrote it. Both are
 * easier to guarantee with a small, explicit implementation than with a general-purpose library, because every
 * field that usually varies between runs (timestamps, compression levels, extra fields, ordering) is fixed here.
 *
 * The entries are already-compressed PDFs and small JSON documents, so storing them costs little space and keeps
 * the format trivial: no data descriptors, no Zip64, no encryption, nothing to negotiate. Standard tools such as
 * `unzip` and Python's `zipfile` read it.
 */

/** 1980-01-01 00:00:00, the earliest timestamp MS-DOS fields can express, used for every entry. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const UTF8_FLAG = 0x0800;
const STORED = 0;
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Forward-slash relative path inside the archive. */
  path: string;
  bytes: Uint8Array;
}

const MAX_ENTRY_BYTES = 0xffffffff;

/** Rejects paths that would escape the extraction directory or confuse a reader. */
function encodeName(path: string): Uint8Array {
  if (!path || path.length > 1_000) throw new Error("Invalid archive path");
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0")) {
    throw new Error("Invalid archive path");
  }
  return new TextEncoder().encode(path);
}

/**
 * Builds the archive. Entry order is preserved exactly as given, so the caller owns reproducibility of the
 * listing; everything else in the container is fixed.
 */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const seen = new Set<string>();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}`);
    seen.add(entry.path);
    if (entry.bytes.byteLength > MAX_ENTRY_BYTES) throw new Error("Archive entry is too large");
    const name = encodeName(entry.path);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.byteLength;

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, VERSION, true);
    header.setUint16(6, UTF8_FLAG, true);
    header.setUint16(8, STORED, true);
    header.setUint16(10, DOS_TIME, true);
    header.setUint16(12, DOS_DATE, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, size, true);
    header.setUint32(22, size, true);
    header.setUint16(26, name.byteLength, true);
    header.setUint16(28, 0, true);
    local.push(new Uint8Array(header.buffer), name, entry.bytes);

    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, VERSION, true);
    directory.setUint16(6, VERSION, true);
    directory.setUint16(8, UTF8_FLAG, true);
    directory.setUint16(10, STORED, true);
    directory.setUint16(12, DOS_TIME, true);
    directory.setUint16(14, DOS_DATE, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, size, true);
    directory.setUint32(24, size, true);
    directory.setUint16(28, name.byteLength, true);
    directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name);

    offset += 30 + name.byteLength + size;
  }

  const directorySize = central.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

/**
 * Reads a stored archive back, verifying every CRC. Written so the verification script can walk a dossier
 * without the writer's cooperation; anything unexpected is an error rather than a best-effort guess.
 */
export function unzipStore(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let index = archive.byteLength - 22; index >= 0 && index > archive.byteLength - 22 - 65_536; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("Not a ZIP archive: no end of central directory");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Corrupt central directory");
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (method !== STORED) throw new Error("Unsupported compression method");
    if (size === 0xffffffff || localOffset === 0xffffffff) throw new Error("Zip64 archives are not supported");
    const path = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    encodeName(path);

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Corrupt local header");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const bytes = archive.subarray(dataStart, dataStart + size);
    if (bytes.byteLength !== size) throw new Error(`Truncated entry: ${path}`);
    if (crc32(bytes) !== crc) throw new Error(`CRC mismatch: ${path}`);
    entries.push({ path, bytes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
