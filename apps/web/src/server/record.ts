import {
  CONFIRMATION_KINDS, CONFIRMATION_LABELS, OUTCOME_LABELS, confirmationRole, expectedSlots, involvesPayment, kindsForRole, outcome,
  transition, type AgreementState, type ConfirmationKind, type Outcome, type PartyRole, type TemplateId,
} from "@theckards/domain";
import type pg from "pg";
import { writeAudit } from "./admin/audit";
import type { GuestSession } from "./auth/session-store";
import { sha256 } from "./crypto";
import { getPool, inTransaction } from "./db";
import { ProblemError } from "./http/problem";
import { currentApprovedLegal, userHasCurrentConsents } from "./legal";

/**
 * The post-signature record: confirmations, messages, notes and the timeline (S5 part 1).
 * Every read and write is scoped to a party of the agreement. Outcomes are derived, never stored.
 */
const RECORD_STATES: readonly AgreementState[] = ["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"];
const CONFIRMABLE_STATES: readonly AgreementState[] = ["EXECUTED", "IN_CASE"];

export interface Member {
  agreementId: string;
  state: AgreementState;
  templateId: TemplateId;
  dueAt: Date | null;
  versionId: string;
  fields: Record<string, unknown>;
  partyId: string;
  partyRole: "CREATOR" | "COUNTERPARTY";
  parties: { id: string; role: "CREATOR" | "COUNTERPARTY"; name: string }[];
}

