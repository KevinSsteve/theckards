import {
  CASE_EVIDENCE_WINDOW_DAYS, canonicalJson, confirmationRole, renderAddendum, transition,
  type AgreementSection, type AgreementState,
} from "@theckards/domain";
import type pg from "pg";
import { sha256 } from "./crypto";
import { getPool, inTransaction } from "./db";
import { ProblemError } from "./http/problem";
import { currentApprovedLegal, userHasCurrentConsents } from "./legal";
import { member, type Member } from "./record";
import { encryptEvidence, type Evidence } from "./signing";

/**
 * Cases (S5 part 2). Theckards never decides a case (G2): it records the reason, each party's proposals,
 * and — only if the other party accepts a proposal and both sign — a sealed resolution addendum.
 */
export const CASE_MIN_PRIVACY_VERSION = 4;
export const CASE_MIN_ESIGN_VERSION = 3;

async function caseLegal(): Promise<{ ready: boolean; esignId: string | null }> {
  const documents = await currentApprovedLegal();
  const privacy = documents.find((d) => d.documentType === "PRIVACY");
  const esign = documents.find((d) => d.documentType === "ESIGN");
  const ready = (privacy?.version ?? 0) >= CASE_MIN_PRIVACY_VERSION && (esign?.version ?? 0) >= CASE_MIN_ESIGN_VERSION;
  return { ready, esignId: esign?.id ?? null };
}

async function requireCaseLegal(userId: string): Promise<string> {
  const legal = await caseLegal();
  if (!legal.ready || !legal.esignId) {
    throw new ProblemError(503, "Cases unavailable", "Cases open after the updated Privacy Policy (version 4) and ESIGN consent (version 3) are approved.");
  }
  if (!(await userHasCurrentConsents(userId))) throw new ProblemError(403, "Legal consent required", "Accept the current legal documents first.");
  return legal.esignId;
}

interface CaseRow {
  id: string; opened_by_party_id: string; reason: string; status: "OPEN" | "WITHDRAWN" | "RESOLVED";
  evidence_window_ends_at: Date; opened_at: Date; closed_at: Date | null; closed_by_party_id: string | null;
}

async function latestCase(client: pg.Pool | pg.PoolClient, agreementId: string, lock = false): Promise<CaseRow | null> {
  const result = await client.query<CaseRow>(
    `SELECT id, opened_by_party_id, reason, status, evidence_window_ends_at, opened_at, closed_at, closed_by_party_id
     FROM cases WHERE agreement_id = $1 ORDER BY opened_at DESC LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [agreementId],
  );
  return result.rows[0] ?? null;
}

interface AddendumRow {
  id: string; proposal_id: string; status: "AWAITING_SIGNATURES" | "SEALED" | "CANCELLED"; render_status: string;
  document_sha256: string | null; sealed_document_id: string | null; sections: AgreementSection[];
}

async function addendumFor(client: pg.Pool | pg.PoolClient, caseId: string, lock = false): Promise<AddendumRow | null> {
  const result = await client.query<AddendumRow>(
    `SELECT id, proposal_id, status, render_status, document_sha256, sealed_document_id, sections FROM addenda WHERE case_id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [caseId],
  );
  return result.rows[0] ?? null;
}

const nameOf = (m: Member, partyId: string | null) => m.parties.find((p) => p.id === partyId)?.name ?? "A party";
const roleLabel = (m: Member, partyId: string) => {
  const party = m.parties.find((p) => p.id === partyId);
  if (!party) return "party";
  const role = confirmationRole(m.templateId, party.role, m.fields);
  return role.charAt(0) + role.slice(1).toLowerCase();
};

export interface CaseView {
  legalReady: boolean;
  agreementState: AgreementState;
  canOpen: boolean;
  case: null | {
    id: string; status: CaseRow["status"]; reason: string; openedBy: string; openedByMe: boolean; openedAt: string;
    evidenceWindowEndsAt: string; closedAt: string | null;
    canPropose: boolean; canWithdraw: boolean;
    proposals: { id: string; author: string; mine: boolean; body: string; createdAt: string; current: boolean; accepted: boolean; canAccept: boolean }[];
    addendum: null | {
      status: AddendumRow["status"]; renderStatus: string; sections: AgreementSection[];
      signatures: { name: string; mine: boolean; signedAt: string }[]; canSign: boolean; sealedDocumentId: string | null;
    };
  };
}

