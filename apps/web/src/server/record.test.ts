import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const client = { query };
vi.mock("./db", () => ({ getPool: () => client, inTransaction: (work: (c: typeof client) => unknown) => work(client) }));
vi.mock("./legal", () => ({
  userHasCurrentConsents: async () => true,
  currentApprovedLegal: async () => [{ documentType: "PRIVACY", version: privacyVersion }],
}));
let privacyVersion = 3;
vi.mock("./admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("./crypto", () => ({ sha256: (v: string) => v }));
const { addConfirmation, addMessage, addNote, claimParty, getRecord } = await import("./record");

const agreement = "11111111-1111-1111-1111-111111111111";
const guest = { sessionHash: "h", agreementId: agreement, partyId: "p-cp", csrfHash: "c" };
const memberRow = (role: "CREATOR" | "COUNTERPARTY", partyId: string, state = "EXECUTED") => ({
  id: agreement, state, template_id: "purchase_sale", due_at: null, version_id: "v1",
  fields: { creatorRole: "seller", price: "350.00" }, party_id: partyId, party_role: role,
});
const parties = { rows: [{ id: "p-cr", role: "CREATOR", name: "Alex" }, { id: "p-cp", role: "COUNTERPARTY", name: "Jamie" }] };

describe("record access is limited to the agreement's parties (IDOR)", () => {
  beforeEach(() => query.mockReset());

  it("returns 404 for an outsider on every read and write", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const outsider = "99999999-9999-9999-9999-999999999999";
    await expect(getRecord(outsider, agreement)).rejects.toMatchObject({ status: 404 });
    await expect(addConfirmation({ userId: outsider, agreementId: agreement, kind: "ITEM_RECEIVED" })).rejects.toMatchObject({ status: 404 });
    await expect(addMessage({ userId: outsider, agreementId: agreement, body: "hi", idempotencyKey: "k-1234567" })).rejects.toMatchObject({ status: 404 });
    await expect(addNote({ userId: outsider, agreementId: agreement, body: "hi", idempotencyKey: "k-1234567" })).rejects.toMatchObject({ status: 404 });
    // The membership query is always bound to the caller's user id.
    for (const call of query.mock.calls.filter(([sql]) => String(sql).includes("JOIN parties p ON p.agreement_id = a.id"))) {
      expect(call[1]).toEqual([agreement, outsider]);
      expect(String(call[0])).toContain("p.user_id = $2 OR (p.role = 'CREATOR' AND a.creator_id = $2)");
    }
  });

  it("refuses a confirmation that belongs to the other party's role", async () => {
    // The creator is the seller, so "item received" belongs to the buyer (counterparty).
    query.mockResolvedValueOnce({ rows: [memberRow("CREATOR", "p-cr")] }).mockResolvedValueOnce(parties);
    await expect(addConfirmation({ userId: "u-cr", agreementId: agreement, kind: "ITEM_RECEIVED" })).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO confirmations"))).toBe(false);
  });

  it("refuses records before both parties sign", async () => {
    query.mockResolvedValueOnce({ rows: [memberRow("COUNTERPARTY", "p-cp", "PENDING_SIGNATURES")] }).mockResolvedValueOnce(parties);
    await expect(addMessage({ userId: "u-cp", agreementId: agreement, body: "hi", idempotencyKey: "k-1234567" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("legal gate", () => {
  it("blocks every record write until Privacy v3 is approved", async () => {
    query.mockReset();
    privacyVersion = 2;
    await expect(addMessage({ userId: "u", agreementId: agreement, body: "hi", idempotencyKey: "k-1234567" })).rejects.toMatchObject({ status: 503 });
    await expect(addConfirmation({ userId: "u", agreementId: agreement, kind: "ITEM_RECEIVED" })).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
    privacyVersion = 3;
  });
});

describe("linking the counterparty to an account", () => {
  beforeEach(() => query.mockReset());

  it("never lets the creator's account become the counterparty", async () => {
    query.mockResolvedValueOnce({ rows: [{ creator_id: "u-cr", user_id: null }] });
    await expect(claimParty("u-cr", guest, "r")).rejects.toMatchObject({ status: 409 });
  });

  it("never re-links a party already linked to another account", async () => {
    query.mockResolvedValueOnce({ rows: [{ creator_id: "u-cr", user_id: "u-other" }] });
    await expect(claimParty("u-cp", guest, "r")).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE parties"))).toBe(false);
  });

  it("links only the party named by the guest session", async () => {
    query.mockResolvedValueOnce({ rows: [{ creator_id: "u-cr", user_id: null }] }).mockResolvedValue({ rows: [], rowCount: 1 });
    await expect(claimParty("u-cp", guest, "r")).resolves.toEqual({ agreementId: agreement });
    const update = query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE parties"));
    expect(update?.[1]).toEqual(["p-cp", "u-cp"]);
    expect(String(update?.[0])).toContain("user_id IS NULL");
  });
});
