import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { archiveSafeName, dossierManifest, dossierReadme, manifestBytes } from "./dossier.js";

const file = (path: string, describes = "a part of the record") => ({ path, sha256: "a".repeat(64), bytes: 10, describes });

const input = {
  agreementId: "11111111-1111-4111-8111-111111111111",
  sealId: "22222222-2222-5222-8222-222222222222",
  generatedAt: "2026-11-10T20:00:00.000Z",
  baseUrl: "https://theckards.linkealls.com",
};

describe("dossier manifest", () => {
  it("lists files in a stable order whatever order they were collected in", () => {
    const one = dossierManifest({ ...input, files: [file("b.json"), file("a.json"), file("documents/x.pdf")] });
    const two = dossierManifest({ ...input, files: [file("documents/x.pdf"), file("b.json"), file("a.json")] });
    expect(one.files.map((entry) => entry.path)).toEqual(["a.json", "b.json", "documents/x.pdf"]);
    expect(manifestBytes(one)).toBe(manifestBytes(two));
  });

  it("binds the manifest to the agreement and the seal", () => {
    const manifest = dossierManifest({ ...input, files: [file("a.json")] });
    expect(manifest.agreement_id).toBe(input.agreementId);
    expect(manifest.seal_id).toBe(input.sealId);
    expect(manifest.keys_url).toBe("https://theckards.linkealls.com/.well-known/theckards-keys.json");
  });

  it("changes its hash when any listed hash changes", () => {
    const before = manifestBytes(dossierManifest({ ...input, files: [file("a.json")] }));
    const after = manifestBytes(dossierManifest({ ...input, files: [{ ...file("a.json"), sha256: "b".repeat(64) }] }));
    expect(createHash("sha256").update(before).digest("hex")).not.toBe(createHash("sha256").update(after).digest("hex"));
  });
});

describe("dossier readme", () => {
  const readme = dossierReadme({
    agreementTitle: "Sale of iPhone 14",
    archiveName: "theckards-dossier",
    manifest: dossierManifest({ ...input, files: [file("documents/agreement.pdf")] }),
    ...input,
  });

  it("tells the reader how to check hashes and the signature with tools that are not ours", () => {
    expect(readme).toContain("sha256sum");
    expect(readme).toContain("openssl dgst -sha256 -verify public.pem");
    expect(readme).toContain("/.well-known/theckards-keys.json");
  });

  // G3: a verifiable record must never be described as a guarantee, a judgment or a legal opinion.
  it("never promises more than a record", () => {
    for (const forbidden of ["guarantee", "guaranteed", "protected", "legally binding", "winner", "judgment"]) {
      expect(readme.toLowerCase()).not.toContain(forbidden);
    }
    expect(readme).toContain("does not decide disputes");
  });
});

describe("archive safe names", () => {
  it("keeps readable names and extensions", () => {
    expect(archiveSafeName("receipt photo.jpg", "file")).toBe("receipt-photo.jpg");
    expect(archiveSafeName("Invoice_2026.PDF", "file")).toBe("Invoice_2026.pdf");
  });

  it("reduces non-ascii names without losing the extension", () => {
    expect(archiveSafeName("prova-ação.png", "file")).toBe("prova-acao.png");
    expect(archiveSafeName("日本.png", "evidence-1")).toBe("evidence-1.png");
  });

  it("neutralises anything that could escape or confuse extraction", () => {
    expect(archiveSafeName("../../etc/passwd", "file")).toBe("passwd");
    expect(archiveSafeName("/absolute/path.pdf", "file")).toBe("path.pdf");
    expect(archiveSafeName("", "evidence-3")).toBe("evidence-3");
    expect(archiveSafeName("...", "evidence-4")).toBe("evidence-4");
  });
});