export async function getCase(userId: string, agreementId: string): Promise<CaseView> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const legal = await caseLegal();
  const row = await latestCase(pool, agreementId);
  const base = { legalReady: legal.ready, agreementState: m.state, canOpen: legal.ready && m.state === "EXECUTED" };
  if (!row) return { ...base, case: null };
  const proposals = await pool.query<{ id: string; party_id: string; body: string; created_at: Date; accepted: boolean }>(`
    SELECT p.id, p.party_id, p.body, p.created_at, (a.proposal_id IS NOT NULL) AS accepted
    FROM proposals p LEFT JOIN proposal_acceptances a ON a.proposal_id = p.id
    WHERE p.case_id = $1 ORDER BY p.created_at DESC
  `, [row.id]);
  const latestByParty = new Map<string, string>();
  for (const p of proposals.rows) if (!latestByParty.has(p.party_id)) latestByParty.set(p.party_id, p.id);
  const addendum = await addendumFor(pool, row.id);
  const signatures = addendum
    ? (await pool.query<{ party_id: string; signed_at: Date }>("SELECT party_id, signed_at FROM addendum_signatures WHERE addendum_id = $1 ORDER BY signed_at", [addendum.id])).rows
    : [];
  const open = row.status === "OPEN";
  const fullySigned = signatures.length >= 2;
  return {
    ...base,
    case: {
      id: row.id, status: row.status, reason: row.reason, openedBy: nameOf(m, row.opened_by_party_id), openedByMe: row.opened_by_party_id === m.partyId,
      openedAt: row.opened_at.toISOString(), evidenceWindowEndsAt: row.evidence_window_ends_at.toISOString(), closedAt: row.closed_at?.toISOString() ?? null,
      canPropose: legal.ready && open && !addendum,
      canWithdraw: legal.ready && open && row.opened_by_party_id === m.partyId && !fullySigned,
      proposals: proposals.rows.map((p) => {
        const current = latestByParty.get(p.party_id) === p.id;
        return {
          id: p.id, author: nameOf(m, p.party_id), mine: p.party_id === m.partyId, body: p.body, createdAt: p.created_at.toISOString(),
          current, accepted: p.accepted, canAccept: legal.ready && open && !addendum && current && p.party_id !== m.partyId,
        };
      }),
      addendum: addendum && {
        status: addendum.status, renderStatus: addendum.render_status, sections: addendum.sections,
        signatures: signatures.map((s) => ({ name: nameOf(m, s.party_id), mine: s.party_id === m.partyId, signedAt: s.signed_at.toISOString() })),
        canSign: legal.ready && open && addendum.status === "AWAITING_SIGNATURES" && addendum.render_status === "READY" && !signatures.some((s) => s.party_id === m.partyId),
        sealedDocumentId: addendum.sealed_document_id,
      },
    },
  };
}

export async function openCase(input: { userId: string; agreementId: string; reason: string }): Promise<{ state: AgreementState }> {
  await requireCaseLegal(input.userId);
  return inTransaction(async (client) => {
    const m = await member(client, input.userId, input.agreementId, true);
    if (m.state !== "EXECUTED") throw new ProblemError(409, "Invalid state", "A case can be opened only on a signed agreement that is not completed.");
    const state = transition(m.state, "IN_CASE");
    await client.query(`
      INSERT INTO cases(agreement_id, opened_by_party_id, reason, evidence_window_ends_at)
      VALUES ($1, $2, $3, now() + ($4::int * interval '1 day'))
    `, [m.agreementId, m.partyId, input.reason.trim(), CASE_EVIDENCE_WINDOW_DAYS]);
    await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [m.agreementId, state]);
    return { state };
  });
}

async function openCaseFor(client: pg.PoolClient, userId: string, agreementId: string): Promise<{ m: Member; row: CaseRow }> {
  const m = await member(client, userId, agreementId, true);
  const row = await latestCase(client, agreementId, true);
  if (!row || row.status !== "OPEN" || m.state !== "IN_CASE") throw new ProblemError(409, "No open case", "There is no open case on this agreement.");
  return { m, row };
}

