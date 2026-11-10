import { REQUIRED_LEGAL_DOCUMENTS, renderAgreement, transition, type AgreementState, type TemplateId } from "@theckards/domain";
import type pg from "pg";
import { createGuestSession } from "./auth/session-store";
import { encryptText, hmac } from "./crypto";
import { getPool, inTransaction } from "./db";
import { ProblemError } from "./http/problem";
import { currentApprovedLegal, userHasCurrentConsents } from "./legal";
import { issueOtp, verifyOtp } from "./otp";

export interface Evidence { ip: string; userAgent: string }

export interface LockedAgreement {
  id: string;
  state: AgreementState;
  lock_version: number;
  current_version_number: number;
}

async function approvedEsignId(): Promise<{ esignId: string; documentIds: string[] }> {
  const documents = await currentApprovedLegal();
  const missing = REQUIRED_LEGAL_DOCUMENTS.filter((type) => !documents.some((d) => d.documentType === type));
  if (missing.length > 0) {
    throw new ProblemError(503, "Signing unavailable", "Signing opens after the legal documents are approved.");
  }
  return { esignId: documents.find((d) => d.documentType === "ESIGN")!.id, documentIds: documents.map((d) => d.id) };
}

/** Version 2 of Terms, Privacy and ESIGN is the first that describes in-person QR signing; v1 describes email codes. */
export const IN_PERSON_MIN_LEGAL_VERSION = 2;

export async function requireInPersonLegal(): Promise<{ esignId: string; documentIds: string[] }> {
  const legal = await approvedEsignId();
  const documents = await currentApprovedLegal();
  const outdated = (["TERMS", "PRIVACY", "ESIGN"] as const).filter((type) => (documents.find((d) => d.documentType === type)?.version ?? 0) < IN_PERSON_MIN_LEGAL_VERSION);
  if (outdated.length > 0) {
    throw new ProblemError(503, "Signing unavailable", "In-person signing opens after the updated legal documents (version 2) are approved.");
  }
  return legal;
}

export async function emailDeliveryEnabled(): Promise<boolean> {
  const result = await getPool().query<{ enabled: string | null }>("SELECT value->>'EMAIL_DELIVERY_ENABLED' AS enabled FROM app_settings WHERE key = 'feature_flags'");
  return result.rows[0]?.enabled === "true";
}

export async function requireEmailDelivery(): Promise<void> {
  if (!(await emailDeliveryEnabled())) {
    throw new ProblemError(409, "Email delivery disabled", "Email invitations and codes are turned off. Use in-person QR signing.");
  }
}

export async function encryptEvidence(evidence: Evidence): Promise<[Buffer, Buffer]> {
  return Promise.all([
    encryptText(evidence.ip, "signature-ip"),
    encryptText(evidence.userAgent.slice(0, 512), "signature-user-agent"),
  ]);
}

export async function currentVersion(client: pg.PoolClient, agreementId: string, number: number): Promise<{ id: string; document_sha256: string; content_sha256: string }> {
  const result = await client.query<{ id: string; render_status: string; document_sha256: string | null; content_sha256: string }>(
    "SELECT id, render_status, document_sha256, content_sha256 FROM agreement_versions WHERE agreement_id = $1 AND number = $2",
    [agreementId, number],
  );
  const row = result.rows[0];
  if (!row || row.render_status !== "READY" || !row.document_sha256) {
    throw new ProblemError(409, "Preview pending", "The document must be ready before it can be signed.");
  }
  return { id: row.id, document_sha256: row.document_sha256, content_sha256: row.content_sha256 };
}

/**
 * Inserts one signature for the current version and, when both parties have signed
 * exactly the same document hash, executes the agreement and queues sealing.
 */
export type VerificationMethod = "EMAIL_OTP" | "ACCOUNT_SESSION" | "IN_PERSON_QR";

