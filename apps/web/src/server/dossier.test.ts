import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: { member: Row[]; parties: Row[]; mine: Row[]; existing: Row[]; pending: number; artifact: Row[] };
const calls: { sql: string; values: unknown[] }[] = [];
const query = vi.fn(async (sql: string, values: unknown[] = []) => {
  calls.push({ sql, values });
  if (sql.includes("JOIN parties p ON p.agreement_id = a.id")) return { rows: tables.member };
  if (sql.includes("COALESCE(s.typed_name, p.display_name)")) return { rows: tables.parties };
  if (sql.includes("ORDER BY r.created_at DESC LIMIT 20")) return { rows: tables.mine };
  if (sql.includes("FROM dossier_requests WHERE party_id = $1 AND client_key = $2")) return { rows: tables.existing };
  if (sql.includes("count(*) FROM dossier_requests")) return { rows: [{ count: String(tables.pending) }] };
  if (sql.includes("WHERE r.id = $1")) return { rows: tables.artifact };
  if (sql.includes("INSERT INTO dossier_requests")) {
    return { rows: [{ id: "dr-1", status: "PENDING", bytes: null, sha256: null, sealed_document_id: null, created_at: new Date("2026-11-10T20:00:00Z"), ready_at: null }], rowCount: 1 };
  }
  return { rows: [], rowCount: 1 };
});
const client = { query };
let privacy = 4;
vi.mock("./db", () => ({ getPool: () => client, inTransaction: (work: (c: typeof client) => unknown) => work(client) }));
vi.mock("./legal", () => ({
  userHasCurrentConsents: async () => true,
  currentApprovedLegal: async () => [{ documentType: "PRIVACY", version: privacy }],
}));
vi.mock("./crypto", () => ({ sha256: (value: string) => value.slice(0, 64), randomToken: () => "random-token" }));
const { dossierArtifact, listDossiers, requestDossier } = await import("./dossier");

const A = "11111111-1111-1111-1111-111111111111";
const ask = { userId: "u-creator", agreementId: A, idempotencyKey: "key-12345678" };
const memberRow = (state = "EXECUTED", partyId = "p-creator") =>
  ({ id: A, state, template_id: "purchase_sale", due_at: null, version_id: "v1", fields: {}, party_id: partyId, party_role: "CREATOR" });
const readyArtifact = {
  status: "READY", s3_key: "agreements/a/dossiers/dr-1/theckards-dossier-seal.zip", sha256: "f".repeat(64),
  sealed_document_id: "seal-1", receipt: { id: "seal-1", kind: "DOSSIER", sha256: "f".repeat(64) },
};

beforeEach(() => {
  calls.length = 0; query.mockClear(); privacy = 4;
  tables = { member: [memberRow()], parties: [{ id: "p-creator", role: "CREATOR", name: "Alex" }], mine: [], existing: [], pending: 0, artifact: [] };
});

