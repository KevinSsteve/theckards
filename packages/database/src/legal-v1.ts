// Initial production drafts (v1). Loaded into DRAFT rows by migration 0006; the owner reviews, completes the
// [TO COMPLETE: ...] fields and approves in Admin -> Legal. Approval is blocked while any marker remains.
// Not legal advice: have a qualified US attorney review before or soon after launch.

export const TERMS_V1 = `# Terms of Service

These Terms govern your use of Theckards (the "Service"), operated by [TO COMPLETE: legal name and address of the operator] ("Theckards", "we", "us"). By creating an account, signing, or otherwise using the Service you agree to these Terms. The version and date you accepted are recorded.

## 1. What Theckards is - and is not
Theckards is software that lets two people who have already decided to deal with each other create an agreement from a guided template, sign it electronically, keep messages and records, and obtain a verifiable integrity receipt.
Theckards is not a law firm and does not give legal advice. Templates are filled only with the facts you enter; we do not recommend terms or tell you whether a document suits your situation.
Theckards never receives, holds, converts or transmits money or crypto-assets between the parties, and offers no escrow, payment protection or guarantee of performance. Payments between the parties happen outside the Service.
Theckards does not verify identity, ownership of goods, or the truth of anything a party enters, and does not decide disputes. If the parties disagree, the Service only organizes their records and proposals; any resolution exists only if both parties accept it.

## 2. Eligibility and accounts
You must be at least 18 years old and able to form a binding contract. You are responsible for your account credentials and for activity under your account. Provide accurate information and keep your email address current.

## 3. Electronic signatures
You can sign using a typed name, explicit consent to electronic signatures, and a one-time code sent to your email. By signing you agree that your electronic signature has the same effect as a handwritten one to the extent permitted by law, including the federal ESIGN Act and the Uniform Electronic Transactions Act as adopted by your state.
Some documents cannot be signed electronically or require formalities the Service does not provide. Do not use the Service for: wills, codicils and testamentary trusts; adoption, divorce or other family-law matters; court orders, notices or official court documents; notices of cancellation or termination of utility services; notices of default, acceleration, repossession, foreclosure or eviction concerning a primary residence; cancellation of health or life insurance; product recall or material safety failure notices; documents required to accompany the transport of hazardous materials; real-estate deeds or any document requiring notarization or witnesses; or any other document your local law excludes. You are responsible for choosing an appropriate method for your transaction.

## 4. Your responsibilities
You are responsible for the content you enter and for the transactions you record. You will not use the Service for anything illegal, fraudulent, deceptive or harmful, including the sale of prohibited or stolen goods, impersonation, harassment, or recording agreements on behalf of someone without authority. You may report abuse to abuse@theckards.linkealls.com. We may suspend or close accounts and preserve records when we reasonably believe these Terms or the law are being violated.

## 5. Records, seals and what they prove
When both parties sign the same version, we generate a final PDF and a receipt signed with a key controlled by Theckards. The receipt shows that the file you hold is byte-for-byte the file sealed at the time shown, and that the receipt was issued by Theckards. It does not prove that the content is true, that either party performed, or the civil identity of a signer; an email code is not strong identity verification. Anyone can check a seal on the public verification page, which never shows the parties' names.

## 6. Plans and fees
The Free plan includes a limited number of agreements per month and adds a watermark to sealed documents. Paid options, when offered, are shown with their price before purchase and are charged by our payment processor, Stripe. Fees pay for the software only; Theckards is never a party to payments between you and your counterparty. A failed or refunded payment for the Service never alters or deletes an agreement that was already signed.

## 7. Retention, export and deletion
How long we keep each category of data is described in the Privacy Policy. No plan promises a specific retention period. You can download your sealed documents at any time while your account is active. Deleting your account does not delete the copies held by the other party to an agreement.

## 8. Availability and changes to the Service
We work to keep the Service available but do not guarantee uninterrupted operation. We may change features. Material changes to these Terms are published as a new version; continued use after the new version takes effect, or acceptance when prompted, constitutes agreement.

## 9. Disclaimers
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT, AND ANY WARRANTY THAT AN AGREEMENT CREATED WITH THE SERVICE IS VALID OR ENFORCEABLE FOR YOUR PURPOSE.

## 10. Limitation of liability
TO THE EXTENT PERMITTED BY LAW, THECKARDS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOSSES ARISING FROM TRANSACTIONS BETWEEN USERS, AND OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE GREATER OF THE AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR US$100. Some jurisdictions do not allow these limitations, so they may not apply to you.

## 11. Indemnity
You will indemnify Theckards against third-party claims arising from your content, your transactions with other users, or your violation of these Terms or the law.

## 12. Termination
You may stop using the Service and delete your account at any time. We may suspend or terminate access for violation of these Terms or to comply with law. Sections 5, 7, 9, 10, 11 and 13 survive termination.

## 13. Governing law
These Terms are governed by the laws of [TO COMPLETE: State, e.g. Delaware], without regard to conflict-of-laws rules, and disputes will be brought in the state or federal courts located there, except where consumer-protection law gives you the right to sue where you live.

## 14. Contact
support@theckards.linkealls.com - legal@theckards.linkealls.com
`;