export async function recordSignature(client: pg.PoolClient, input: {
  agreement: LockedAgreement; partyId: string; role: "CREATOR" | "COUNTERPARTY";
  typedName: string; esignId: string; evidence: [Buffer, Buffer];
  method: VerificationMethod; otpVerifiedAt?: Date | null; confirmedByPartyId?: string | null;
}): Promise<AgreementState> {
  const allowed: AgreementState[] = input.role === "CREATOR" ? ["DRAFT", "PENDING_SIGNATURES"] : ["PENDING_SIGNATURES"];
  if (!allowed.includes(input.agreement.state)) throw new ProblemError(409, "Invalid state", "This agreement cannot be signed in its current state.");
  const version = await currentVersion(client, input.agreement.id, input.agreement.current_version_number);
  const inserted = await client.query(`
    INSERT INTO signatures(agreement_id, version_id, party_id, typed_name, esign_document_id, otp_verified_at,
      ip_ciphertext, user_agent_ciphertext, document_sha256, content_sha256, verification_method, confirmed_by_party_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (version_id, party_id) DO NOTHING
  `, [input.agreement.id, version.id, input.partyId, input.typedName, input.esignId, input.otpVerifiedAt ?? null,
      input.evidence[0], input.evidence[1], version.document_sha256, version.content_sha256, input.method, input.confirmedByPartyId ?? null]);
  if (inserted.rowCount !== 1) throw new ProblemError(409, "Already signed", "This version is already signed by this party.");

  const signed = await client.query<{ role: string; document_sha256: string }>(`
    SELECT p.role, s.document_sha256 FROM signatures s JOIN parties p ON p.id = s.party_id
    WHERE s.version_id = $1
  `, [version.id]);
  const roles = new Set(signed.rows.map((row) => row.role));
  const sameHash = signed.rows.every((row) => row.document_sha256 === version.document_sha256);
  let state = input.agreement.state;
  if (state === "PENDING_SIGNATURES" && roles.has("CREATOR") && roles.has("COUNTERPARTY") && sameHash) {
    state = transition(state, "EXECUTED");
    await client.query("UPDATE agreements SET state = $2, executed_at = now(), lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [input.agreement.id, state]);
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('seal.final', $1::jsonb)", [JSON.stringify({ agreementId: input.agreement.id, versionId: version.id })]);
  } else {
    await client.query("UPDATE agreements SET lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [input.agreement.id]);
  }
  return state;
}

// ---------- Creator ----------

export async function creatorContext(userId: string, agreementId: string): Promise<{ partyId: string; emailHash: string }> {
  const result = await getPool().query<{ party_id: string; email_hash: string }>(`
    SELECT p.id AS party_id, u.email_hash FROM agreements a
    JOIN parties p ON p.agreement_id = a.id AND p.role = 'CREATOR' AND p.user_id = $2
    JOIN users u ON u.id = $2
    WHERE a.id = $1 AND a.creator_id = $2
  `, [agreementId, userId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
  return { partyId: row.party_id, emailHash: row.email_hash };
}

const signScope = (agreementId: string, partyId: string) => `sign:${agreementId}:${partyId}`;

/** The creator signs from their authenticated account session (Cognito sign-in with a verified email). */
export async function signAsCreator(input: {
  userId: string; agreementId: string; expectedLockVersion: number; typedName: string; evidence: Evidence;
}): Promise<{ state: AgreementState }> {
  if (!(await userHasCurrentConsents(input.userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents before signing.");
  const { esignId } = await requireInPersonLegal();
  const context = await creatorContext(input.userId, input.agreementId);
  const evidence = await encryptEvidence(input.evidence);
  const state = await inTransaction(async (client) => {
    const locked = await client.query<LockedAgreement>(
      "SELECT id, state, lock_version, current_version_number FROM agreements WHERE id = $1 AND creator_id = $2 FOR UPDATE",
      [input.agreementId, input.userId],
    );
    const agreement = locked.rows[0];
    if (!agreement) throw new ProblemError(404, "Not Found", "Agreement not found.");
    if (agreement.lock_version !== input.expectedLockVersion) throw new ProblemError(412, "Precondition Failed", "The agreement changed. Reload and review it again before signing.");
    return recordSignature(client, { agreement, partyId: context.partyId, role: "CREATOR", typedName: input.typedName, esignId, evidence, method: "ACCOUNT_SESSION" });
  });
  return { state };
}

// ---------- Guest (counterparty without an account) ----------

export interface InviteContext {
  partyId: string;
  agreementId: string;
  displayName: string;
  emailHash: string | null;
  consumed: boolean;
  channel: "EMAIL" | "LINK";
  expiresAt: Date | null;
  state: AgreementState;
  title: string;
  templateId: TemplateId;
  versionNumber: number;
  renderStatus: string;
  sections: ReturnType<typeof renderAgreement>;
  creatorSignedName: string | null;
  counterpartySignedAt: Date | null;
  finalSealId: string | null;
}

export async function loadInvite(token: string): Promise<InviteContext | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const result = await getPool().query<{
    party_id: string; agreement_id: string; display_name: string; email_hash: string | null; invite_consumed_at: Date | null; invite_channel: "EMAIL" | "LINK";
    invite_expires_at: Date | null; state: AgreementState; title: string; template_id: TemplateId; number: number;
    render_status: string; fields: Record<string, unknown>; creator_name: string | null; cp_signed_at: Date | null; seal_id: string | null;
  }>(`
    SELECT p.id AS party_id, p.agreement_id, p.display_name, p.email_hash, p.invite_consumed_at, p.invite_channel, p.invite_expires_at,
      a.state, a.title, a.template_id, v.number, v.render_status, v.fields,
      (SELECT s.typed_name FROM signatures s JOIN parties cp ON cp.id = s.party_id AND cp.role = 'CREATOR' WHERE s.version_id = v.id) AS creator_name,
      (SELECT s.signed_at FROM signatures s WHERE s.version_id = v.id AND s.party_id = p.id) AS cp_signed_at,
      (SELECT d.id FROM sealed_documents d WHERE d.version_id = v.id AND d.kind = 'FINAL') AS seal_id
    FROM parties p
    JOIN agreements a ON a.id = p.agreement_id
    JOIN agreement_versions v ON v.agreement_id = a.id AND v.number = a.current_version_number
    WHERE p.invite_token_hash = $1 AND p.role = 'COUNTERPARTY'
  `, [hmac(token, "auth")]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    partyId: row.party_id, agreementId: row.agreement_id, displayName: row.display_name, emailHash: row.email_hash,
    consumed: row.invite_consumed_at !== null, channel: row.invite_channel, expiresAt: row.invite_expires_at, state: row.state, title: row.title,
    templateId: row.template_id, versionNumber: row.number, renderStatus: row.render_status,
    sections: renderAgreement(row.template_id, row.fields), creatorSignedName: row.creator_name,
    counterpartySignedAt: row.cp_signed_at, finalSealId: row.seal_id,
  };
}

function requireUsableInvite(invite: InviteContext | null): InviteContext {
  if (!invite || invite.consumed || !invite.expiresAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new ProblemError(404, "Invitation unavailable", "This invitation link is invalid, expired or already used.");
  }
  return invite;
}

/**
 * Emails a code to the invited party. For QR/link invitations without an email, the scanner supplies their own
 * address here; it can be corrected until the invitation is consumed, and it may not be the creator's address (F1).
 */
export async function requestGuestCode(token: string, ip: string, email?: string): Promise<{ expiresAt: string }> {
  await requireEmailDelivery();
  await approvedEsignId();
  const invite = requireUsableInvite(await loadInvite(token));
  let emailHash = invite.emailHash;
  const channel = await getPool().query<{ invite_channel: string; creator_hash: string }>(`
    SELECT p.invite_channel, u.email_hash AS creator_hash FROM parties p
    JOIN agreements a ON a.id = p.agreement_id JOIN users u ON u.id = a.creator_id WHERE p.id = $1
  `, [invite.partyId]);
  if (channel.rows[0]?.invite_channel === "LINK") {
    if (!email) throw new ProblemError(422, "Email required", "Enter the email address where you want to receive the verification code.");
    const normalized = email.trim().toLowerCase();
    emailHash = hmac(normalized, "email");
    if (emailHash === channel.rows[0].creator_hash) throw new ProblemError(422, "Invalid email", "Use your own email address, not the agreement creator's.");
    await getPool().query(
      "UPDATE parties SET email_ciphertext = $2, email_hash = $3 WHERE id = $1 AND invite_consumed_at IS NULL",
      [invite.partyId, await encryptText(normalized, "guest-email"), emailHash],
    );
  }
  if (!emailHash) throw new ProblemError(409, "Email missing", "This invitation has no email address.");
  return issueOtp({ scope: signScope(invite.agreementId, invite.partyId), emailHash, ip, recipient: { kind: "party", partyId: invite.partyId } });
}

type GuestAction = { action: "sign"; typedName: string } | { action: "request_changes" };

export async function completeGuestAction(input: { token: string; code: string; evidence: Evidence } & GuestAction): Promise<{
  state: AgreementState; session: { token: string; csrf: string; absoluteExpiresAt: Date };
}> {
  await requireEmailDelivery();
  const legal = await approvedEsignId();
  const invite = requireUsableInvite(await loadInvite(input.token));
  if (!invite.emailHash) throw new ProblemError(422, "Invalid code", "Request a verification code first.");
  const otpVerifiedAt = await verifyOtp(signScope(invite.agreementId, invite.partyId), invite.emailHash, input.code);
  const evidence = await encryptEvidence(input.evidence);
  return inTransaction(async (client) => {
    const party = await client.query<{ invite_consumed_at: Date | null }>(
      "SELECT invite_consumed_at FROM parties WHERE id = $1 AND invite_token_hash = $2 FOR UPDATE",
      [invite.partyId, hmac(input.token, "auth")],
    );
    if (!party.rows[0] || party.rows[0].invite_consumed_at) throw new ProblemError(404, "Invitation unavailable", "This invitation link was already used.");
    const locked = await client.query<LockedAgreement>(
      "SELECT id, state, lock_version, current_version_number FROM agreements WHERE id = $1 FOR UPDATE",
      [invite.agreementId],
    );
    const agreement = locked.rows[0]!;
    for (const documentId of legal.documentIds) {
      await client.query(`
        INSERT INTO party_consents(party_id, legal_document_id, ip_ciphertext, user_agent_ciphertext)
        VALUES ($1, $2, $3, $4) ON CONFLICT (party_id, legal_document_id) DO NOTHING
      `, [invite.partyId, documentId, evidence[0], evidence[1]]);
    }
    let state: AgreementState;
    if (input.action === "sign") {
      state = await recordSignature(client, { agreement, partyId: invite.partyId, role: "COUNTERPARTY", typedName: input.typedName, esignId: legal.esignId, method: "EMAIL_OTP", otpVerifiedAt, evidence });
    } else {
      state = transition(agreement.state, "REVISION_REQUESTED");
      await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [agreement.id, state]);
      await client.query("INSERT INTO outbox(topic, payload) VALUES ('email.revision_requested', $1::jsonb)", [JSON.stringify({ agreementId: agreement.id })]);
    }
    await client.query("UPDATE parties SET invite_consumed_at = now() WHERE id = $1", [invite.partyId]);
    const session = await createGuestSession(client, agreement.id, invite.partyId);
    return { state, session };
  });
}

// ---------- Sealed documents ----------

export async function finalDocumentFor(agreementId: string): Promise<{ id: string; s3Key: string; sha256: string } | null> {
  const result = await getPool().query<{ id: string; s3_key: string; sha256: string }>(`
    SELECT d.id, d.s3_key, d.sha256 FROM sealed_documents d
    JOIN agreements a ON a.id = d.agreement_id
    JOIN agreement_versions v ON v.id = d.version_id AND v.number = a.current_version_number
    WHERE d.agreement_id = $1 AND d.kind = 'FINAL'
  `, [agreementId]);
  const row = result.rows[0];
  return row ? { id: row.id, s3Key: row.s3_key, sha256: row.sha256 } : null;
}
