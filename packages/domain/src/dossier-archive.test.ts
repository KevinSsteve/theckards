import { execFile } from "node:child_process";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { DOSSIER_MANIFEST, DOSSIER_README, dossierManifest, dossierReadme, manifestBytes } from "./dossier.js";
import { zipStore } from "./zip.js";

/**
 * The acceptance test for S6.3: a dossier verifies itself.
 *
 * It assembles an archive exactly as the worker does, signs a receipt with a locally generated P-256 key (the
 * same algorithm and DER signature format AWS KMS returns) and then hands both to `scripts/verify-dossier.mjs`,
 * a script that imports none of this code. If the writer and the independent reader ever disagree, this fails.
 */
const run = promisify(execFile);
const script = new URL("../../../scripts/verify-dossier.mjs", import.meta.url).pathname;
const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KEY_ID = "55e7ae33-34f8-483d-be74-64c0334e87a6";

interface Fixture { directory: string; archive: string; receipt: string; keys: string }
let fixture: Fixture;

async function buildFixture(options: { tamperArchive?: boolean; wrongKey?: boolean; badReceiptHash?: boolean } = {}): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "dossier-"));
  const agreementId = "11111111-1111-4111-8111-111111111111";
  const sealId = "22222222-2222-5222-8222-222222222222";
  const generatedAt = "2026-11-10T20:00:00.000Z";
  const baseUrl = "https://theckards.linkealls.com";

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x80]);
  const agreement = encoder.encode(`${JSON.stringify({ id: agreementId, title: "Sale of iPhone 14" }, null, 2)}\n`);
  const parts = [
    { path: "agreement.json", bytes: agreement, describes: "The agreement." },
    { path: `documents/agreement-${sealId}.pdf`, bytes: pdf, describes: "The sealed agreement." },
  ];
  const files = parts.map((part) => ({ path: part.path, sha256: sha256(part.bytes), bytes: part.bytes.byteLength, describes: part.describes }));

  const partial = dossierManifest({ agreementId, sealId, generatedAt, baseUrl, files });
  const readme = encoder.encode(dossierReadme({
    agreementTitle: "Sale of iPhone 14", agreementId, sealId, generatedAt,
    archiveName: `theckards-dossier-${sealId}`, baseUrl, manifest: partial,
  }));
  const manifest = dossierManifest({
    agreementId, sealId, generatedAt, baseUrl,
    files: [...files, { path: DOSSIER_README, sha256: sha256(readme), bytes: readme.byteLength, describes: "How to verify." }],
  });
  const manifestJson = encoder.encode(manifestBytes(manifest));

  const archive = zipStore([
    { path: DOSSIER_README, bytes: readme },
    { path: DOSSIER_MANIFEST, bytes: manifestJson },
    ...parts.map((part) => ({ path: part.path, bytes: part.bytes })).sort((left, right) => (left.path < right.path ? -1 : 1)),
  ]);
  if (options.tamperArchive) {
    const index = archive.byteLength - 30;
    archive[index] = (archive[index] ?? 0) ^ 0xff;
  }

  const core = {
    id: sealId,
    kind: "DOSSIER",
    sha256: options.badReceiptHash ? "0".repeat(64) : sha256(archive),
    content_sha256: sha256(manifestJson),
    sealed_at: generatedAt,
  };
  const message = JSON.stringify({
    content_sha256: core.content_sha256, id: core.id, kind: core.kind, sealed_at: core.sealed_at, sha256: core.sha256,
  });
  const signature = createSign("sha256").update(Buffer.from(message, "utf8")).sign(privateKey);
  const signingKey = options.wrongKey ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey : publicKey;

  const paths = {
    directory,
    archive: join(directory, "dossier.zip"),
    receipt: join(directory, "dossier.receipt.json"),
    keys: join(directory, "keys.json"),
  };
  await Promise.all([
    writeFile(paths.archive, archive),
    writeFile(paths.receipt, JSON.stringify({ ...core, key_id: KEY_ID, algorithm: "ECDSA_P256_SHA256", signature: signature.toString("base64") }, null, 2)),
    writeFile(paths.keys, JSON.stringify({
      issuer: "Theckards",
      keys: [{ key_id: KEY_ID, algorithm: "ECDSA_P256_SHA256", public_key_pem: signingKey.export({ type: "spki", format: "pem" }), status: "ACTIVE" }],
    })),
  ]);
  return paths;
}

const verify = (paths: Fixture, withKeys = true) =>
  run("node", [script, paths.archive, paths.receipt, ...(withKeys ? [paths.keys] : [])]);

describe("a dossier verifies itself", () => {
  beforeAll(async () => { fixture = await buildFixture(); });

  it("passes every check in the independent script", async () => {
    const { stdout } = await verify(fixture);
    expect(stdout).toContain("manifest entries match their SHA-256");
    expect(stdout).toContain("manifest.json matches the receipt's content_sha256");
    expect(stdout).toContain("the archive matches the receipt's sha256");
    expect(stdout).toContain("signature verifies with published key");
    expect(stdout).toContain("Dossier verified");
    expect(stdout).not.toContain("FAIL");
  });

  it("checks hashes even without the public keys", async () => {
    const { stdout } = await verify(fixture, false);
    expect(stdout).toContain("signature not checked");
    expect(stdout).toContain("Dossier verified");
  });

  it("rejects an archive altered after it was sealed", async () => {
    const tampered = await buildFixture({ tamperArchive: true });
    await expect(verify(tampered)).rejects.toMatchObject({ code: 1 });
  });

  it("rejects a receipt that does not match the archive", async () => {
    const mismatched = await buildFixture({ badReceiptHash: true });
    await expect(verify(mismatched)).rejects.toMatchObject({ code: 1 });
  });

  it("rejects a signature from a key that is not the published one", async () => {
    const forged = await buildFixture({ wrongKey: true });
    await expect(verify(forged)).rejects.toMatchObject({ code: 1 });
  });
});
