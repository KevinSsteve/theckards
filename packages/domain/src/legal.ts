import { z } from "zod";

export const LegalDocumentTypeSchema = z.enum(["TERMS", "PRIVACY", "ESIGN", "NOTICE"]);
export type LegalDocumentType = z.infer<typeof LegalDocumentTypeSchema>;

export const LegalDocumentStatusSchema = z.enum(["DRAFT", "APPROVED", "RETIRED"]);
export type LegalDocumentStatus = z.infer<typeof LegalDocumentStatusSchema>;

export const LegalDraftSchema = z.object({
  documentType: LegalDocumentTypeSchema,
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  title: z.string().trim().min(3).max(120),
  bodyMd: z.string().trim().min(20).max(100_000),
});

export const REQUIRED_LEGAL_DOCUMENTS = ["TERMS", "PRIVACY", "ESIGN", "NOTICE"] as const;

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
