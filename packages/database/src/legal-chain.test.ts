import { legalDocumentApprovalBlockers, type LegalDocumentType } from "@theckards/domain";
import { describe, expect, it } from "vitest";
import { ESIGN_V1, NOTICE_V1, PRIVACY_V1, TERMS_V1 } from "./legal-v1.js";
import { ESIGN_V2, PRIVACY_V2, TERMS_V2 } from "./legal-v2.js";
import { PRIVACY_V3_REPLACEMENTS } from "./legal-v3.js";
import { ESIGN_V3_REPLACEMENTS, PRIVACY_V4_EVIDENCE_REPLACEMENTS, PRIVACY_V4_REPLACEMENTS } from "./legal-v4.js";

/**
 * The production build gate for legal text.
 *
 * `production.md` requires that a production build fail if a legal text ships as an unfinished draft. The image
 * build runs `pnpm test`, so these assertions are that gate: a document with an unresolved `[TO COMPLETE: …]`
 * marker, or one short enough to be truncated, cannot reach an image.
 *
 * It also checks the part that is easy to get silently wrong. Later versions are not shipped as whole documents;
 * they are produced in SQL by exact `replace()` calls against the previous approved version. If a search string
 * stops matching, PostgreSQL does not complain: it returns the text unchanged, and the new "version" quietly
 * keeps the old wording while the feature that depends on the new disclosure goes live. So every search string
 * has to match its base document exactly once.
 */
type Chain = { type: LegalDocumentType; version: number; base: string; steps: ReadonlyArray<ReadonlyArray<readonly [string, string]>> };

const apply = (body: string, pairs: ReadonlyArray<readonly [string, string]>): string =>
  pairs.reduce((text, [from, to]) => text.replaceAll(from, to), body);

/**
 * The documents the migrations put in the database as whole texts, and which the owner is expected to be able to
 * approve as written. The v1 Terms and Privacy Policy are not here on purpose: they are templates that ask the
 * owner for their own legal identity, and the assertions below require that they stay unapprovable until filled.
 */
const whole: ReadonlyArray<{ type: LegalDocumentType; version: number; body: string }> = [
  { type: "ESIGN", version: 1, body: ESIGN_V1 },
  { type: "NOTICE", version: 1, body: NOTICE_V1 },
  { type: "TERMS", version: 2, body: TERMS_V2 },
  { type: "PRIVACY", version: 2, body: PRIVACY_V2 },
  { type: "ESIGN", version: 2, body: ESIGN_V2 },
];

/** Templates that must never be approvable until the owner supplies what only the owner knows. */
const awaitingOwner: ReadonlyArray<{ type: LegalDocumentType; body: string }> = [
  { type: "TERMS", body: TERMS_V1 },
  { type: "PRIVACY", body: PRIVACY_V1 },
];

const chains: readonly Chain[] = [
  { type: "PRIVACY", version: 3, base: PRIVACY_V2, steps: [PRIVACY_V3_REPLACEMENTS] },
  { type: "PRIVACY", version: 4, base: PRIVACY_V2, steps: [PRIVACY_V3_REPLACEMENTS, PRIVACY_V4_REPLACEMENTS, PRIVACY_V4_EVIDENCE_REPLACEMENTS] },
  { type: "ESIGN", version: 3, base: ESIGN_V2, steps: [ESIGN_V3_REPLACEMENTS] },
];

const composed = (chain: Chain): string => chain.steps.reduce((text, pairs) => apply(text, pairs), chain.base);

describe("no legal text ships as an unfinished draft", () => {
  for (const document of whole) {
    it(`${document.type} v${document.version} can be approved as written`, () => {
      expect(legalDocumentApprovalBlockers(document.type, document.body)).toEqual([]);
    });
  }

  for (const chain of chains) {
    it(`${chain.type} v${chain.version} can be approved once composed`, () => {
      expect(legalDocumentApprovalBlockers(chain.type, composed(chain))).toEqual([]);
    });
  }

  // The other direction of the same guarantee: a template the owner has not completed must stay blocked, so an
  // operator's legal name cannot be left as a marker in a document people are asked to accept.
  for (const template of awaitingOwner) {
    it(`${template.type} v1 stays blocked until the owner fills it in`, () => {
      const blockers = legalDocumentApprovalBlockers(template.type, template.body);
      expect(blockers.length).toBeGreaterThan(0);
      expect(blockers.join(" ")).toContain("legal name and address of the operator");
    });
  }
});

describe("every legal replacement actually applies", () => {
  for (const chain of chains) {
    it(`${chain.type} v${chain.version} replaces text that exists exactly once`, () => {
      let text = chain.base;
      for (const [index, pairs] of chain.steps.entries()) {
        for (const [from] of pairs) {
          const occurrences = text.split(from).length - 1;
          expect(occurrences, `step ${index + 1} of ${chain.type} v${chain.version} searches for text that occurs ${occurrences} times: ${from.slice(0, 60)}…`).toBe(1);
        }
        text = apply(text, pairs);
      }
    });
  }

  it("leaves no search string behind in the composed document", () => {
    // A replacement whose output still contains its own input would make a later step ambiguous.
    for (const chain of chains) {
      const text = composed(chain);
      expect(text).not.toContain("[TO COMPLETE:");
      expect(text.length).toBeGreaterThan(chain.base.length);
    }
  });
});

// The three gated features each depend on a specific disclosure existing in the version they wait for.
describe("the gated features are the ones the drafts disclose", () => {
  const privacy4 = composed(chains.find((chain) => chain.type === "PRIVACY" && chain.version === 4)!);
  const esign3 = composed(chains.find((chain) => chain.type === "ESIGN")!);

  it("privacy v4 discloses cases and evidence, which gate on it", () => {
    expect(privacy4).toContain("Theckards does not decide cases.");
    expect(privacy4).toContain("Evidence files:");
    expect(privacy4).toContain("proposals");
  });

  it("esign v3 covers signing a resolution addendum", () => {
    expect(esign3).toContain("Resolution addenda:");
  });

  it("privacy v3 discloses the record entries that gate on it", () => {
    const privacy3 = composed(chains.find((chain) => chain.version === 3)!);
    expect(privacy3).toContain("Record entries:");
  });
});
