import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import { SEAL_MARK_SIZE, renderAgreement, sealMark, type AgreementSection, type TemplateId } from "@theckards/domain";
import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";

export interface FinalSigner {
  role: "Creator" | "Counterparty";
  typedName: string;
  signedAt: Date;
  method: "EMAIL_OTP" | "ACCOUNT_SESSION" | "IN_PERSON_QR";
}

export const METHOD_TEXT: Record<FinalSigner["method"], string> = {
  EMAIL_OTP: "Method: electronic signature with explicit consent and a one-time code sent to the party's email address.",
  ACCOUNT_SESSION: "Method: electronic signature with explicit consent, given from the party's signed-in account (email address verified at sign-up).",
  IN_PERSON_QR: "Method: electronic signature with explicit consent, given in person on the party's own device after scanning a single-use QR code; the other party confirmed it by entering a code shown on that device.",
};

export interface FinalOptions {
  sealId: string;
  sealedAt: Date;
  contentSha256: string;
  signedDocumentSha256: string;
  signers: readonly FinalSigner[];
  verifyUrl: string;
  watermark: boolean;
}

/**
 * The verification address a person reads off the page. The QR code beside it carries the full URL, including
 * the seal parameter; printing that parameter as text pushed the line under the seal impression and off the
 * right edge of the page, so the reader saw a truncated address.
 */
export function printedVerifyUrl(verifyUrl: string): string {
  return verifyUrl.split("?")[0]!.replace(/\/+$/, "");
}

const require = createRequire(import.meta.url);
let fontBytes: Uint8Array | undefined;

