import { canonicalJson, renderAgreement, transition, validateTemplateFields, type AgreementState, type TemplateId } from "@theckards/domain";
import type pg from "pg";
import { decryptText, encryptText, hmac, randomToken, sha256 } from "./crypto";
import { getPool, inTransaction } from "./db";
import { env } from "./env";
import { ProblemError } from "./http/problem";
import { userHasCurrentConsents } from "./legal";
import { requireEmailDelivery } from "./signing";

const CANCEL_OPEN_IN_PERSON = "UPDATE in_person_sessions SET status = 'CANCELLED' WHERE agreement_id = $1 AND status IN ('OPEN', 'AWAITING_CONFIRMATION')";

export interface AgreementRecord {
  id: string;
  title: string;
  templateId: TemplateId;
  state: AgreementState;
  lockVersion: number;
  currentVersionNumber: number;
  dueAt: string | null;
  renderStatus: "PENDING" | "READY" | "FAILED";
  documentSha256: string | null;
  fields: Record<string, unknown>;
  sections: ReturnType<typeof renderAgreement>;
  inviteExpiresAt: string | null;
  counterpartyName: string | null;
  creatorSignedName: string | null;
  creatorSignedAt: string | null;
  counterpartySignedName: string | null;
  counterpartySignedAt: string | null;
  finalSealId: string | null;
  finalSha256: string | null;
  createdAt: string;
  updatedAt: string;
}

const AGREEMENT_SELECT = `
  SELECT a.id, a.title, a.template_id, a.state, a.lock_version, a.current_version_number,
         a.due_at, a.created_at, a.updated_at, v.render_status, v.document_sha256, v.fields,
         cp.invite_expires_at, cp.display_name AS counterparty_name,
         cs.typed_name AS creator_signed_name, cs.signed_at AS creator_signed_at,
         ps.typed_name AS counterparty_signed_name, ps.signed_at AS counterparty_signed_at,
         fd.id AS final_seal_id, fd.sha256 AS final_sha256
  FROM agreements a
  JOIN agreement_versions v ON v.agreement_id = a.id AND v.number = a.current_version_number
  LEFT JOIN parties cr ON cr.agreement_id = a.id AND cr.role = 'CREATOR'
  LEFT JOIN parties cp ON cp.agreement_id = a.id AND cp.role = 'COUNTERPARTY'
  LEFT JOIN signatures cs ON cs.version_id = v.id AND cs.party_id = cr.id
  LEFT JOIN signatures ps ON ps.version_id = v.id AND ps.party_id = cp.id
  LEFT JOIN sealed_documents fd ON fd.version_id = v.id AND fd.kind = 'FINAL'
`;

