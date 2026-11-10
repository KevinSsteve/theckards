import type { AgreementSection } from "./templates.js";

/** Evidence window shown when a case opens. Informational only: nothing happens automatically when it ends (G2). */
export const CASE_EVIDENCE_WINDOW_DAYS = 7;
export const CASE_REASON_MAX = 2_000;
export const PROPOSAL_MAX = 4_000;

export interface AddendumInput {
  agreementTitle: string;
  originalSealId: string | null;
  originalSha256: string | null;
  proposalBody: string;
  proposedBy: string;
  proposedAt: string;
  acceptedBy: string;
  acceptedAt: string;
}

/**
 * Resolution addendum text. It records only what both parties accepted. It never states who was right,
 * never adds terms of its own and never promises enforcement, payment or legal validity (G2, G3, G4, G9).
 */
export function renderAddendum(input: AddendumInput): AgreementSection[] {
  const original = input.originalSealId
    ? `the sealed agreement "${input.agreementTitle}" (seal ${input.originalSealId}${input.originalSha256 ? `, SHA-256 ${input.originalSha256}` : ""})`
    : `the agreement "${input.agreementTitle}"`;
  return [
    { heading: "Resolution addendum", paragraphs: [
      `This addendum records a resolution that both parties accepted for ${original}. It adds to the original agreement and does not replace or modify the original sealed record.`,
    ] },
    { heading: "Accepted proposal", paragraphs: [
      input.proposalBody,
      `Proposed by ${input.proposedBy} on ${input.proposedAt}. Accepted by ${input.acceptedBy} on ${input.acceptedAt}.`,
    ] },
    { heading: "Important notice", paragraphs: [
      "Theckards did not decide this resolution and did not take part in it. The text above was written and accepted by the parties. Theckards does not hold or transfer funds, provide legal advice, or enforce this addendum.",
    ] },
  ];
}