async function loadFont(): Promise<Uint8Array> {
  fontBytes ??= await readFile(require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
  return fontBytes;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderAgreementPdf(input: {
  agreementId: string;
  version: number;
  title: string;
  templateId: TemplateId;
  fields: unknown;
  createdAt: Date;
  /** Other sealed documents (resolution addenda) reuse the same layout and signature certificate. */
  document?: { subtitle: string; subject: string; sections: readonly AgreementSection[] };
}, final?: FinalOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadFont(), { subset: true, customName: "NotoSans" });
  const fixedDate = new Date((final?.sealedAt ?? input.createdAt).toISOString());
  pdf.setTitle(input.title, { showInWindowTitleBar: true });
  pdf.setAuthor("Theckards");
  pdf.setCreator("Theckards PDF worker");
  pdf.setProducer("Theckards 1");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  pdf.setSubject(input.document?.subject ?? `Agreement ${input.agreementId}, version ${input.version}`);
  pdf.setKeywords(["agreement", "verifiable record"]);

  const width = 612;
  const height = 792;
  const margin = 58;
  const bodySize = 10.5;
  const lineHeight = 15;
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
    page.drawText("THECKARDS · VERIFIABLE RECORD", { x: margin, y, size: 8, font, color: rgb(0.08, 0.42, 0.29) });
    y -= 30;
  };
  const ensure = (heightNeeded: number) => { if (y - heightNeeded < margin) newPage(); };
  const drawLines = (text: string, size = bodySize, color = rgb(0.09, 0.13, 0.11)) => {
    const lines = wrap(text, font, size, width - margin * 2);
    ensure(lines.length * lineHeight + 4);
    for (const line of lines) { page.drawText(line, { x: margin, y, size, font, color }); y -= lineHeight; }
    y -= 5;
  };

  newPage();
  drawLines(input.title, 22);
  drawLines(input.document?.subtitle ?? `Template: ${input.templateId.replaceAll("_", " ")} · Version ${input.version}`, 9, rgb(0.35, 0.4, 0.38));
  y -= 12;
  for (const section of input.document?.sections ?? renderAgreement(input.templateId, input.fields)) {
    ensure(45);
    drawLines(section.heading, 14, rgb(0.08, 0.42, 0.29));
    for (const paragraph of section.paragraphs) drawLines(paragraph);
    y -= 8;
  }
  ensure(45);
  drawLines(`Content record ID: ${input.agreementId}`, 8, rgb(0.35, 0.4, 0.38));
  if (!final) {
    drawLines("DRAFT PREVIEW — NOT SIGNED", 9, rgb(0.60, 0.20, 0.15));
    return pdf.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 1_000 });
  }

  // ---------- Signature certificate page ----------
  const muted = rgb(0.35, 0.4, 0.38);
  newPage();
  drawLines("Signature certificate", 20);
  drawLines(`Seal ID: ${final.sealId}`, 9, muted);
  drawLines(`Sealed at (UTC): ${final.sealedAt.toISOString()}`, 9, muted);
  drawLines(`Agreement content SHA-256: ${final.contentSha256}`, 8, muted);
  drawLines(`Signed document SHA-256: ${final.signedDocumentSha256}`, 8, muted);
  y -= 8;
  for (const signer of final.signers) {
    drawLines(signer.role, 13, rgb(0.08, 0.42, 0.29));
    drawLines(`Typed signature: ${signer.typedName}`);
    drawLines(`Signed at (UTC): ${signer.signedAt.toISOString()}`);
    drawLines(METHOD_TEXT[signer.method], 9, muted);
    y -= 6;
  }
  y -= 6;
  drawLines("What this record shows", 13, rgb(0.08, 0.42, 0.29));
  drawLines("Integrity: the receipt for this seal contains the SHA-256 of this exact file; any change to the file produces a different hash.", 9);
  drawLines("Authenticity: the receipt is signed with a key controlled by Theckards, verifiable with the published public key.", 9);
  drawLines("Limits: Theckards did not witness the negotiation, does not certify civil identity, and neither an email code, a signed-in account nor an in-person QR confirmation is strong identity verification. Theckards does not hold funds or guarantee performance or payment.", 9);

  const qr = await QRCode.toBuffer(final.verifyUrl, { type: "png", margin: 1, width: 220, errorCorrectionLevel: "M" });
  const qrImage = await pdf.embedPng(qr);
  ensure(130);
  page.drawImage(qrImage, { x: margin, y: y - 110, width: 110, height: 110 });
  page.drawText("Verify this record:", { x: margin + 125, y: y - 40, size: 10, font });
  // The QR carries the full URL including the seal parameter. The printed line is for a person to type, so it
  // drops the query and is shrunk if needed: a long URL used to run under the seal and off the page edge.
  const printedUrl = printedVerifyUrl(final.verifyUrl);
  const urlLeft = margin + 125;
  const urlWidth = width - margin - SEAL_MARK_SIZE - 12 - urlLeft;
  let urlSize = 8;
  while (urlSize > 5 && font.widthOfTextAtSize(printedUrl, urlSize) > urlWidth) urlSize -= 0.5;
  page.drawText(printedUrl, { x: urlLeft, y: y - 56, size: urlSize, font, color: muted });

  // The seal impression: pressed from the seal id alone, so the same seal always shows the same mark.
  const mark = sealMark(final.sealId);
  const wax = rgb(0.48, 0.12, 0.12);
  const markLeft = width - margin - mark.size;
  const markTop = y - 4;
  const cx = markLeft + mark.center;
  const cy = markTop - mark.center;
  page.drawCircle({ x: cx, y: cy, size: mark.outerRing, color: rgb(0.98, 0.94, 0.93), borderColor: wax, borderWidth: 1.6 });
  page.drawCircle({ x: cx, y: cy, size: mark.innerRing, borderColor: wax, borderWidth: 0.7 });
  page.drawSvgPath(mark.impression, { x: markLeft, y: markTop, color: wax, borderColor: wax, borderWidth: 0.6 });
  const caption = `SEAL ${mark.code}`;
  page.drawText(caption, { x: cx - font.widthOfTextAtSize(caption, 7) / 2, y: cy - mark.center - 6, size: 7, font, color: muted });

  if (final.watermark) {
    for (const each of pdf.getPages()) {
      each.drawText("THECKARDS FREE", { x: 150, y: 260, size: 54, font, color: rgb(0.85, 0.88, 0.86), opacity: 0.35, rotate: degrees(35) });
    }
  }

  return pdf.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 1_000 });
}