export const PRIVACY_V1 = `# Privacy Policy

This policy explains what personal information Theckards, operated by [TO COMPLETE: legal name and address of the operator], collects, why, and your choices. Contact: privacy@theckards.linkealls.com.

## 1. Information we collect
- Account: email address and an internal identifier from our sign-in provider (Amazon Cognito). Passwords are handled by Amazon Cognito; we never see them.
- Agreements: the template fields you enter (for example item, price, dates), titles, versions, and the documents generated from them.
- Counterparties: the name and, if provided, the email address of the person invited; or the email address the counterparty enters when opening an in-person (QR) invitation.
- Signature records: typed name, time, the hash of the signed document, the version of the electronic-signature consent accepted, and the IP address and browser user agent at signing. IP address and user agent are personal information; we store them encrypted and restrict access.
- Consent records: which version of these legal documents you accepted and when.
- Technical data: request identifiers and error logs without personal information, and essential cookies used only for sign-in, security and anti-forgery protection.
We do not collect payment card or bank details for payments between parties. If you buy a paid plan, Stripe collects your payment details directly.

## 2. How we use information
To provide the Service (create, sign, seal and deliver agreements; send verification codes, invitations and receipts), to secure it and prevent fraud and abuse, to provide support, and to comply with law. We do not sell personal information, do not share it for cross-context behavioral advertising, and do not use analytics that send agreement content to third parties.

## 3. Who can see what
The other party to an agreement can see the agreement content, both parties' names as entered, typed signatures and signing times. They cannot see your IP address or user agent. The public verification page reveals only whether a file matches a seal, its type, date and seal identifier - never names or content.

## 4. Service providers
We use Amazon Web Services (hosting, database, storage, encryption keys and email delivery, in the United States, region us-east-1) and, for paid plans, Stripe. If an AI-assisted form-filling feature is offered, the description you type is sent to Amazon Bedrock with emails, phone numbers and identifiers masked, is used only to suggest form values, and is not stored by us. Providers process data on our instructions.

## 5. Security
Data is encrypted in transit and at rest with keys managed in AWS Key Management Service; email addresses and signing evidence are additionally encrypted at the field level. Access is restricted and logged.

## 6. Retention
- Account data: until you delete your account.
- Agreements, versions, signature records and sealed receipts: kept while the agreement exists so both parties retain a verifiable record. A receipt may remain linked to a document or person after deletion requests where needed to keep the other party's record verifiable, and is not treated as anonymous data.
- Invitation links: expire after 7 days or when used.
- Technical logs: 90 days.
- Database backups: up to 35 days (currently 14), after which deleted data also leaves backups.
- Payment records held by Stripe: as required by tax law.
We do not promise longer retention than described here.

## 7. Your rights
You can request access to, correction of, export of, or deletion of your personal information by writing to privacy@theckards.linkealls.com. Depending on your state (for example California, Colorado, Connecticut, Virginia or Texas) you may have additional rights, including to appeal a decision. We verify requests and respond within 45 days. We do not discriminate against you for exercising your rights. Deleting your data does not remove the other party's copies of agreements you signed with them.

## 8. Children
The Service is not intended for anyone under 18 and we do not knowingly collect their information.

## 9. Changes
We publish changes as a new version and ask for acceptance when required.
`;

export const ESIGN_V1 = `# Electronic Records and Signature Consent

Please read this disclosure before you sign. It explains how you agree to sign and receive records electronically under the federal Electronic Signatures in Global and National Commerce Act (ESIGN).

## 1. Scope of your consent
By checking the consent box and signing, you agree to use an electronic signature for the agreement you are signing, and to receive electronically the related records: invitations, verification codes, notices about the agreement, the final sealed document and its receipt.

## 2. How the electronic signature works
You type your full name, confirm this consent, and enter a one-time code sent to your email address. Theckards records the time, the hash of the exact document version you signed, the version of this consent, and your IP address and browser user agent. If the terms change after you sign, a new version is created and your earlier signature does not apply to it.

## 3. Paper copies
You may request a paper copy of any record you signed through Theckards, free of charge, by writing to support@theckards.linkealls.com with the agreement title and seal identifier. You can also download and print the sealed PDF at any time while you have access.

## 4. Withdrawing consent
You may withdraw this consent at any time by writing to support@theckards.linkealls.com. Withdrawal applies to future records only: it does not affect the validity of signatures you already gave. If you withdraw before signing, you will not be able to sign that agreement through Theckards and you should arrange another signing method with the other party.

## 5. Keeping your contact information current
Records are sent to the email address associated with your account or invitation. To change it, update your account or write to support@theckards.linkealls.com.

## 6. Hardware and software requirements
- A current version of Chrome, Safari, Firefox or Edge with JavaScript and cookies enabled.
- An email account that can receive messages from theckards.linkealls.com.
- Software that opens PDF files, and a printer or storage to keep copies.
If these requirements change in a way that could prevent you from accessing records, we will tell you and you may withdraw consent without fees.

## 7. Confirmation
By checking the consent box you confirm that you can access and keep electronic records in the formats described above, that you have read this disclosure, and that you agree to sign and receive records electronically.
`;

export const NOTICE_V1 = `# Important Notice

- Theckards provides a verifiable record of an agreement between two people. It is not a law firm and does not provide legal advice.
- Theckards never receives, holds or transfers money between the parties and does not guarantee payment or performance.
- A sealed receipt proves that a file has not changed since it was sealed and that Theckards issued the receipt. It does not prove that the content is true or certify anyone's identity.
- Theckards does not decide disagreements between the parties.
- Review every field before signing. If your matter is significant or unusual, consult a qualified attorney.
`;
