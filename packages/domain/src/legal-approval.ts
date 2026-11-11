import type { LegalDocumentType } from "./legal.js";

// Kept apart from the zod schemas in legal.ts because the Admin dashboard runs these checks in the browser. zod
// probes for eval when it loads, and the web app's Content-Security-Policy reports that probe as a violation, so
// nothing the browser runs may import zod (apps/web/src/middleware.test.ts).

/** Unresolved owner inputs and seed placeholders that must never reach an APPROVED document. */
export function legalApprovalBlockers(bodyMd: string): string[] {
  const blockers = [...bodyMd.matchAll(/\[TO COMPLETE:[^\]]*\]/g)].map((match) => match[0]);
  if (/approval required before/i.test(bodyMd)) blockers.push("placeholder text");
  return blockers;
}

/** Catches obviously truncated documents in addition to unresolved placeholders. */
export function legalDocumentApprovalBlockers(documentType: LegalDocumentType, bodyMd: string): string[] {
  const blockers = legalApprovalBlockers(bodyMd);
  const minimumCharacters: Record<LegalDocumentType, number> = { TERMS: 3_000, PRIVACY: 2_000, ESIGN: 1_500, NOTICE: 300 };
  if (bodyMd.trim().length < minimumCharacters[documentType]) blockers.push(`document is too short for ${documentType}`);
  return blockers;
}
