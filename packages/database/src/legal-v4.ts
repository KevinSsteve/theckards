// Drafts for S5 part 2 (cases and resolution addenda), derived from the owner's approved versions by exact
// replacements. Case features stay blocked until the owner approves PRIVACY v4 and ESIGN v3 in Admin -> Legal.

export const PRIVACY_V4_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Confirmations are declarations by a party; Theckards does not verify them.",
    "Confirmations are declarations by a party; Theckards does not verify them. If a party opens a case: the reason given, each party's proposals and acceptances, and any resolution addendum both parties sign. Theckards does not decide cases.",
  ],
  [
    "and the confirmations, messages and notes on the record.",
    "and the confirmations, messages, notes, case reasons, proposals and addenda on the record.",
  ],
  [
    "- Agreements, versions, signatures, sealed receipts, confirmations, messages and notes: kept",
    "- Agreements, versions, signatures, sealed receipts, confirmations, messages, notes, case records, proposals and addenda: kept",
  ],
];

export const ESIGN_V3_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "If the terms change after you sign, a new version is created and your earlier signature does not apply to it.",
    "If the terms change after you sign, a new version is created and your earlier signature does not apply to it.\n\nResolution addenda: if a case is opened and both parties accept a proposal, each party signs the resulting addendum from their own signed-in Theckards account by typing their full name and confirming this consent. The addendum is sealed like the agreement and does not replace the original sealed record.",
  ],
];

/**
 * Evidence uploads (S5 part 3) are disclosed by appending to the PRIVACY v4 draft, which the owner has not
 * approved yet. Anchors are text the v4 draft contains by construction; migration 0012 asserts that in tests.
 */
export const PRIVACY_V4_EVIDENCE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "Theckards does not decide cases.",
    "Theckards does not decide cases.\n- Evidence files: images or PDF documents a party attaches to the record, with the file name, type and size, and the hash of the stored file. Files are scanned for malware before the other party can see them, and a file that fails the scan is deleted. We keep the original file exactly as uploaded, so be aware that a photograph can carry metadata such as where and when it was taken; do not attach a file whose metadata you would not show the other party.",
  ],
  [
    "and the confirmations, messages, notes, case reasons, proposals and addenda on the record.",
    "and the confirmations, messages, notes, case reasons, proposals, addenda and evidence files on the record.",
  ],
  [
    "- Agreements, versions, signatures, sealed receipts, confirmations, messages, notes, case records, proposals and addenda: kept",
    "- Agreements, versions, signatures, sealed receipts, confirmations, messages, notes, case records, proposals, addenda and evidence files: kept",
  ],
];
