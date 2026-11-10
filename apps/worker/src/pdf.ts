import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import { renderAgreement, type TemplateId } from "@theckards/domain";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

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
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await loadFont(), { subset: true, customName: "NotoSans" });
  const fixedDate = new Date(input.createdAt.toISOString());
  pdf.setTitle(input.title, { showInWindowTitleBar: true });
  pdf.setAuthor("Theckards");
  pdf.setCreator("Theckards PDF worker");
  pdf.setProducer("Theckards 1");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  pdf.setSubject(`Agreement ${input.agreementId}, version ${input.version}`);
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
  drawLines(`Template: ${input.templateId.replaceAll("_", " ")} · Version ${input.version}`, 9, rgb(0.35, 0.4, 0.38));
  y -= 12;
  for (const section of renderAgreement(input.templateId, input.fields)) {
    ensure(45);
    drawLines(section.heading, 14, rgb(0.08, 0.42, 0.29));
    for (const paragraph of section.paragraphs) drawLines(paragraph);
    y -= 8;
  }
  ensure(45);
  drawLines(`Content record ID: ${input.agreementId}`, 8, rgb(0.35, 0.4, 0.38));
  drawLines("DRAFT PREVIEW — NOT SIGNED", 9, rgb(0.60, 0.20, 0.15));

  return pdf.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 1_000 });
}