describe("dossier access is limited to the agreement's parties (IDOR)", () => {
  it("returns 404 to an outsider for listing, requesting and downloading", async () => {
    tables.member = [];
    for (const operation of [
      () => listDossiers("outsider", A),
      () => requestDossier({ ...ask, userId: "outsider" }),
      () => dossierArtifact("outsider", A, "dr-1"),
    ]) await expect(operation()).rejects.toMatchObject({ status: 404 });
    expect(calls.some((call) => call.sql.includes("INSERT INTO dossier_requests"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("INSERT INTO outbox"))).toBe(false);
  });

  // The subtle case: both people are parties to the same agreement, but an archive carries the private notes of
  // whoever asked for it, so the other party must not be able to download it.
  it("hides one party's dossier from the other party", async () => {
    tables.member = [memberRow("EXECUTED", "p-counterparty")];
    tables.artifact = [];
    await expect(dossierArtifact("u-counterparty", A, "dr-1")).rejects.toMatchObject({ status: 404 });
    const lookup = calls.find((call) => call.sql.includes("WHERE r.id = $1"));
    expect(lookup?.values).toEqual(["dr-1", A, "p-counterparty"]);
  });

  it("lists only the caller's own dossiers", async () => {
    await listDossiers("u-creator", A);
    const list = calls.find((call) => call.sql.includes("ORDER BY r.created_at DESC LIMIT 20"));
    expect(list?.values).toEqual([A, "p-creator"]);
  });

  // The panel shows the hash a party is told to compare, so it must come from the append-only sealed document.
  it("reports the hash the receipt was signed over, not the request's own column", async () => {
    tables.mine = [{ id: "dr-1", party_id: "p-creator", status: "READY", bytes: 4096, sha256: "c".repeat(64), sealed_document_id: "seal-1", created_at: new Date("2026-11-10T20:00:00Z"), ready_at: new Date("2026-11-10T20:01:00Z") }];
    const view = await listDossiers("u-creator", A);
    expect(view.items[0]!.sha256).toBe("c".repeat(64));
    const list = calls.find((call) => call.sql.includes("ORDER BY r.created_at DESC LIMIT 20"));
    expect(list?.sql).toContain("LEFT JOIN sealed_documents d ON d.id = r.sealed_document_id");
    expect(list?.sql).toContain("d.sha256");
  });
});

describe("requesting a dossier", () => {
  it("queues exactly one build job", async () => {
    const created = await requestDossier(ask);
    expect(created).toMatchObject({ id: "dr-1", status: "PENDING" });
    const enqueued = calls.filter((call) => call.sql.includes("INSERT INTO outbox"));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.sql).toContain("'dossier.build'");
    expect(JSON.parse(String(enqueued[0]!.values[0]))).toEqual({ requestId: "dr-1" });
  });

  it("replays the same request instead of building twice", async () => {
    tables.existing = [{ id: "dr-0", status: "READY", bytes: 2048, sha256: "a".repeat(64), sealed_document_id: "seal-0", created_at: new Date("2026-11-10T19:00:00Z"), ready_at: new Date("2026-11-10T19:01:00Z") }];
    const replay = await requestDossier(ask);
    expect(replay.id).toBe("dr-0");
    expect(calls.some((call) => call.sql.includes("INSERT INTO dossier_requests"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("INSERT INTO outbox"))).toBe(false);
  });

  it("refuses to pile up builds for one party", async () => {
    tables.pending = 2;
    await expect(requestDossier(ask)).rejects.toMatchObject({ status: 429 });
  });

  it("refuses before both parties have signed", async () => {
    for (const state of ["DRAFT", "AWAITING_SIGNATURES", "CANCELLED", "EXPIRED"]) {
      tables.member = [{ ...memberRow(), state }];
      await expect(requestDossier(ask)).rejects.toMatchObject({ status: 409 });
    }
  });

  // The archive embeds evidence files, so it opens with the Privacy Policy version that discloses them.
  it("stays closed until the privacy policy that discloses evidence is approved", async () => {
    for (const version of [0, 3]) {
      privacy = version;
      await expect(requestDossier(ask)).rejects.toMatchObject({ status: 503 });
      const view = await listDossiers("u-creator", A);
      expect(view.legalReady).toBe(false);
      expect(view.canRequest).toBe(false);
    }
  });
});

describe("downloading a dossier", () => {
  it("serves the archive and its receipt once it is sealed", async () => {
    tables.artifact = [readyArtifact];
    const artifact = await dossierArtifact("u-creator", A, "dr-1");
    expect(artifact.key).toBe(readyArtifact.s3_key);
    expect(artifact.filename).toBe("theckards-dossier-seal-1.zip");
    expect(artifact.receipt).toEqual(readyArtifact.receipt);
  });

  it("refuses while the archive is not sealed yet", async () => {
    for (const row of [
      { ...readyArtifact, status: "PENDING", s3_key: null, sha256: null, sealed_document_id: null, receipt: null },
      { ...readyArtifact, status: "FAILED", s3_key: null, sha256: null, sealed_document_id: null, receipt: null },
      { ...readyArtifact, receipt: null },
    ]) {
      tables.artifact = [row];
      await expect(dossierArtifact("u-creator", A, "dr-1")).rejects.toMatchObject({ status: 409 });
    }
  });
});
