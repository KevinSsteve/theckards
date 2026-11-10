import { randomInt } from "node:crypto";
import { renderAgreement, transition, type AgreementState, type TemplateId } from "@theckards/domain";
import QRCode from "qrcode";
import { createGuestSession } from "./auth/session-store";
import { equalHex, hmac, randomToken } from "./crypto";
import { getPool, inTransaction } from "./db";
import { env } from "./env";
import { ProblemError } from "./http/problem";
import { userHasCurrentConsents } from "./legal";
import {
  creatorContext, currentVersion, encryptEvidence, finalDocumentFor, recordSignature, requireInPersonLegal,
  type Evidence, type LockedAgreement,
} from "./signing";

/**
 * In-person signing (phase 1, no email): both parties are side by side.
 * 1. The creator signs from their account and shows a single-use QR code (15 min).
 * 2. The counterparty scans it, reviews, types their name, consents and signs on their own device.
 *    That device is bound by a cookie and shows a 6-digit code (10 min).
 * 3. The creator types that code on their own screen: the counterparty signature is recorded,
 *    the agreement is executed and sealed. Both download the sealed PDF on screen.
 * Only hashes of the QR token, the device secret and the code are stored.
 */
export const QR_MINUTES = 15;
export const CODE_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
/** The counterparty may claim a download session on the signing device within this window after completion. */
export const DOWNLOAD_WINDOW_HOURS = 2;

export type InPersonStatus = "OPEN" | "AWAITING_CONFIRMATION" | "COMPLETED" | "CANCELLED";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const codeHash = (sessionId: string, code: string) => hmac(`in-person:${sessionId}:${code}`, "auth");
const deviceHash = (secret: string) => hmac(`in-person-device:${secret}`, "auth");

// ---------- Creator ----------

