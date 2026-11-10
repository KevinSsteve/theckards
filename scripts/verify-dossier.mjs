#!/usr/bin/env node
/**
 * Verifies a Theckards dossier.
 *
 * This script is deliberately standalone: it imports nothing from this repository and uses only the Node
 * standard library, so it checks the archive the way an outside auditor would rather than agreeing with the code
 * that produced it. Copy it anywhere, or follow README.txt inside the archive and do the same by hand.
 *
 *   node verify-dossier.mjs <dossier.zip> <dossier.receipt.json> [keys.json]
 *
 * It checks four things and exits non-zero if any of them fails:
 *
 *   1. every entry in manifest.json is present in the archive and has the SHA-256 the manifest claims;
 *   2. manifest.json's own SHA-256 equals the receipt's content_sha256;
 *   3. the archive's SHA-256 equals the receipt's sha256;
 *   4. the receipt's signature verifies against the published public key.
 *
 * Without keys.json the first three checks still run and the signature is reported as unchecked.
 */
import { createHash, createVerify } from "node:crypto";
import { readFile } from "node:fs/promises";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Reads a stored (uncompressed) ZIP by walking its central directory. */
function readZip(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let index = archive.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("not a ZIP archive");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (method !== 0) throw new Error("unexpected compression: a dossier stores its files uncompressed");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const bytes = archive.subarray(start, start + size);
    if (bytes.byteLength !== size) throw new Error(`truncated entry: ${name}`);
    if (crc32(bytes) !== crc) throw new Error(`CRC mismatch: ${name}`);
    entries.set(name, bytes);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** RFC 8785 canonical JSON, enough for the receipt payload: sorted keys, no whitespace. */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function signedMessage(receipt) {
  return canonical({
    id: receipt.id,
    kind: receipt.kind,
    sha256: receipt.sha256,
    content_sha256: receipt.content_sha256,
    sealed_at: receipt.sealed_at,
  });
}

async function main() {
  const [archivePath, receiptPath, keysPath] = process.argv.slice(2);
  if (!archivePath || !receiptPath) {
    console.error("usage: verify-dossier.mjs <dossier.zip> <dossier.receipt.json> [keys.json]");
    process.exit(2);
  }
  const failures = [];
  const report = (ok, message) => {
    console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
    if (!ok) failures.push(message);
  };

  const archive = new Uint8Array(await readFile(archivePath));
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const entries = readZip(archive);
  report(true, `archive read: ${entries.size} entries, every CRC-32 correct`);

  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("manifest.json is missing from the archive");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));

  let mismatched = 0;
  for (const file of manifest.files) {
    const bytes = entries.get(file.path);
    if (!bytes) { report(false, `listed in the manifest but missing: ${file.path}`); mismatched += 1; continue; }
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      report(false, `does not match the manifest: ${file.path}`);
      mismatched += 1;
    }
  }
  report(mismatched === 0, `${manifest.files.length} manifest entries match their SHA-256`);

  const unlisted = [...entries.keys()].filter((path) => path !== "manifest.json" && !manifest.files.some((file) => file.path === path));
  report(unlisted.length === 0, unlisted.length === 0 ? "no unlisted files in the archive" : `unlisted files present: ${unlisted.join(", ")}`);

  report(sha256(manifestBytes) === receipt.content_sha256, "manifest.json matches the receipt's content_sha256");
  report(sha256(archive) === receipt.sha256, "the archive matches the receipt's sha256");
  report(receipt.kind === "DOSSIER", `the receipt is for a dossier (kind: ${receipt.kind})`);
  report(receipt.id === manifest.seal_id, "the receipt and the manifest name the same seal");

  if (keysPath) {
    const keys = JSON.parse(await readFile(keysPath, "utf8"));
    const key = (keys.keys ?? []).find((candidate) => candidate.key_id === receipt.key_id);
    if (!key) {
      report(false, `no published key matches the receipt's key_id ${receipt.key_id}`);
    } else {
      const verifier = createVerify("sha256");
      verifier.update(Buffer.from(signedMessage(receipt), "utf8"));
      report(verifier.verify(key.public_key_pem, Buffer.from(receipt.signature, "base64")), `signature verifies with published key ${key.key_id}`);
    }
  } else {
    console.log("--    signature not checked: pass keys.json from /.well-known/theckards-keys.json to check it");
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nDossier verified: ${manifest.files.length} files, seal ${manifest.seal_id}, generated ${manifest.generated_at}.`);
}

main().catch((error) => {
  console.error(`verification error: ${error.message}`);
  process.exit(1);
});