export async function member(client: pg.Pool | pg.PoolClient, userId: string, agreementId: string, lock = false): Promise<Member> {
  const result = await client.query<{
    id: string; state: AgreementState; template_id: TemplateId; due_at: Date | null; version_id: string; fields: Record<string, unknown>;
    party_id: string; party_role: "CREATOR" | "COUNTERPARTY";
  }>(`
    SELECT a.id, a.state, a.template_id, a.due_at, v.id AS version_id, v.fields, p.id AS party_id, p.role AS party_role
    FROM agreements a
    JOIN agreement_versions v ON v.agreement_id = a.id AND v.number = a.current_version_number
    JOIN parties p ON p.agreement_id = a.id AND (p.user_id = $2 OR (p.role = 'CREATOR' AND a.creator_id = $2))
    WHERE a.id = $1
    ORDER BY p.role
    LIMIT 1
    ${lock ? "FOR UPDATE OF a" : ""}
  `, [agreementId, userId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
  const parties = await client.query<{ id: string; role: "CREATOR" | "COUNTERPARTY"; name: string }>(`
    SELECT p.id, p.role, COALESCE(s.typed_name, p.display_name) AS name
    FROM parties p LEFT JOIN signatures s ON s.party_id = p.id AND s.version_id = $2
    WHERE p.agreement_id = $1 ORDER BY p.role
  `, [agreementId, row.version_id]);
  return {
    agreementId: row.id, state: row.state, templateId: row.template_id, dueAt: row.due_at, versionId: row.version_id,
    fields: row.fields, partyId: row.party_id, partyRole: row.party_role, parties: parties.rows,
  };
}

export interface ConfirmationSlotView {
  kind: ConfirmationKind;
  label: string;
  role: PartyRole;
  partyName: string;
  mine: boolean;
  declaredAt: string | null;
  note: string | null;
}

export interface TimelineEntry {
  at: string;
  type: "VERSION" | "SIGNATURE" | "SEAL" | "CONFIRMATION" | "MESSAGE" | "NOTE" | "CASE" | "PROPOSAL";
  partyName: string | null;
  mine: boolean;
  text: string;
}

export interface RecordView {
  state: AgreementState;
  myRole: PartyRole;
  canConfirm: boolean;
  canWrite: boolean;
  /** False until Privacy v3 is approved; the panel explains why writing is not yet available. */
  legalReady: boolean;
  outcome: Outcome;
  outcomeLabel: string;
  slots: ConfirmationSlotView[];
  timeline: TimelineEntry[];
}

const nameOf = (m: Member, partyId: string | null) => m.parties.find((p) => p.id === partyId)?.name ?? null;
const roleOf = (m: Member, partyId: string) => {
  const party = m.parties.find((p) => p.id === partyId);
  return party ? confirmationRole(m.templateId, party.role, m.fields) : null;
};

export async function getRecord(userId: string, agreementId: string): Promise<RecordView> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const myRole = confirmationRole(m.templateId, m.partyRole, m.fields);
  const slots = expectedSlots(m.templateId, involvesPayment(m.templateId, m.fields));
  const declared = await pool.query<{ party_id: string; kind: ConfirmationKind; note: string | null; created_at: Date }>(
    "SELECT party_id, kind, note, created_at FROM confirmations WHERE agreement_id = $1 ORDER BY created_at", [agreementId],
  );
  // A confirmation counts only for the slot of the party that is responsible for it.
  const counted = declared.rows
    .map((row) => ({ ...row, role: roleOf(m, row.party_id) }))
    .filter((row): row is typeof row & { role: PartyRole } => row.role !== null);
  const result = outcome(slots, counted.map((row) => ({ kind: row.kind, role: row.role })), m.dueAt, new Date());
  const partyForRole = (role: PartyRole) => m.parties.find((p) => confirmationRole(m.templateId, p.role, m.fields) === role);

  const slotViews: ConfirmationSlotView[] = slots.map((slot) => {
    const hit = counted.find((row) => row.kind === slot.kind && row.role === slot.role);
    const party = partyForRole(slot.role);
    return {
      kind: slot.kind, label: CONFIRMATION_LABELS[slot.kind], role: slot.role, partyName: party?.name ?? "The other party",
      mine: slot.role === myRole, declaredAt: hit?.created_at.toISOString() ?? null, note: hit?.note ?? null,
    };
  });

  const events = await pool.query<{ at: Date; type: TimelineEntry["type"]; party_id: string | null; text: string }>(`
    SELECT created_at AS at, 'VERSION' AS type, NULL::uuid AS party_id, 'Version ' || number || ' created' AS text
      FROM agreement_versions WHERE agreement_id = $1
    UNION ALL SELECT signed_at, 'SIGNATURE', party_id, 'Signed as ' || typed_name FROM signatures WHERE agreement_id = $1
    UNION ALL SELECT sealed_at, 'SEAL', NULL, initcap(lower(kind)) || ' record sealed · seal ' || id FROM sealed_documents WHERE agreement_id = $1
    UNION ALL SELECT created_at, 'CONFIRMATION', party_id, kind || COALESCE(' — ' || note, '') FROM confirmations WHERE agreement_id = $1
    UNION ALL SELECT created_at, 'MESSAGE', party_id, body FROM messages WHERE agreement_id = $1
    UNION ALL SELECT created_at, 'NOTE', party_id, body FROM record_notes WHERE agreement_id = $1
    UNION ALL SELECT opened_at, 'CASE', opened_by_party_id, 'Case opened: ' || reason FROM cases WHERE agreement_id = $1
    UNION ALL SELECT closed_at, 'CASE', closed_by_party_id, CASE status WHEN 'WITHDRAWN' THEN 'Case withdrawn' ELSE 'Case resolved by a sealed addendum signed by both parties' END
      FROM cases WHERE agreement_id = $1 AND closed_at IS NOT NULL
    UNION ALL SELECT created_at, 'PROPOSAL', party_id, 'Proposal: ' || body FROM proposals WHERE agreement_id = $1
    UNION ALL SELECT pa.created_at, 'PROPOSAL', pa.party_id, 'Accepted the other party''s proposal' FROM proposal_acceptances pa JOIN proposals p ON p.id = pa.proposal_id WHERE p.agreement_id = $1
    UNION ALL SELECT s.signed_at, 'SIGNATURE', s.party_id, 'Signed the resolution addendum as ' || s.typed_name FROM addendum_signatures s JOIN addenda d ON d.id = s.addendum_id WHERE d.agreement_id = $1
    ORDER BY at DESC LIMIT 300
  `, [agreementId]);
  const timeline = events.rows.map((row) => ({
    at: row.at.toISOString(), type: row.type, partyName: nameOf(m, row.party_id), mine: row.party_id === m.partyId,
    text: row.type === "CONFIRMATION"
      ? row.text.replace(/^([A-Z_]+)/, (kind) => `Declared: ${CONFIRMATION_LABELS[kind as ConfirmationKind] ?? kind}`)
      : row.text,
  }));
  const legalReady = await recordLegalReady();
  return {
    state: m.state, myRole, legalReady,
    canConfirm: legalReady && CONFIRMABLE_STATES.includes(m.state), canWrite: legalReady && RECORD_STATES.includes(m.state),
    outcome: result, outcomeLabel: OUTCOME_LABELS[result], slots: slotViews, timeline,
  };
}

/** Privacy v3 is the first version that discloses confirmations, messages and notes. */
export const RECORD_MIN_PRIVACY_VERSION = 3;

async function recordLegalReady(): Promise<boolean> {
  const privacy = (await currentApprovedLegal()).find((document) => document.documentType === "PRIVACY");
  return (privacy?.version ?? 0) >= RECORD_MIN_PRIVACY_VERSION;
}

async function requireConsent(userId: string): Promise<void> {
  if (!(await recordLegalReady())) {
    throw new ProblemError(503, "Record unavailable", "Confirmations, messages and notes open after the updated Privacy Policy (version 3) is approved.");
  }
  if (!(await userHasCurrentConsents(userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents first.");
}

export async function addConfirmation(input: { userId: string; agreementId: string; kind: ConfirmationKind; note?: string }): Promise<{ state: AgreementState }> {
  if (!CONFIRMATION_KINDS.includes(input.kind)) throw new ProblemError(422, "Validation Failed", "Unknown confirmation.");
  await requireConsent(input.userId);
  return inTransaction(async (client) => {
    const m = await member(client, input.userId, input.agreementId, true);
    if (!CONFIRMABLE_STATES.includes(m.state)) throw new ProblemError(409, "Invalid state", "Confirmations are recorded after both parties sign.");
    const role = confirmationRole(m.templateId, m.partyRole, m.fields);
    const slots = expectedSlots(m.templateId, involvesPayment(m.templateId, m.fields));
    if (!kindsForRole(slots, role).includes(input.kind)) {
      throw new ProblemError(403, "Not your confirmation", "Only the responsible party can declare this confirmation.");
    }
    const inserted = await client.query(`
      INSERT INTO confirmations(agreement_id, version_id, party_id, kind, note) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agreement_id, party_id, kind) DO NOTHING
    `, [m.agreementId, m.versionId, m.partyId, input.kind, input.note?.trim() || null]);
    if (inserted.rowCount !== 1) return { state: m.state };
    const all = await client.query<{ party_id: string; kind: ConfirmationKind }>("SELECT party_id, kind FROM confirmations WHERE agreement_id = $1", [m.agreementId]);
    const counted = all.rows.flatMap((row) => {
      const r = roleOf(m, row.party_id);
      return r ? [{ kind: row.kind, role: r }] : [];
    });
    let state = m.state;
    if (state === "EXECUTED" && outcome(slots, counted, m.dueAt, new Date()) === "MUTUAL") {
      state = transition(state, "COMPLETED");
      await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [m.agreementId, state]);
    }
    return { state };
  });
}

async function appendText(table: "messages" | "record_notes", input: { userId: string; agreementId: string; body: string; idempotencyKey: string }): Promise<{ id: string }> {
  await requireConsent(input.userId);
  return inTransaction(async (client) => {
    const m = await member(client, input.userId, input.agreementId, true);
    if (!RECORD_STATES.includes(m.state)) throw new ProblemError(409, "Invalid state", "Messages and notes are available after both parties sign.");
    const key = sha256(`${table}:${input.idempotencyKey}`);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO ${table}(agreement_id, party_id, body, client_key) VALUES ($1, $2, $3, $4)
      ON CONFLICT (party_id, client_key) DO NOTHING RETURNING id
    `, [m.agreementId, m.partyId, input.body.trim(), key]);
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE party_id = $1 AND client_key = $2`, [m.partyId, key]);
    return existing.rows[0]!;
  });
}

export const addMessage = (input: Parameters<typeof appendText>[1]) => appendText("messages", input);
export const addNote = (input: Parameters<typeof appendText>[1]) => appendText("record_notes", input);

// ---------- Counterparty account link ----------

export async function claimPreview(userId: string, guest: GuestSession): Promise<{ agreementId: string; title: string; status: "AVAILABLE" | "LINKED" | "CREATOR" | "TAKEN" }> {
  const result = await getPool().query<{ title: string; creator_id: string; user_id: string | null }>(`
    SELECT a.title, a.creator_id, p.user_id FROM parties p JOIN agreements a ON a.id = p.agreement_id
    WHERE p.id = $1 AND p.agreement_id = $2 AND p.role = 'COUNTERPARTY'
  `, [guest.partyId, guest.agreementId]);
  const row = result.rows[0];
  if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
  const status = row.creator_id === userId ? "CREATOR" : row.user_id === userId ? "LINKED" : row.user_id ? "TAKEN" : "AVAILABLE";
  return { agreementId: guest.agreementId, title: row.title, status };
}

/** Links the counterparty party (proven by the bound-device guest session) to the signed-in account. */
export async function claimParty(userId: string, guest: GuestSession, requestId: string): Promise<{ agreementId: string }> {
  return inTransaction(async (client) => {
    const result = await client.query<{ creator_id: string; user_id: string | null }>(`
      SELECT a.creator_id, p.user_id FROM parties p JOIN agreements a ON a.id = p.agreement_id
      WHERE p.id = $1 AND p.agreement_id = $2 AND p.role = 'COUNTERPARTY' FOR UPDATE OF p
    `, [guest.partyId, guest.agreementId]);
    const row = result.rows[0];
    if (!row) throw new ProblemError(404, "Not Found", "Agreement not found.");
    if (row.creator_id === userId) throw new ProblemError(409, "Same account", "The creator's account cannot also be the counterparty.");
    if (row.user_id && row.user_id !== userId) throw new ProblemError(409, "Already linked", "This agreement is already linked to another account.");
    if (!row.user_id) {
      await client.query("UPDATE parties SET user_id = $2 WHERE id = $1 AND user_id IS NULL", [guest.partyId, userId]);
      await writeAudit(client, { actorType: "USER", actorId: userId, action: "PARTY_ACCOUNT_LINKED", entityType: "party", entityId: guest.partyId, requestId, after: { agreementId: guest.agreementId } });
    }
    return { agreementId: guest.agreementId };
  });
}
