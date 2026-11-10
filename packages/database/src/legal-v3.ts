// Privacy v3 draft: the post-signature record (S5) adds confirmations, messages and notes.
// Derived from the owner's approved v2 by the exact replacements below; the owner approves it in Admin -> Legal.

export const PRIVACY_V3_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "- Consent records: the version of each legal document accepted and the acceptance time.",
    "- Record entries: confirmations each party declares after signing (for example item delivered or payment sent, with an optional note), messages between the parties and notes added to the record. Confirmations are declarations by a party; Theckards does not verify them.\n- Consent records: the version of each legal document accepted and the acceptance time.",
  ],
  [
    "The other party can see the agreement content, both parties' names as entered, typed signatures, signing methods and signing times.",
    "The other party can see the agreement content, both parties' names as entered, typed signatures, signing methods and signing times, and the confirmations, messages and notes on the record.",
  ],
  [
    "- Agreements, versions, signatures and sealed receipts: kept while the agreement exists",
    "- Agreements, versions, signatures, sealed receipts, confirmations, messages and notes: kept while the agreement exists and cannot be edited or deleted by either party",
  ],
];
