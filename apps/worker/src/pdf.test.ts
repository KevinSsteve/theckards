import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { sealMark } from "@theckards/domain";
import { describe, expect, it } from "vitest";
import { renderAgreementPdf } from "./pdf.js";

const input = {
  agreementId: "00000000-0000-0000-0000-000000000001",
  version: 1,
  title: "Sale of iPhone 14",
  templateId: "purchase_sale" as const,
  fields: { itemDescription: "iPhone 14", price: "400.00", paymentMethod: "cash", deliveryDate: "2026-11-20", deliveryMethod: "In person", serialNumber: "ABC123" },
  createdAt: new Date("2026-11-10T00:00:00.000Z"),
};

const sealed = (sealId: string) => ({
  sealId,
  sealedAt: new Date("2026-11-10T20:00:00.000Z"),
  contentSha256: "a".repeat(64),
  signedDocumentSha256: "b".repeat(64),
  signers: [
    { role: "Creator" as const, typedName: "Alex Carter", signedAt: new Date("2026-11-10T19:58:00.000Z"), method: "ACCOUNT_SESSION" as const },
    { role: "Counterparty" as const, typedName: "Dana Reed", signedAt: new Date("2026-11-10T19:59:00.000Z"), method: "IN_PERSON_QR" as const },
  ],
  verifyUrl: "https://theckards.linkealls.com/verify",
  watermark: false,
});

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Every page content stream of the document, decompressed, as one string of PDF operators. */
function operators(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const text = raw.toString("latin1");
  const marker = /stream\r?\n/g;
  let out = "";
  for (let found = marker.exec(text); found; found = marker.exec(text)) {
    const start = found.index + found[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += `${inflateSync(raw.subarray(start, end)).toString("latin1")}\n`;
    } catch {
      /* not a compressed stream: fonts, images and metadata are not operator streams */
    }
  }
  return out;
}

/** The vertices of the only polygon on the page with more than twenty straight sides: the seal impression. */
function printedImpression(bytes: Uint8Array): number[][] {
  const path = operators(bytes).match(/([-\d.]+) ([-\d.]+) m(?:\s+[-\d.]+ [-\d.]+ l){20,}/);
  if (!path) return [];
  return [...path[0].matchAll(/([-\d.]+) ([-\d.]+) [ml]/g)].map((point) => [Number(point[1]), Number(point[2])]);
}

const vertices = (sealId: string) =>
  sealMark(sealId).impression.slice(1, -1).split(/[ML]/).map((point) => point.split(",").map(Number));

describe("agreement PDF", () => {
  it("produces the same bytes for the same immutable version", async () => {
    const [one, two] = await Promise.all([renderAgreementPdf(input), renderAgreementPdf(input)]);
    expect(hash(one)).toBe(hash(two));
    expect(one.byteLength).toBeGreaterThan(1_000);
  });

  // The README promises that the mark on paper and the mark on /verify cannot drift apart, because both come
  // from sealMark(). This asserts the printed half of that promise: the polygon drawn into the PDF is exactly
  // the geometry the pure function returns, translated to its place on the page.
  it("presses the seal impression from the seal id", async () => {
    const sealId = "b932630c-7185-5168-b469-745fd725c0c9";
    const printed = printedImpression(await renderAgreementPdf(input, sealed(sealId)));
    expect(printed).toEqual(vertices(sealId));
  });

  it("presses a different impression for a different seal", async () => {
    const other = "3d4a6a93-5d18-b8d8-70a8-e05605547406";
    const printed = printedImpression(await renderAgreementPdf(input, sealed(other)));
    expect(printed).toEqual(vertices(other));
    expect(printed).not.toEqual(vertices("b932630c-7185-5168-b469-745fd725c0c9"));
  });

  it("draws no impression before the agreement is sealed", async () => {
    expect(printedImpression(await renderAgreementPdf(input))).toEqual([]);
  });
});
