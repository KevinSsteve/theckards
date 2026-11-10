// Version 2 drafts: the signing method changed from email codes to in-person QR confirmation.
// TERMS and PRIVACY v2 are derived from the owner's approved v1 (keeps the completed operator/state fields)
// by replacing the exact sentences below; ESIGN v2 is a full rewrite. The owner approves them in Admin -> Legal.

export const TERMS_V2_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "You can sign using a typed name, explicit consent to electronic signatures, and a one-time code sent to your email.",
    "You sign using your typed full name and explicit consent to electronic signatures. The agreement creator signs from their signed-in account. A counterparty signs in person: they scan a short-lived QR code shown on the creator's device and sign on their own device, and the creator confirms the signature by entering a code displayed on the counterparty's device.",
  ],
  [
    "an email code is not strong identity verification",
    "neither an email-verified account nor an in-person QR confirmation is strong identity verification",
  ],
];

export const PRIVACY_V2_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "- Counterparties: the name and, if provided, the email address of the person invited; or the email address the counterparty enters when opening an in-person (QR) invitation.",
    "- Counterparties: the full name the counterparty types when signing in person. We do not require the counterparty's email address or an account.",
  ],
  [
    "send verification codes, invitations and receipts",
    "display the sealed record so both parties can download it",
  ],
  [
    "essential cookies used only for sign-in, security and anti-forgery protection.",
    "essential cookies used only for sign-in, security and anti-forgery protection, including a short-lived cookie that ties an in-person signature to the device used to sign it.",
  ],
  [
    "- Invitation links: expire after 7 days or when used.",
    "- In-person signing QR codes: expire after 15 minutes or when used.",
  ],
];

export const ESIGN_V2 = `# Electronic Records and Signature Consent

Please read this disclosure before you sign. It explains how you agree to sign and receive records electronically under the federal Electronic Signatures in Global and National Commerce Act (ESIGN).

## 1. Scope of your consent
By checking the consent box and signing, you agree to use an electronic signature for the agreement you are signing and to receive the related records electronically, including the final sealed document and its integrity receipt.

## 2. How the electronic signature works
Both parties are together when they sign. You type your full name and confirm this consent.
- The agreement creator signs from their signed-in Theckards account.
- The counterparty scans a short-lived QR code shown on the creator's device, reviews the agreement and signs on their own device. A code then appears on the counterparty's device and the creator enters it on theirs to confirm that the signature was given in person.
Theckards records the time, the hash of the exact document version signed, the version of this consent, the signing method, and the IP address and browser user agent of the signing device. If the terms change after you sign, a new version is created and your earlier signature does not apply to it.

## 3. Receiving your copy
When both parties have signed, the sealed PDF and its receipt are shown on screen for each party to download. Save your copy: a counterparty who has no account can download it only during the signing session. Anyone can later confirm that a copy is unchanged on the public verification page.

## 4. Paper copies
You may request a paper copy of any record you signed through Theckards, free of charge, by writing to support@theckards.linkealls.com with the agreement title and seal identifier.

## 5. Withdrawing consent
You may withdraw this consent at any time by writing to support@theckards.linkealls.com. Withdrawal applies to future records only and does not affect the validity of signatures already given. If you withdraw before signing, you will not be able to sign that agreement through Theckards and you should arrange another signing method with the other party.

## 6. Keeping your contact information current
If you have an account, keep its email address current. Counterparties signing in person are not required to give an email address; to receive future communications about a record, write to support@theckards.linkealls.com.

## 7. Hardware and software requirements
- A smartphone or computer with a current version of Chrome, Safari, Firefox or Edge, with JavaScript and cookies enabled; a camera to scan the QR code if you are the counterparty.
- Software that opens PDF files, and storage or a printer to keep copies.
If these requirements change in a way that could prevent you from accessing records, we will tell you and you may withdraw consent without fees.

## 8. Confirmation
By checking the consent box you confirm that you can access and keep electronic records in the formats described above, that you have read this disclosure, and that you agree to sign and receive records electronically.
`;
