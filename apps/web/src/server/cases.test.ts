import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: { member: Row[]; parties: Row[]; case: Row[]; addendum: Row[]; proposal: Row[]; latest: Row[] };
const calls: { sql: string; values: unknown[] }[] = [];
const query = vi.fn(async (sql: string, values: unknown[] = []) => {
  calls.push({ sql, values });
  if (sql.includes("JOIN parties p ON p.agreement_id = a.id")) return { rows: tables.member };
  if (sql.includes("COALESCE(s.typed_name, p.display_name)")) return { rows: tables.parties };
  if (sql.includes("FROM cases WHERE agreement_id")) return { rows: tables.case };
  if (sql.includes("FROM addenda WHERE case_id")) return { rows: tables.addendum };
  if (sql.includes("FROM proposals WHERE id = $1 AND case_id")) return { rows: tables.proposal };
  if (sql.includes("ORDER BY created_at DESC LIMIT 1")) return { rows: tables.latest };
  if (sql.includes("LEFT JOIN sealed_documents d")) return { rows: [{ id: "seal-final", sha256: "b".repeat(64), title: "Bicycle sale" }] };
  if (sql.includes("RETURNING id")) return { rows: [{ id: "new-id" }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
});
const client = { query };
let privacy = 4;
let esign = 3;
vi.mock("./db", () => ({ getPool: () => client, inTransaction: (work: (c: typeof client) => unknown) => work(client) }));
vi.mock("./legal", () => ({
  userHasCurrentConsents: async () => true,
  currentApprovedLegal: async () => [{ documentType: "PRIVACY", version: privacy, id: "lp" }, { documentType: "ESIGN", version: esign, id: "le" }],
}));
vi.mock("./crypto", () => ({ sha256: (v: string) => v.slice(0, 64), encryptText: async () => Buffer.from("x"), hmac: (v: string) => v }));
vi.mock("./signing", () => ({ encryptEvidence: async () => [Buffer.from("i"), Buffer.from("u")] }));
const { acceptProposal, addProposal, getCase, openCase, signAddendum, withdrawCase } = await import("./cases");

const A = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const memberRow = (role: "CREATOR" | "COUNTERPARTY", partyId: string, state = "IN_CASE") =>
  ({ id: A, state, template_id: "purchase_sale", due_at: null, version_id: "v1", fields: { creatorRole: "seller" }, party_id: partyId, party_role: role });
const openCaseRow = { id: "case-1", opened_by_party_id: "p-cr", reason: "Item not delivered", status: "OPEN", evidence_window_ends_at: new Date(), opened_at: new Date(), closed_at: null, closed_by_party_id: null };

beforeEach(() => {
  calls.length = 0; query.mockClear(); privacy = 4; esign = 3;
  tables = {
    member: [memberRow("COUNTERPARTY", "p-cp")],
    parties: [{ id: "p-cr", role: "CREATOR", name: "Alex" }, { id: "p-cp", role: "COUNTERPARTY", name: "Jamie" }],
    case: [openCaseRow], addendum: [], proposal: [{ id: P, party_id: "p-cr", body: "Refund half", created_at: new Date() }], latest: [{ id: P }],
  };
});
const inserted = (table: string) => calls.some((c) => c.sql.includes(`INSERT INTO ${table}`));

describe("case access is limited to the agreement's parties (IDOR)", () => {
  it("returns 404 to an outsider for every case operation", async () => {
    tables.member = [];
    const u = "outsider";
    for (const op of [
      () => getCase(u, A), () => openCase({ userId: u, agreementId: A, reason: "abc" }),
      () => addProposal({ userId: u, agreementId: A, body: "abc", idempotencyKey: "k-1234567" }),
      () => acceptProposal({ userId: u, agreementId: A, proposalId: P }),
      () => signAddendum({ userId: u, agreementId: A, typedName: "Mallory", evidence: { ip: "1", userAgent: "x" } }),
      () => withdrawCase({ userId: u, agreementId: A }),
    ]) await expect(op()).rejects.toMatchObject({ status: 404 });
    expect(inserted("cases") || inserted("proposals") || inserted("addenda") || inserted("addendum_signatures")).toBe(false);
  });
});

describe("Theckards never decides a case (G2)", () => {
  it("an author cannot accept their own proposal", async () => {
    tables.member = [memberRow("CREATOR", "p-cr")];
    await expect(acceptProposal({ userId: "u-cr", agreementId: A, proposalId: P })).rejects.toMatchObject({ status: 403 });
    expect(inserted("addenda")).toBe(false);
  });
  it("a superseded proposal cannot be accepted", async () => {
    tables.latest = [{ id: "newer" }];
    await expect(acceptProposal({ userId: "u-cp", agreementId: A, proposalId: P })).rejects.toMatchObject({ status: 409 });
    expect(inserted("addenda")).toBe(false);
  });
  it("acceptance by the other party of the current proposal creates the addendum with the proposal text verbatim", async () => {
    await expect(acceptProposal({ userId: "u-cp", agreementId: A, proposalId: P })).resolves.toBeDefined();
    const addendum = calls.find((c) => c.sql.includes("INSERT INTO addenda"));
    expect(String(addendum?.values[3])).toContain("Refund half");
    expect(String(addendum?.values[3])).toContain("did not decide");
    expect(calls.some((c) => c.sql.includes("'addendum.render'"))).toBe(true);
  });
  it("only the party that opened the case can withdraw it", async () => {
    await expect(withdrawCase({ userId: "u-cp", agreementId: A })).rejects.toMatchObject({ status: 403 });
  });
  it("a case cannot be opened on an unsigned or completed agreement", async () => {
    tables.member = [memberRow("COUNTERPARTY", "p-cp", "COMPLETED")];
    await expect(openCase({ userId: "u-cp", agreementId: A, reason: "abc" })).rejects.toMatchObject({ status: 409 });
  });
  it("an addendum is not signed before its document exists", async () => {
    tables.addendum = [{ id: "ad", proposal_id: P, status: "AWAITING_SIGNATURES", render_status: "PENDING", document_sha256: null, sealed_document_id: null, sections: [] }];
    await expect(signAddendum({ userId: "u-cp", agreementId: A, typedName: "Jamie", evidence: { ip: "1", userAgent: "x" } })).rejects.toMatchObject({ status: 409 });
  });
});

describe("legal gate", () => {
  it("blocks every case write until Privacy v4 and ESIGN v3 are approved", async () => {
    privacy = 3;
    await expect(openCase({ userId: "u", agreementId: A, reason: "abc" })).rejects.toMatchObject({ status: 503 });
    privacy = 4; esign = 2;
    await expect(acceptProposal({ userId: "u", agreementId: A, proposalId: P })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});