interface AgreementRow {
  id: string;
  title: string;
  template_id: TemplateId;
  state: AgreementState;
  lock_version: number;
  current_version_number: number;
  due_at: Date | null;
  render_status: AgreementRecord["renderStatus"];
  document_sha256: string | null;
  fields: Record<string, unknown>;
  invite_expires_at: Date | null;
  counterparty_name: string | null;
  creator_signed_name: string | null;
  creator_signed_at: Date | null;
  counterparty_signed_name: string | null;
  counterparty_signed_at: Date | null;
  final_seal_id: string | null;
  final_sha256: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapAgreement(row: AgreementRow): AgreementRecord {
  return {
    id: row.id, title: row.title, templateId: row.template_id, state: row.state,
    lockVersion: row.lock_version, currentVersionNumber: row.current_version_number,
    dueAt: row.due_at?.toISOString() ?? null, renderStatus: row.render_status,
    documentSha256: row.document_sha256, fields: row.fields,
    sections: renderAgreement(row.template_id, row.fields),
    inviteExpiresAt: row.invite_expires_at?.toISOString() ?? null,
    counterpartyName: row.counterparty_name,
    creatorSignedName: row.creator_signed_name, creatorSignedAt: row.creator_signed_at?.toISOString() ?? null,
    counterpartySignedName: row.counterparty_signed_name, counterpartySignedAt: row.counterparty_signed_at?.toISOString() ?? null,
    finalSealId: row.final_seal_id, finalSha256: row.final_sha256,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

function validFields(templateId: TemplateId, fields: unknown): Record<string, unknown> {
  try {
    return validateTemplateFields(templateId, fields) as Record<string, unknown>;
  } catch {
    throw new ProblemError(422, "Validation Failed", "The template fields are invalid.");
  }
}

function contentHash(templateId: TemplateId, version: number, title: string, fields: unknown): string {
  return sha256(canonicalJson({ templateId, templateVersion: version, title, fields }));
}

function derivedDueAt(templateId: TemplateId, fields: Record<string, unknown>, explicit?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  const date = templateId === "purchase_sale" ? fields.deliveryDate
    : templateId === "services" ? fields.completionDate
      : fields.dueDate;
  return typeof date === "string" && date ? `${date}T23:59:59.000Z` : null;
}

async function requireLegal(userId: string): Promise<void> {
  if (!(await userHasCurrentConsents(userId))) {
    throw new ProblemError(403, "Legal consent required", "Accept the current legal documents before creating or changing an agreement.");
  }
}

export async function listAgreements(userId: string): Promise<AgreementRecord[]> {
  const result = await getPool().query<AgreementRow>(`${AGREEMENT_SELECT}
    WHERE a.creator_id = $1 OR EXISTS (
      SELECT 1 FROM parties p WHERE p.agreement_id = a.id AND p.user_id = $1
    )
    ORDER BY a.updated_at DESC
  `, [userId]);
  return result.rows.map(mapAgreement);
}

export async function getAgreement(userId: string, agreementId: string): Promise<AgreementRecord> {
  const result = await getPool().query<AgreementRow>(`${AGREEMENT_SELECT}
    WHERE a.id = $1 AND (a.creator_id = $2 OR EXISTS (
      SELECT 1 FROM parties p WHERE p.agreement_id = a.id AND p.user_id = $2
    ))
  `, [agreementId, userId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
  return mapAgreement(row);
}

async function enforceFreeQuota(client: pg.PoolClient, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('agreement-quota:' || $1))", [userId]);
  const quota = await client.query<{ limit_value: string; used: string }>(`
    SELECT COALESCE((SELECT value #>> '{free,monthlyAgreements}' FROM app_settings WHERE key = 'plans_limits'), '2') AS limit_value,
      (SELECT count(*)::text FROM agreements WHERE creator_id = $1 AND created_at >= date_trunc('month', now())) AS used
  `, [userId]);
  const usage = quota.rows[0];
  if (Number(usage?.used ?? 0) >= Number(usage?.limit_value ?? 2)) {
    throw new ProblemError(402, "Free quota reached", "The monthly free agreement quota has been reached.");
  }
}

export async function createAgreement(input: {
  userId: string;
  templateId: TemplateId;
  title: string;
  fields: unknown;
  dueAt?: string | null;
}): Promise<AgreementRecord> {
  await requireLegal(input.userId);
  const fields = validFields(input.templateId, input.fields);
  const hash = contentHash(input.templateId, 1, input.title, fields);
  const id = await inTransaction(async (client: pg.PoolClient) => {
    await enforceFreeQuota(client, input.userId);
    const agreement = await client.query<{ id: string }>(`
      INSERT INTO agreements(creator_id, template_id, template_version, title, due_at)
      VALUES ($1, $2, 1, $3, $4) RETURNING id
    `, [input.userId, input.templateId, input.title, derivedDueAt(input.templateId, fields, input.dueAt)]);
    const agreementId = agreement.rows[0]!.id;
    const version = await client.query<{ id: string }>(`
      INSERT INTO agreement_versions(agreement_id, number, title, fields, content_sha256, created_by)
      VALUES ($1, 1, $2, $3::jsonb, $4, $5) RETURNING id
    `, [agreementId, input.title, JSON.stringify(fields), hash, input.userId]);
    await client.query("INSERT INTO parties(agreement_id, role, user_id, display_name) VALUES ($1, 'CREATOR', $2, 'Creator')", [agreementId, input.userId]);
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('pdf.render', $1::jsonb)", [JSON.stringify({ agreementId, versionId: version.rows[0]!.id })]);
    return agreementId;
  });
  return getAgreement(input.userId, id);
}

async function lockOwnedAgreement(client: pg.PoolClient, userId: string, agreementId: string): Promise<{ template_id: TemplateId; state: AgreementState; lock_version: number; current_version_number: number }> {
  const result = await client.query<{ template_id: TemplateId; state: AgreementState; lock_version: number; current_version_number: number }>(
    "SELECT template_id, state, lock_version, current_version_number FROM agreements WHERE id = $1 AND creator_id = $2 FOR UPDATE",
    [agreementId, userId],
  );
  const agreement = result.rows[0];
  if (!agreement) throw new ProblemError(404, "Not Found", "Agreement not found.");
  return agreement;
}

export async function updateAgreement(input: {
  userId: string; agreementId: string; expectedLockVersion: number; title: string; fields: unknown; dueAt?: string | null;
}): Promise<AgreementRecord> {
  await requireLegal(input.userId);
  await inTransaction(async (client) => {
    const current = await lockOwnedAgreement(client, input.userId, input.agreementId);
    if (current.lock_version !== input.expectedLockVersion) throw new ProblemError(412, "Precondition Failed", "The agreement changed. Reload and try again.");
    if (!(["DRAFT", "PENDING_SIGNATURES", "REVISION_REQUESTED"] as AgreementState[]).includes(current.state)) {
      throw new ProblemError(409, "Invalid state", "This agreement can no longer be edited.");
    }
    const fields = validFields(current.template_id, input.fields);
    const number = current.current_version_number + 1;
    const hash = contentHash(current.template_id, 1, input.title, fields);
    const version = await client.query<{ id: string }>(`
      INSERT INTO agreement_versions(agreement_id, number, title, fields, content_sha256, created_by)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id
    `, [input.agreementId, number, input.title, JSON.stringify(fields), hash, input.userId]);
    let state: AgreementState = current.state;
    if (state === "PENDING_SIGNATURES") state = transition(transition(state, "REVISION_REQUESTED"), "DRAFT");
    if (state === "REVISION_REQUESTED") state = transition(state, "DRAFT");
    await client.query(`
      UPDATE agreements SET title = $2, due_at = $3, state = $4, current_version_number = $5,
        lock_version = lock_version + 1, updated_at = now() WHERE id = $1
    `, [input.agreementId, input.title, derivedDueAt(current.template_id, fields, input.dueAt), state, number]);
    await client.query("UPDATE parties SET invite_token_hash = NULL, invite_expires_at = NULL WHERE agreement_id = $1 AND role = 'COUNTERPARTY'", [input.agreementId]);
    await client.query(CANCEL_OPEN_IN_PERSON, [input.agreementId]);
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('pdf.render', $1::jsonb)", [JSON.stringify({ agreementId: input.agreementId, versionId: version.rows[0]!.id })]);
  });
  return getAgreement(input.userId, input.agreementId);
}

/**
 * Invites the counterparty. With an email the link is sent by email; without one (in-person / QR) the
 * counterparty enters their own email on the signing page. Either way the creator can show the link as a QR code.
 */
export async function inviteCounterparty(input: {
  userId: string; agreementId: string; expectedLockVersion: number; email?: string; displayName: string;
}): Promise<{ agreement: AgreementRecord; inviteExpiresAt: string }> {
  await requireEmailDelivery();
  await requireLegal(input.userId);
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const creator = await getPool().query<{ email_hash: string }>("SELECT email_hash FROM users WHERE id = $1", [input.userId]);
    if (creator.rows[0]?.email_hash === hmac(email, "email")) throw new ProblemError(422, "Invalid counterparty", "The counterparty must use a different email address.");
  }
  const emailCiphertext = email ? await encryptText(email, "guest-email") : null;
  const token = randomToken();
  const encryptedToken = await encryptText(token, "invite-token");
  const authSetting = await getPool().query<{ days: string }>("SELECT value->>'inviteValidityDays' AS days FROM app_settings WHERE key = 'auth'");
  const validityDays = Math.min(30, Math.max(1, Number(authSetting.rows[0]?.days ?? 7)));
  const inviteExpiresAt = new Date(Date.now() + validityDays * 86_400_000);
  await inTransaction(async (client) => {
    const current = await lockOwnedAgreement(client, input.userId, input.agreementId);
    if (current.lock_version !== input.expectedLockVersion) throw new ProblemError(412, "Precondition Failed", "The agreement changed. Reload and try again.");
    if (current.state !== "DRAFT") throw new ProblemError(409, "Invalid state", "Only a draft can be sent for signature.");
    const version = await client.query<{ id: string; render_status: string }>(
      "SELECT id, render_status FROM agreement_versions WHERE agreement_id = $1 AND number = $2",
      [input.agreementId, current.current_version_number],
    );
    if (version.rows[0]?.render_status !== "READY") throw new ProblemError(409, "Preview pending", "Wait for the preview before inviting the counterparty.");
    const party = await client.query<{ id: string }>(`
      INSERT INTO parties(agreement_id, role, display_name, email_ciphertext, email_hash, invite_token_hash, invite_token_ciphertext,
        invite_channel, invite_expires_at, invited_at)
      VALUES ($1, 'COUNTERPARTY', $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (agreement_id, role) DO UPDATE SET display_name = EXCLUDED.display_name,
        email_ciphertext = EXCLUDED.email_ciphertext, email_hash = EXCLUDED.email_hash,
        invite_token_hash = EXCLUDED.invite_token_hash, invite_token_ciphertext = EXCLUDED.invite_token_ciphertext,
        invite_channel = EXCLUDED.invite_channel, invite_expires_at = EXCLUDED.invite_expires_at, invited_at = now(),
        invite_consumed_at = NULL
      RETURNING id
    `, [input.agreementId, input.displayName, emailCiphertext, email ? hmac(email, "email") : null, hmac(token, "auth"),
        encryptedToken, email ? "EMAIL" : "LINK", inviteExpiresAt]);
    await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [input.agreementId, transition(current.state, "PENDING_SIGNATURES")]);
    if (email) {
      await client.query("INSERT INTO outbox(topic, payload) VALUES ('email.invite', $1::jsonb)", [JSON.stringify({ agreementId: input.agreementId, partyId: party.rows[0]!.id, tokenCiphertext: encryptedToken.toString("base64") })]);
    }
  });
  return { agreement: await getAgreement(input.userId, input.agreementId), inviteExpiresAt: inviteExpiresAt.toISOString() };
}

export async function cancelAgreement(userId: string, agreementId: string, expectedLockVersion: number): Promise<AgreementRecord> {
  await inTransaction(async (client) => {
    const current = await lockOwnedAgreement(client, userId, agreementId);
    if (current.lock_version !== expectedLockVersion) throw new ProblemError(412, "Precondition Failed", "The agreement changed. Reload and try again.");
    const next = transition(current.state, "CANCELLED");
    await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [agreementId, next]);
    await client.query(CANCEL_OPEN_IN_PERSON, [agreementId]);
  });
  return getAgreement(userId, agreementId);
}

export async function addMilestone(input: { userId: string; agreementId: string; expectedLockVersion: number; title: string; dueAt: string }): Promise<{ id: string }> {
  return inTransaction(async (client) => {
    const current = await lockOwnedAgreement(client, input.userId, input.agreementId);
    if (current.lock_version !== input.expectedLockVersion) throw new ProblemError(412, "Precondition Failed", "The agreement changed. Reload and try again.");
    if (!(["DRAFT", "PENDING_SIGNATURES", "EXECUTED"] as AgreementState[]).includes(current.state)) throw new ProblemError(409, "Invalid state", "Milestones cannot be added in this state.");
    const result = await client.query<{ id: string }>("INSERT INTO milestones(agreement_id, title, due_at) VALUES ($1, $2, $3) RETURNING id", [input.agreementId, input.title, input.dueAt]);
    await client.query("UPDATE agreements SET lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [input.agreementId]);
    return result.rows[0]!;
  });
}

export async function previewObject(userId: string, agreementId: string): Promise<{ key: string; sha256: string }> {
  await getAgreement(userId, agreementId);
  const result = await getPool().query<{ document_s3_key: string; document_sha256: string }>(`
    SELECT v.document_s3_key, v.document_sha256 FROM agreement_versions v
    JOIN agreements a ON a.id = v.agreement_id AND a.current_version_number = v.number
    WHERE a.id = $1 AND v.render_status = 'READY'
  `, [agreementId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(409, "Preview pending", "The preview is not ready yet.");
  return { key: row.document_s3_key, sha256: row.document_sha256 };
}

/** Returns the live invitation link for the creator to show as a QR code or copy. Only while it is usable. */
export async function invitationLink(userId: string, agreementId: string): Promise<{ url: string; expiresAt: string; channel: "EMAIL" | "LINK" }> {
  await requireEmailDelivery();
  const result = await getPool().query<{ invite_token_ciphertext: Uint8Array | null; invite_expires_at: Date | null; invite_consumed_at: Date | null; invite_channel: "EMAIL" | "LINK"; state: AgreementState }>(`
    SELECT p.invite_token_ciphertext, p.invite_expires_at, p.invite_consumed_at, p.invite_channel, a.state
    FROM agreements a JOIN parties p ON p.agreement_id = a.id AND p.role = 'COUNTERPARTY'
    WHERE a.id = $1 AND a.creator_id = $2
  `, [agreementId, userId]);
  const row = result.rows[0];
  if (!row || !row.invite_token_ciphertext || row.invite_consumed_at || row.state !== "PENDING_SIGNATURES"
      || !row.invite_expires_at || row.invite_expires_at.getTime() <= Date.now()) {
    throw new ProblemError(404, "No active invitation", "There is no active invitation for this agreement.");
  }
  const token = await decryptText(row.invite_token_ciphertext, "invite-token");
  return { url: `${env().APP_BASE_URL}/g/${encodeURIComponent(token)}`, expiresAt: row.invite_expires_at.toISOString(), channel: row.invite_channel };
}
