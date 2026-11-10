import { REQUIRED_LEGAL_DOCUMENTS, type LegalDocumentType } from "@theckards/domain";
import type pg from "pg";
import { encryptText } from "./crypto";
import { getPool, inTransaction } from "./db";
import { writeAudit } from "./admin/audit";

export interface LegalDocument {
  id: string;
  documentType: LegalDocumentType;
  locale: string;
  version: number;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  title: string;
  bodyMd: string;
  approvedAt: Date | null;
}

function map(row: Record<string, unknown>): LegalDocument {
  return {
    id: String(row.id), documentType: row.document_type as LegalDocumentType, locale: String(row.locale),
    version: Number(row.version), status: row.status as LegalDocument["status"], title: String(row.title),
    bodyMd: String(row.body_md), approvedAt: row.approved_at ? new Date(String(row.approved_at)) : null,
  };
}

export async function listLegalDocuments(): Promise<LegalDocument[]> {
  const result = await getPool().query("SELECT id, document_type, locale, version, status, title, body_md, approved_at FROM legal_documents ORDER BY document_type, version DESC");
  return result.rows.map(map);
}

export async function currentApprovedLegal(locale = "en-US"): Promise<LegalDocument[]> {
  const result = await getPool().query(`
    SELECT DISTINCT ON (document_type) id, document_type, locale, version, status, title, body_md, approved_at
    FROM legal_documents WHERE locale = $1 AND status = 'APPROVED'
    ORDER BY document_type, version DESC
  `, [locale]);
  return result.rows.map(map);
}

export async function hasAllRequiredLegal(locale = "en-US"): Promise<boolean> {
  const documents = await currentApprovedLegal(locale);
  return REQUIRED_LEGAL_DOCUMENTS.every((type) => documents.some((document) => document.documentType === type));
}

export async function userHasCurrentConsents(userId: string, locale = "en-US"): Promise<boolean> {
  const result = await getPool().query<{ document_type: LegalDocumentType }>(`
    SELECT ld.document_type
    FROM legal_documents ld JOIN user_consents uc ON uc.legal_document_id = ld.id
    WHERE uc.user_id = $1 AND ld.locale = $2 AND ld.status = 'APPROVED'
  `, [userId, locale]);
  const accepted = new Set(result.rows.map((row) => row.document_type));
  return REQUIRED_LEGAL_DOCUMENTS.every((type) => accepted.has(type));
}

export async function acceptCurrentLegal(userId: string, ip: string, userAgent: string): Promise<void> {
  const documents = await currentApprovedLegal();
  if (!REQUIRED_LEGAL_DOCUMENTS.every((type) => documents.some((document) => document.documentType === type))) {
    throw new Error("Legal documents are not approved");
  }
  const [ipCiphertext, userAgentCiphertext] = await Promise.all([
    encryptText(ip, "consent-ip"), encryptText(userAgent.slice(0, 512), "consent-user-agent"),
  ]);
  await inTransaction(async (client) => {
    for (const document of documents) {
      await client.query(`
        INSERT INTO user_consents(user_id, legal_document_id, ip_ciphertext, user_agent_ciphertext)
        VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, legal_document_id) DO NOTHING
      `, [userId, document.id, ipCiphertext, userAgentCiphertext]);
    }
    await writeAudit(client, { actorType: "USER", actorId: userId, action: "LEGAL_ACCEPTED", entityType: "legal_bundle", after: { documentIds: documents.map((d) => d.id) } });
  });
}

export async function updateLegalDraft(input: { id: string; title: string; bodyMd: string; actorId: string; requestId: string }): Promise<void> {
  await inTransaction(async (client: pg.PoolClient) => {
    const current = await client.query("SELECT * FROM legal_documents WHERE id = $1 FOR UPDATE", [input.id]);
    const document = current.rows[0] as Record<string, unknown> | undefined;
    if (!document || document.status !== "DRAFT") throw new Error("Only draft legal documents can be edited");
    await client.query("UPDATE legal_documents SET title = $2, body_md = $3 WHERE id = $1", [input.id, input.title, input.bodyMd]);
    await writeAudit(client, { actorType: "ADMIN", actorId: input.actorId, action: "LEGAL_DRAFT_UPDATED", entityType: "legal_document", entityId: input.id, requestId: input.requestId, before: { title: document.title, bodyMd: document.body_md }, after: { title: input.title, bodyMd: input.bodyMd } });
  });
}

export async function approveLegalDocument(input: { id: string; actorId: string; requestId: string }): Promise<void> {
  await inTransaction(async (client: pg.PoolClient) => {
    const current = await client.query("SELECT * FROM legal_documents WHERE id = $1 FOR UPDATE", [input.id]);
    const document = current.rows[0] as Record<string, unknown> | undefined;
    if (!document || document.status !== "DRAFT") throw new Error("Only draft legal documents can be approved");
    await client.query("UPDATE legal_documents SET status = 'RETIRED' WHERE document_type = $1 AND locale = $2 AND status = 'APPROVED'", [document.document_type, document.locale]);
    await client.query("UPDATE legal_documents SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1", [input.id, input.actorId]);
    await writeAudit(client, { actorType: "ADMIN", actorId: input.actorId, action: "LEGAL_APPROVED", entityType: "legal_document", entityId: input.id, requestId: input.requestId, after: { documentType: document.document_type, locale: document.locale, version: document.version } });
  });
}
