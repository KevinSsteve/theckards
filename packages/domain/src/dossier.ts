import { canonicalJson } from "./canonical.js";

/**
 * The dossier: the whole record of one agreement as a single archive that proves itself.
 *
 * Two properties make it self-verifiable. Every file is listed in `manifest.json` with its SHA-256, so a reader
 * can check each part against the manifest with `sha256sum`. The archive itself is then sealed like any other
 * Theckards document, so its own SHA-256 appears in a receipt signed by a key published at `/.well-known`. The
 * README inside the archive explains both steps with commands that need nothing from Theckards.
 *
 * `content_sha256` of a dossier seal is the SHA-256 of the canonical manifest, so the receipt binds the logical
 * contents as well as the exact bytes of the container.
 */

export const DOSSIER_FORMAT = 1;

/** Fixed order, so the same record always produces the same archive. */
export const DOSSIER_README = "README.txt";
export const DOSSIER_MANIFEST = "manifest.json";

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  /** What the file is, in one line, for a reader who has never seen a dossier. */
  describes: string;
}

export interface DossierManifest {
  format: number;
  issuer: string;
  agreement_id: string;
  seal_id: string;
  generated_at: string;
  verify_url: string;
  keys_url: string;
  files: ManifestFile[];
  note: string;
}

export interface ManifestInput {
  agreementId: string;
  sealId: string;
  generatedAt: string;
  baseUrl: string;
  files: readonly ManifestFile[];
}

const NOTE = [
  "This archive is a record of what the parties agreed and declared. Theckards did not witness the negotiation,",
  "does not certify civil identity, does not decide disputes and does not handle payments between the parties.",
].join(" ");

export function dossierManifest(input: ManifestInput): DossierManifest {
  return {
    format: DOSSIER_FORMAT,
    issuer: "Theckards",
    agreement_id: input.agreementId,
    seal_id: input.sealId,
    generated_at: input.generatedAt,
    verify_url: `${input.baseUrl}/verify`,
    keys_url: `${input.baseUrl}/.well-known/theckards-keys.json`,
    // Sorted, so the manifest does not depend on the order the parts were collected in.
    files: [...input.files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    note: NOTE,
  };
}

/** The exact bytes whose SHA-256 becomes the seal's `content_sha256`. */
export function manifestBytes(manifest: DossierManifest): string {
  return canonicalJson(manifest);
}

export interface ReadmeInput {
  agreementTitle: string;
  agreementId: string;
  sealId: string;
  generatedAt: string;
  archiveName: string;
  baseUrl: string;
  manifest: DossierManifest;
}

/**
 * Plain text on purpose: a dossier may be opened years from now, by someone who only has the file and a
 * terminal. Every command here uses tools that are not ours.
 */
export function dossierReadme(input: ReadmeInput): string {
  const lines = [
    "THECKARDS DOSSIER",
    "=================",
    "",
    `Agreement: ${input.agreementTitle}`,
    `Agreement ID: ${input.agreementId}`,
    `Seal ID: ${input.sealId}`,
    `Generated at (UTC): ${input.generatedAt}`,
    "",
    "WHAT THIS IS",
    "",
    "The complete record of one agreement: the sealed documents, the signatures, what each party declared, the",
    "messages they exchanged, the evidence they attached and any case they opened. Every file is listed in",
    `${DOSSIER_MANIFEST} with its SHA-256.`,
    "",
    "The archive is itself a sealed Theckards document. Its receipt is delivered next to it as",
    `${input.archiveName}.receipt.json, and it contains the SHA-256 of this exact archive.`,
    "",
    "HOW TO CHECK IT WITHOUT TRUSTING THECKARDS",
    "",
    "1. Check each file against the manifest.",
    "",
    `   Read ${DOSSIER_MANIFEST}. For every entry, compute the hash of the extracted file and compare:`,
    "",
    "     sha256sum <path>",
    "",
    "   Every value must match the manifest. A mismatch means the archive was altered after it was built.",
    "",
    `   ${DOSSIER_MANIFEST} cannot list its own hash. Its SHA-256 is the "content_sha256" field of the receipt,`,
    "   so checking the receipt in step 3 also fixes the manifest:",
    "",
    `     sha256sum ${DOSSIER_MANIFEST}`,
    "",
    "2. Check the archive against its receipt.",
    "",
    "     sha256sum <archive.zip>",
    "",
    `   The value must equal the "sha256" field of ${input.archiveName}.receipt.json.`,
    "",
    "3. Check the receipt's signature, offline.",
    "",
    `   Download the public keys from ${input.baseUrl}/.well-known/theckards-keys.json and pick the key whose`,
    '   "key_id" matches the receipt. Save its "public_key_pem" as public.pem, and the receipt\'s "signature"',
    "   value (base64) as sig.b64.",
    "",
    "   The signed message is the canonical JSON (RFC 8785, which sorts the keys) of five receipt fields: id,",
    "   kind, sha256, content_sha256 and sealed_at. Take the values from the receipt and write exactly this,",
    "   with no trailing newline:",
    "",
    `     printf '%s' '${signedMessageExample(input.manifest, input.sealId)}' > message.txt`,
    "",
    "   Then decode the signature and verify it. The signature is DER-encoded ECDSA over P-256:",
    "",
    '     python3 -c "import base64;open(\'sig.der\',\'wb\').write(base64.b64decode(open(\'sig.b64\').read()))"',
    "     openssl dgst -sha256 -verify public.pem -signature sig.der message.txt",
    "",
    '   The expected output is "Verified OK".',
    "",
    "4. Check that the sealed agreement PDF is the one the parties signed.",
    "",
    `   Open ${input.baseUrl}/verify and select the PDF from this archive, or paste its SHA-256. The page`,
    "   hashes the file in your browser and never uploads it.",
    "",
    "WHAT IT DOES NOT MEAN",
    "",
    NOTE,
    "",
    "Theckards gives no legal advice, and a record is not a decision about who is right.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * A filename safe to write on any filesystem and to show in any terminal.
 *
 * Evidence filenames come from whoever uploaded the file, so they may contain non-ASCII characters, path
 * separators or nothing usable at all. The original is preserved in `evidence/index.json`; the name inside the
 * archive is reduced to ASCII so that old extraction tools, which ignore the archive's UTF-8 flag, still show
 * something a person can read.
 */
export function archiveSafeName(filename: string, fallback: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const match = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(base);
  const stem = (match?.[1] ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  const extension = (match?.[2] ?? "").toLowerCase();
  return `${stem || fallback}${extension}`;
}

/** A concrete example of the signed payload, so the reader can see the exact shape before substituting values. */
function signedMessageExample(manifest: DossierManifest, sealId: string): string {
  return canonicalJson({
    id: sealId,
    kind: "DOSSIER",
    sha256: "<archive sha256>",
    content_sha256: "<manifest sha256>",
    sealed_at: manifest.generated_at,
  });
}
