// Version 2 drafts: the signing method changed from email codes to in-person QR confirmation.
// Migration 0007 attempted to derive TERMS and PRIVACY from the owner's approved v1 by exact replacement.
// Migration 0008 safely replaces only unchanged v2 copies with these complete en-US drafts. The owner
// still reviews and approves every document in Admin -> Legal. This is product copy, not legal advice.

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

export const TERMS_V2 = `# Terms of Service

These Terms govern your use of Theckards (the "Service"), operated by SQUARE CIRCLE X SERVICES LDA., a company registered in Luanda, Republic of Angola ("Theckards", "we", "us"). By creating an account, signing, or otherwise using the Service, you agree to these Terms. We record the version and date you accepted.

## 1. What Theckards is, and is not
Theckards is software that lets two people who have already decided to deal with each other create an agreement from a guided template, sign it electronically, and obtain a verifiable integrity receipt.

Theckards is not a law firm and does not give legal advice. Templates only organize the facts you enter. We do not recommend terms or tell you whether a document suits your situation.

Theckards never receives, holds, converts or transmits money or crypto-assets between the parties and offers no escrow, payment protection or guarantee of performance. Payments between the parties happen outside the Service.

Theckards does not verify civil identity, ownership of goods, or the truth of anything a party enters, and does not decide disputes. Any amendment or resolution exists only if both parties accept it.

## 2. Eligibility and accounts
You must be at least 18 years old and able to form a binding contract. You are responsible for your account credentials and activity under your account. Provide accurate information and keep your account email address current.

## 3. Electronic signatures and in-person QR signing
Both parties must be together when they use the phase 1 signing flow.

The agreement creator signs using a typed full name and explicit electronic-signature consent from their signed-in account. The counterparty scans a short-lived QR code shown on the creator's device, reviews the same agreement version, types their full name, and gives explicit consent on their own device. A six-digit code then appears on the counterparty's device. The creator enters that code on their device to confirm that the signature was given in person.

A QR code expires after 15 minutes and is single-use. A confirmation code expires after 10 minutes. These steps create a recorded electronic signature and signing evidence; neither a signed-in account nor an in-person QR confirmation is strong identity verification.

Some documents cannot be signed electronically or require formalities the Service does not provide. Do not use the Service for wills or testamentary trusts; adoption, divorce or other family-law matters; court orders or official court documents; legally required notices concerning utilities, insurance, product recalls, hazardous materials, foreclosure, repossession or eviction; real-estate deeds; documents requiring notarization or witnesses; or any other document applicable law excludes. You are responsible for choosing an appropriate signing method.

## 4. Your responsibilities
You are responsible for the content you enter and the transactions you record. You must not use the Service for anything illegal, fraudulent, deceptive or harmful, including prohibited or stolen goods, impersonation, harassment, or recording an agreement for someone without authority. Report abuse to abuse@theckards.linkealls.com. We may suspend or close accounts and preserve records when we reasonably believe these Terms or applicable law are being violated.

## 5. Records, seals and what they prove
When both parties sign the same version, we generate a final PDF and an integrity receipt signed with a key controlled by Theckards. The receipt can show that a file is byte-for-byte the file sealed at the stated time and that Theckards issued the receipt. It does not prove that the content is true, that either party performed, or the civil identity of a signer. Anyone can check a seal on the public verification page, which does not show the parties' names.

## 6. Receiving and keeping a copy
The creator can download the sealed PDF from their account. A counterparty without an account must download and save the sealed PDF on the device used to sign, during the limited download window shown by the Service. The creator should also give the counterparty a copy. A party may request a paper copy through support@theckards.linkealls.com.

## 7. Plans and fees
The Free plan includes a limited number of agreements per month and adds a watermark to sealed documents. Paid options, when offered, are shown with their price before purchase and are charged by Stripe only for Theckards services. Theckards is never a party to payments between you and your counterparty. A failed or refunded payment for the Service does not alter or delete an agreement already signed.

## 8. Retention, export and deletion
The Privacy Policy describes how long we keep each category of data. No plan promises a specific retention period. You can download sealed documents while your account and the record remain available. Deleting your account does not delete copies held by the other party.

## 9. Availability and changes
We work to keep the Service available but do not guarantee uninterrupted operation. We may change features. Material changes to these Terms are published as a new version and require acceptance when applicable.

## 10. Disclaimers
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." TO THE EXTENT PERMITTED BY LAW, WE DISCLAIM WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ANY WARRANTY THAT AN AGREEMENT CREATED WITH THE SERVICE IS VALID OR ENFORCEABLE FOR YOUR PURPOSE.

## 11. Limitation of liability
TO THE EXTENT PERMITTED BY LAW, THECKARDS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOSSES ARISING FROM TRANSACTIONS BETWEEN USERS. OUR TOTAL LIABILITY FOR A CLAIM IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR US$100. Mandatory consumer law may give you rights that these limitations cannot restrict.

## 12. Indemnity
To the extent permitted by law, you will indemnify Theckards against third-party claims arising from your content, your transactions with other users, or your violation of these Terms or applicable law.

## 13. Termination
You may stop using the Service and request account deletion. We may suspend or terminate access for violation of these Terms or to comply with law. Sections concerning records, retention, disclaimers, liability, indemnity and governing law survive termination.

## 14. Governing law and disputes
These Terms are governed by the laws of the Republic of Angola. Courts in Luanda, Republic of Angola, have jurisdiction, except where mandatory consumer-protection law gives you another right or forum.

## 15. Contact
- General support: support@theckards.linkealls.com
- Legal: legal@theckards.linkealls.com
- Operator: SQUARE CIRCLE X SERVICES LDA., Luanda, Republic of Angola
`;