export async function addProposal(input: { userId: string; agreementId: string; body: string; idempotencyKey: string }): Promise<{ id: string }> {
  await requireCaseLegal(input.userId);
  return inTransaction(async (client) => {
    const { m, row } = await openCaseFor(client, input.userId, input.agreementId);
    if (await addendumFor(client, row.id)) throw new ProblemError(409, "Proposal accepted", "A proposal was already accepted; sign or withdraw the addendum instead.");
    const key = sha256(`proposal:${input.idempotencyKey}`);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO proposals(case_id, agreement_id, party_id, body, client_key) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (party_id, client_key) DO NOTHING RETURNING id
    `, [row.id, m.agreementId, m.partyId, input.body.trim(), key]);
    if (inserted.rows[0]) return inserted.rows[0];
    return (await client.query<{ id: string }>("SELECT id FROM proposals WHERE party_id = $1 AND client_key = $2", [m.partyId, key])).rows[0]!;
  });
}

/** The other party accepts the author's current proposal. This is the only way an addendum comes to exist. */
export async function acceptProposal(input: { userId: string; agreementId: string; proposalId: string }): Promise<{ addendumId: string }> {
  await requireCaseLegal(input.userId);
  return inTransaction(async (client) => {
    const { m, row } = await openCaseFor(client, input.userId, input.agreementId);
    if (await addendumFor(client, row.id)) throw new ProblemError(409, "Proposal accepted", "A proposal was already accepted in this case.");
    const proposal = (await client.query<{ id: string; party_id: string; body: string; created_at: Date }>(
      "SELECT id, party_id, body, created_at FROM proposals WHERE id = $1 AND case_id = $2", [input.proposalId, row.id],
    )).rows[0];
    if (!proposal) throw new ProblemError(404, "Not Found", "Proposal not found.");
    if (proposal.party_id === m.partyId) throw new ProblemError(403, "Own proposal", "The other party must accept your proposal.");
    const latest = (await client.query<{ id: string }>(
      "SELECT id FROM proposals WHERE case_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT 1", [row.id, proposal.party_id],
    )).rows[0];
    if (latest?.id !== proposal.id) throw new ProblemError(409, "Proposal superseded", "This proposal was replaced by a newer one from the same party.");
    await client.query("INSERT INTO proposal_acceptances(proposal_id, party_id) VALUES ($1, $2)", [proposal.id, m.partyId]);
    const original = (await client.query<{ id: string; sha256: string; title: string }>(`
      SELECT d.id, d.sha256, a.title FROM agreements a
      LEFT JOIN sealed_documents d ON d.agreement_id = a.id AND d.kind = 'FINAL'
      WHERE a.id = $1 ORDER BY d.sealed_at DESC NULLS LAST LIMIT 1
    `, [m.agreementId])).rows[0]!;
    const sections = renderAddendum({
      agreementTitle: original.title, originalSealId: original.id ?? null, originalSha256: original.sha256 ?? null,
      proposalBody: proposal.body,
      proposedBy: `${nameOf(m, proposal.party_id)} (${roleLabel(m, proposal.party_id).toLowerCase()})`, proposedAt: proposal.created_at.toISOString().slice(0, 10),
      acceptedBy: `${nameOf(m, m.partyId)} (${roleLabel(m, m.partyId).toLowerCase()})`, acceptedAt: new Date().toISOString().slice(0, 10),
    });
    const addendum = await client.query<{ id: string }>(`
      INSERT INTO addenda(case_id, agreement_id, proposal_id, sections, content_sha256) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id
    `, [row.id, m.agreementId, proposal.id, JSON.stringify(sections), sha256(canonicalJson(sections))]);
    const addendumId = addendum.rows[0]!.id;
    await client.query("INSERT INTO outbox(topic, payload) VALUES ('addendum.render', $1::jsonb)", [JSON.stringify({ addendumId })]);
    return { addendumId };
  });
}

export async function signAddendum(input: { userId: string; agreementId: string; typedName: string; evidence: Evidence }): Promise<{ signed: number }> {
  const esignId = await requireCaseLegal(input.userId);
  const evidence = await encryptEvidence(input.evidence);
  return inTransaction(async (client) => {
    const { m, row } = await openCaseFor(client, input.userId, input.agreementId);
    const addendum = await addendumFor(client, row.id, true);
    if (!addendum || addendum.status !== "AWAITING_SIGNATURES") throw new ProblemError(409, "Nothing to sign", "There is no addendum waiting for signatures.");
    if (addendum.render_status !== "READY" || !addendum.document_sha256) throw new ProblemError(409, "Preview pending", "The addendum document is still being generated.");
    const inserted = await client.query(`
      INSERT INTO addendum_signatures(addendum_id, party_id, typed_name, esign_document_id, document_sha256, ip_ciphertext, user_agent_ciphertext)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (addendum_id, party_id) DO NOTHING
    `, [addendum.id, m.partyId, input.typedName.trim(), esignId, addendum.document_sha256, evidence[0], evidence[1]]);
    if (inserted.rowCount !== 1) throw new ProblemError(409, "Already signed", "You already signed this addendum.");
    const count = Number((await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM addendum_signatures WHERE addendum_id = $1 AND document_sha256 = $2", [addendum.id, addendum.document_sha256],
    )).rows[0]!.n);
    if (count >= 2) await client.query("INSERT INTO outbox(topic, payload) VALUES ('seal.addendum', $1::jsonb)", [JSON.stringify({ addendumId: addendum.id })]);
    return { signed: count };
  });
}

/** Only the party that opened the case may withdraw it, before both parties sign an addendum. */
export async function withdrawCase(input: { userId: string; agreementId: string }): Promise<{ state: AgreementState }> {
  await requireCaseLegal(input.userId);
  return inTransaction(async (client) => {
    const { m, row } = await openCaseFor(client, input.userId, input.agreementId);
    if (row.opened_by_party_id !== m.partyId) throw new ProblemError(403, "Not your case", "Only the party that opened the case can withdraw it.");
    const addendum = await addendumFor(client, row.id, true);
    if (addendum) {
      const signed = Number((await client.query<{ n: string }>("SELECT count(*)::text AS n FROM addendum_signatures WHERE addendum_id = $1", [addendum.id])).rows[0]!.n);
      if (signed >= 2 || addendum.status === "SEALED") throw new ProblemError(409, "Addendum signed", "Both parties signed the addendum; the case is being resolved.");
      await client.query("UPDATE addenda SET status = 'CANCELLED' WHERE id = $1", [addendum.id]);
    }
    await client.query("UPDATE cases SET status = 'WITHDRAWN', closed_at = now(), closed_by_party_id = $2 WHERE id = $1", [row.id, m.partyId]);
    const state = transition(m.state, "EXECUTED");
    await client.query("UPDATE agreements SET state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1", [m.agreementId, state]);
    return { state };
  });
}

/** Party-only access to the unsigned addendum preview and the sealed addendum. */
export async function addendumObject(userId: string, agreementId: string, which: "preview" | "sealed"): Promise<{ key: string; name: string }> {
  const pool = getPool();
  const m = await member(pool, userId, agreementId);
  const row = await latestCase(pool, m.agreementId);
  const addendum = row ? await addendumFor(pool, row.id) : null;
  if (!addendum) throw new ProblemError(404, "Not Found", "No addendum on this agreement.");
  if (which === "preview") {
    const key = (await pool.query<{ document_s3_key: string | null }>("SELECT document_s3_key FROM addenda WHERE id = $1", [addendum.id])).rows[0]?.document_s3_key;
    if (!key) throw new ProblemError(409, "Preview pending", "The addendum document is still being generated.");
    return { key, name: `addendum-${addendum.id}.pdf` };
  }
  if (!addendum.sealed_document_id) throw new ProblemError(404, "Not Found", "The addendum is not sealed yet.");
  const sealed = (await pool.query<{ s3_key: string }>("SELECT s3_key FROM sealed_documents WHERE id = $1 AND agreement_id = $2", [addendum.sealed_document_id, m.agreementId])).rows[0];
  if (!sealed) throw new ProblemError(404, "Not Found", "The addendum is not sealed yet.");
  return { key: sealed.s3_key, name: `theckards-addendum-${addendum.sealed_document_id}.pdf` };
}