export async function startInPerson(userId: string, agreementId: string): Promise<{ url: string; expiresAt: string; svg: string }> {
  if (!(await userHasCurrentConsents(userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents first.");
  await requireInPersonLegal();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + QR_MINUTES * 60_000);
  await inTransaction(async (client) => {
    const locked = await client.query<LockedAgreement>(
      "SELECT id, state, lock_version, current_version_number FROM agreements WHERE id = $1 AND creator_id = $2 FOR UPDATE",
      [agreementId, userId],
    );
    const agreement = locked.rows[0];
    if (!agreement) throw new ProblemError(404, "Not Found", "Agreement not found.");
    if (!(["DRAFT", "PENDING_SIGNATURES"] as AgreementState[]).includes(agreement.state)) {
      throw new ProblemError(409, "Invalid state", "This agreement is not waiting for signatures.");
    }
    const version = await currentVersion(client, agreementId, agreement.current_version_number);
    const signed = await client.query<{ role: string }>(
      "SELECT p.role FROM signatures s JOIN parties p ON p.id = s.party_id WHERE s.version_id = $1",
      [version.id],
    );
    const roles = new Set(signed.rows.map((row) => row.role));
    if (!roles.has("CREATOR")) throw new ProblemError(409, "Creator signature required", "Sign the agreement before showing the QR code.");
    if (roles.has("COUNTERPARTY")) throw new ProblemError(409, "Already signed", "The other party already signed this version.");
    await client.query("UPDATE in_person_sessions SET status = 'CANCELLED' WHERE agreement_id = $1 AND status IN ('OPEN', 'AWAITING_CONFIRMATION')", [agreementId]);
    // Older email/link invitations stop working once signing moves in person.
    await client.query(
      "UPDATE parties SET invite_token_hash = NULL, invite_token_ciphertext = NULL, invite_expires_at = NULL WHERE agreement_id = $1 AND role = 'COUNTERPARTY'",
      [agreementId],
    );
    if (agreement.state === "DRAFT") {
      await client.query(
        "UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1",
        [agreementId, transition(agreement.state, "PENDING_SIGNATURES")],
      );
    }
    await client.query(
      "INSERT INTO in_person_sessions(agreement_id, version_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [agreementId, version.id, hmac(token, "auth"), expiresAt],
    );
  });
  const url = `${env().APP_BASE_URL}/s/${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { url, expiresAt: expiresAt.toISOString(), svg };
}

export interface CreatorInPersonView {
  status: InPersonStatus | "NONE" | "EXPIRED";
  expiresAt: string | null;
  counterpartyTypedName: string | null;
  attemptsLeft: number;
  agreementState: AgreementState;
}

export async function inPersonStatusForCreator(userId: string, agreementId: string): Promise<CreatorInPersonView> {
  const result = await getPool().query<{
    state: AgreementState; status: InPersonStatus | null; expires_at: Date | null; typed_name: string | null; attempts: number | null;
  }>(`
    SELECT a.state, s.status, s.expires_at, s.typed_name, s.attempts
    FROM agreements a
    LEFT JOIN LATERAL (
      SELECT status, expires_at, typed_name, attempts FROM in_person_sessions
      WHERE agreement_id = a.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE a.id = $1 AND a.creator_id = $2
  `, [agreementId, userId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
  const live = row.status === "OPEN" || row.status === "AWAITING_CONFIRMATION";
  const expired = live && !!row.expires_at && row.expires_at.getTime() <= Date.now();
  return {
    status: !row.status ? "NONE" : expired ? "EXPIRED" : row.status,
    expiresAt: row.expires_at?.toISOString() ?? null,
    counterpartyTypedName: row.status === "AWAITING_CONFIRMATION" && !expired ? row.typed_name : null,
    attemptsLeft: MAX_CODE_ATTEMPTS - (row.attempts ?? 0),
    agreementState: row.state,
  };
}

/** The creator enters the code shown on the counterparty's device. Records the counterparty signature. */
export async function confirmInPerson(userId: string, agreementId: string, code: string): Promise<{ state: AgreementState }> {
  const legal = await requireInPersonLegal();
  const creator = await creatorContext(userId, agreementId);
  const outcome = await inTransaction(async (client) => {
    const locked = await client.query<LockedAgreement>(
      "SELECT id, state, lock_version, current_version_number FROM agreements WHERE id = $1 AND creator_id = $2 FOR UPDATE",
      [agreementId, userId],
    );
    const agreement = locked.rows[0];
    if (!agreement) throw new ProblemError(404, "Not Found", "Agreement not found.");
    const pending = await client.query<{
      id: string; version_id: string; expires_at: Date; code_hash: string; attempts: number; typed_name: string;
      ip_ciphertext: Buffer; user_agent_ciphertext: Buffer;
    }>(`
      SELECT id, version_id, expires_at, code_hash, attempts, typed_name, ip_ciphertext, user_agent_ciphertext
      FROM in_person_sessions WHERE agreement_id = $1 AND status = 'AWAITING_CONFIRMATION'
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE
    `, [agreementId]);
    const session = pending.rows[0];
    if (!session) throw new ProblemError(409, "Nothing to confirm", "The other party has not signed on their device yet.");
    if (session.expires_at.getTime() <= Date.now()) {
      throw new ProblemError(410, "Code expired", "The code expired. Ask the other party to request a new code on their device.");
    }
    if (!equalHex(codeHash(session.id, code), session.code_hash)) {
      const attempts = session.attempts + 1;
      // Commit the failed attempt; the error is raised after the transaction.
      await client.query(
        "UPDATE in_person_sessions SET attempts = $2, status = CASE WHEN $2 >= $3 THEN 'CANCELLED' ELSE status END WHERE id = $1",
        [session.id, attempts, MAX_CODE_ATTEMPTS],
      );
      return { ok: false as const, attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
    }
    const version = await currentVersion(client, agreementId, agreement.current_version_number);
    if (version.id !== session.version_id) {
      await client.query("UPDATE in_person_sessions SET status = 'CANCELLED' WHERE id = $1", [session.id]);
      return { ok: false as const, attemptsLeft: -1 };
    }
    const party = await client.query<{ id: string }>(`
      INSERT INTO parties(agreement_id, role, display_name, invite_channel, invited_at, invite_consumed_at)
      VALUES ($1, 'COUNTERPARTY', $2, 'IN_PERSON', now(), now())
      ON CONFLICT (agreement_id, role) DO UPDATE SET display_name = EXCLUDED.display_name, invite_channel = 'IN_PERSON',
        email_ciphertext = NULL, email_hash = NULL, invite_token_hash = NULL, invite_token_ciphertext = NULL,
        invite_expires_at = NULL, invite_consumed_at = now()
      RETURNING id
    `, [agreementId, session.typed_name]);
    const partyId = party.rows[0]!.id;
    for (const documentId of legal.documentIds) {
      await client.query(`
        INSERT INTO party_consents(party_id, legal_document_id, ip_ciphertext, user_agent_ciphertext)
        VALUES ($1, $2, $3, $4) ON CONFLICT (party_id, legal_document_id) DO NOTHING
      `, [partyId, documentId, session.ip_ciphertext, session.user_agent_ciphertext]);
    }
    const state = await recordSignature(client, {
      agreement, partyId, role: "COUNTERPARTY", typedName: session.typed_name, esignId: legal.esignId,
      evidence: [session.ip_ciphertext, session.user_agent_ciphertext], method: "IN_PERSON_QR", confirmedByPartyId: creator.partyId,
    });
    await client.query(
      "UPDATE in_person_sessions SET status = 'COMPLETED', completed_at = now(), party_id = $2, code_hash = NULL WHERE id = $1",
      [session.id, partyId],
    );
    return { ok: true as const, state };
  });
  if (!outcome.ok) {
    if (outcome.attemptsLeft < 0) throw new ProblemError(409, "Agreement changed", "The agreement changed. Show a new QR code.");
    if (outcome.attemptsLeft <= 0) throw new ProblemError(409, "Too many attempts", "Too many wrong codes. Show a new QR code and start again.");
    throw new ProblemError(422, "Wrong code", `The code does not match. ${outcome.attemptsLeft} attempt(s) left.`);
  }
  return { state: outcome.state };
}

// ---------- Counterparty (token from the QR code, no account) ----------

export interface InPersonContext {
  sessionId: string;
  agreementId: string;
  status: InPersonStatus;
  expiresAt: Date;
  deviceHash: string | null;
  typedName: string | null;
  completedAt: Date | null;
  guestSessionIssuedAt: Date | null;
  partyId: string | null;
  isCurrentVersion: boolean;
  agreementState: AgreementState;
  title: string;
  versionNumber: number;
  documentS3Key: string | null;
  sections: ReturnType<typeof renderAgreement>;
  creatorSignedName: string | null;
}

export async function loadInPersonByToken(token: string): Promise<InPersonContext | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const result = await getPool().query<{
    id: string; agreement_id: string; status: InPersonStatus; expires_at: Date; device_hash: string | null; typed_name: string | null;
    completed_at: Date | null; guest_session_issued_at: Date | null; party_id: string | null; is_current: boolean;
    state: AgreementState; title: string; number: number; document_s3_key: string | null; template_id: TemplateId;
    fields: Record<string, unknown>; creator_name: string | null;
  }>(`
    SELECT s.id, s.agreement_id, s.status, s.expires_at, s.device_hash, s.typed_name, s.completed_at, s.guest_session_issued_at,
      s.party_id, (v.number = a.current_version_number) AS is_current, a.state, v.title, v.number, v.document_s3_key,
      a.template_id, v.fields,
      (SELECT sg.typed_name FROM signatures sg JOIN parties cp ON cp.id = sg.party_id AND cp.role = 'CREATOR' WHERE sg.version_id = v.id) AS creator_name
    FROM in_person_sessions s
    JOIN agreements a ON a.id = s.agreement_id
    JOIN agreement_versions v ON v.id = s.version_id
    WHERE s.token_hash = $1
  `, [hmac(token, "auth")]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessionId: row.id, agreementId: row.agreement_id, status: row.status, expiresAt: row.expires_at, deviceHash: row.device_hash,
    typedName: row.typed_name, completedAt: row.completed_at, guestSessionIssuedAt: row.guest_session_issued_at, partyId: row.party_id,
    isCurrentVersion: row.is_current, agreementState: row.state, title: row.title, versionNumber: row.number,
    documentS3Key: row.document_s3_key, sections: renderAgreement(row.template_id, row.fields), creatorSignedName: row.creator_name,
  };
}

export function deviceMatches(context: InPersonContext, deviceSecret: string | undefined): boolean {
  return !!deviceSecret && !!context.deviceHash && equalHex(deviceHash(deviceSecret), context.deviceHash);
}

export type CounterpartyView =
  | { status: "OPEN"; expiresAt: string }
  | { status: "AWAITING_CONFIRMATION"; expiresAt: string }
  | { status: "COMPLETED"; sealed: boolean; downloadReady: boolean }
  | { status: "UNAVAILABLE" };

/** What the device holding the QR token may see. Other devices only see an open, unclaimed session. */
export function counterpartyView(context: InPersonContext | null, deviceSecret: string | undefined, sealed = false): CounterpartyView {
  if (!context) return { status: "UNAVAILABLE" };
  const own = deviceMatches(context, deviceSecret);
  const live = context.expiresAt.getTime() > Date.now() && context.isCurrentVersion && context.agreementState === "PENDING_SIGNATURES";
  if (context.status === "OPEN" && live) return { status: "OPEN", expiresAt: context.expiresAt.toISOString() };
  if (context.status === "AWAITING_CONFIRMATION" && own && live) return { status: "AWAITING_CONFIRMATION", expiresAt: context.expiresAt.toISOString() };
  if (context.status === "COMPLETED" && own && context.completedAt
      && context.completedAt.getTime() > Date.now() - DOWNLOAD_WINDOW_HOURS * 3_600_000) {
    return { status: "COMPLETED", sealed, downloadReady: sealed && !context.guestSessionIssuedAt };
  }
  return { status: "UNAVAILABLE" };
}

export async function counterpartyStatus(token: string, deviceSecret: string | undefined): Promise<CounterpartyView> {
  const context = await loadInPersonByToken(token);
  const sealed = context?.status === "COMPLETED" ? !!(await finalDocumentFor(context.agreementId)) : false;
  return counterpartyView(context, deviceSecret, sealed);
}

/**
 * The counterparty signs on their own device. Binds the session to that device and returns the code
 * the creator must type. The same device may ask again (new code) while the session is awaiting confirmation.
 */
export async function requestCounterpartySignature(input: {
  token: string; typedName: string; deviceSecret: string; evidence: Evidence;
}): Promise<{ code: string; expiresAt: string }> {
  await requireInPersonLegal();
  const context = await loadInPersonByToken(input.token);
  const view = counterpartyView(context, input.deviceSecret);
  if (!context || (view.status !== "OPEN" && view.status !== "AWAITING_CONFIRMATION")) {
    throw new ProblemError(404, "QR code unavailable", "This QR code is invalid, expired or already used. Ask the other party to show a new one.");
  }
  const evidence = await encryptEvidence(input.evidence);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
  await inTransaction(async (client) => {
    const locked = await client.query<{ status: InPersonStatus; device_hash: string | null; expires_at: Date }>(
      "SELECT status, device_hash, expires_at FROM in_person_sessions WHERE id = $1 FOR UPDATE",
      [context.sessionId],
    );
    const row = locked.rows[0];
    const sameDevice = !!row?.device_hash && equalHex(row.device_hash, deviceHash(input.deviceSecret));
    const claimable = row && row.expires_at.getTime() > Date.now()
      && (row.status === "OPEN" || (row.status === "AWAITING_CONFIRMATION" && sameDevice));
    if (!claimable) throw new ProblemError(404, "QR code unavailable", "This QR code was already used on another device. Ask the other party to show a new one.");
    await client.query(`
      UPDATE in_person_sessions SET status = 'AWAITING_CONFIRMATION', device_hash = $2, typed_name = $3, code_hash = $4,
        expires_at = $5, ip_ciphertext = $6, user_agent_ciphertext = $7, requested_at = now()
      WHERE id = $1
    `, [context.sessionId, deviceHash(input.deviceSecret), input.typedName, codeHash(context.sessionId, code), expiresAt, evidence[0], evidence[1]]);
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

/** One-time: after completion, the signing device gets a short guest session to download the sealed PDF. */
export async function claimDownloadSession(token: string, deviceSecret: string | undefined): Promise<{ token: string; csrf: string; absoluteExpiresAt: Date }> {
  const context = await loadInPersonByToken(token);
  const view = counterpartyView(context, deviceSecret, true);
  if (!context || view.status !== "COMPLETED" || !view.downloadReady || !context.partyId) {
    throw new ProblemError(404, "Not available", "The download is not available on this device.");
  }
  if (!(await finalDocumentFor(context.agreementId))) throw new ProblemError(409, "Not sealed yet", "The sealed record is still being generated.");
  return inTransaction(async (client) => {
    const claimed = await client.query(
      "UPDATE in_person_sessions SET guest_session_issued_at = now() WHERE id = $1 AND guest_session_issued_at IS NULL",
      [context.sessionId],
    );
    if (claimed.rowCount !== 1) throw new ProblemError(404, "Not available", "The download session was already issued.");
    return createGuestSession(client, context.agreementId, context.partyId!);
  });
}