export const PRIVACY_V2 = `# Privacy Policy

This policy explains what personal information Theckards, operated by SQUARE CIRCLE X SERVICES LDA., a company registered in Luanda, Republic of Angola ("Theckards", "we", "us"), collects, why we use it, and your choices. Privacy contact: privacy@theckards.linkealls.com.

## 1. Information we collect
- Account data: email address and an internal identifier from Amazon Cognito. Amazon Cognito handles passwords; we do not see them.
- Agreement data: titles, versions, fields entered in a template (for example, an item or service, price and dates), and documents generated from those fields.
- Counterparty data: the full name the counterparty types when signing in person. The in-person flow does not require the counterparty's email address or an account.
- Signature records: typed name, time, the hash of the exact signed document, the version of the electronic-signature consent, the signing method, and any party that confirmed an in-person signature.
- Signing evidence: the IP address and browser user agent of the signing device. IP address and user agent are personal information. We encrypt them at the field level and restrict access.
- Consent records: the version of each legal document accepted and the acceptance time.
- Technical data: request identifiers and error logs without personal information. We use essential cookies for sign-in, security and anti-forgery protection, including a short-lived cookie that ties an in-person signature to the device used to sign it.

We do not collect bank-account, payment-card or cryptocurrency details for payments between parties. If you buy a paid Theckards plan, Stripe collects the billing payment details directly.

## 2. How we use information
We use personal information to create, display, sign and seal agreements; let both parties download the sealed record; provide support; secure the Service; prevent fraud and abuse; and comply with applicable law. We do not sell personal information, share it for cross-context behavioral advertising, or use analytics that send agreement content to third parties.

## 3. Who can see what
The other party can see the agreement content, both parties' names as entered, typed signatures, signing methods and signing times. They cannot see your IP address or user agent. The public verification page reveals only whether a file matches a seal, its type, date and seal identifier, and does not reveal names or agreement content.

## 4. Service providers and location
We use Amazon Web Services for authentication, hosting, databases, storage, queues, encryption keys and email services when enabled. Production data is hosted in the United States, AWS region us-east-1. We use Stripe for paid Theckards plans when offered.

If AI-assisted form filling is offered, the description you type is sent to Amazon Bedrock only after emails, telephone numbers and identifiers are masked. AI can suggest values for existing form fields only. The free text is not stored by Theckards. Service providers process data under our instructions.

## 5. Security
Data is encrypted in transit and at rest with keys managed by AWS Key Management Service. Email addresses and signing evidence are also encrypted at the field level. Access is restricted and audited. No internet service can guarantee absolute security.

## 6. Retention
- Account data: kept until the account is deleted, subject to records we must keep for another party or applicable law.
- Agreements, versions, signatures and sealed receipts: kept while the agreement exists so both parties retain a verifiable record. A receipt may remain linked to a document or person when needed to preserve the other party's record and is not treated as anonymous data.
- In-person QR tokens: expire after 15 minutes or when used; only a keyed hash of the token is stored.
- Confirmation codes: expire after 10 minutes; only a keyed hash is stored and it is cleared after successful confirmation.
- Counterparty download session: claimable on the signing device within 2 hours after completion. Session records then expire under the session policy.
- Technical logs: 90 days, unless the Admin dashboard specifies a shorter approved period.
- Database backups: currently 14 days and configurable up to the approved limit, after which deleted data also expires from backups.
- Stripe billing records: retained as required by applicable tax and accounting law.

We do not promise a longer retention period than this policy states.

## 7. Your rights
You may request access to, correction of, export of, or deletion of your personal information by writing to privacy@theckards.linkealls.com. Rights and response periods depend on applicable law, including Angola's Law No. 22/11 of 17 June on Personal Data Protection and any mandatory law where you live. We verify requests and do not discriminate against you for exercising your rights. Deleting your data does not remove copies of signed agreements lawfully retained by the other party.

## 8. Children
The Service is not intended for anyone under 18, and we do not knowingly collect personal information from children.

## 9. Changes
We publish changes as a new version and request acceptance when required.

## 10. Controller and contact
- Controller: SQUARE CIRCLE X SERVICES LDA., Luanda, Republic of Angola
- Privacy contact: privacy@theckards.linkealls.com
`;

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
